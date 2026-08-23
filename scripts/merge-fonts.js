#!/usr/bin/env node
//
// Pre-merges comma-joined text-font stacks from style.json into on-disk
// comma-named glyph directories under fonts/.
//
// MapLibre GL requests glyphs with the text-font array joined by commas as
// the {fontstack} URL segment, e.g. ["Open Sans Semibold","Noto Sans Bold"]
// -> fonts/Open Sans Semibold,Noto Sans Bold/0-255.pbf. GitHub Pages is
// static, so those stacks must be pre-merged into single directories at
// build time: for each of the 256 glyph ranges, glyphs are merged across the
// stack's fonts (first font wins per glyph id, missing glyphs filled from
// subsequent fonts). Single-font stacks are already served as-is.
//
// Zero-dependency: implements a minimal reader/writer for the fontnik/Mapbox
// glyph PBF schema only. Idempotent: merged dirs are removed and rewritten
// every run.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STYLE_JSON = path.join(ROOT, 'style.json');
const FONTS_DIR = path.join(ROOT, 'fonts');

const WIRE_VARINT = 0;
const WIRE_LENGTH = 2;

// --- varint / zigzag -------------------------------------------------------

function readVarint(buf, pos) {
  let value = 0;
  let shift = 0;
  while (true) {
    if (pos >= buf.length) throw new Error('Truncated varint');
    const byte = buf[pos++];
    value += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) break;
    shift += 7;
    if (shift > 63) throw new Error('Varint exceeds 64 bits');
  }
  return { value, pos };
}

function zigzagDecode(n) {
  return (n >>> 1) ^ -(n & 1);
}

function zigzagEncode(n) {
  return (n << 1) ^ (n >> 31);
}

// --- minimal protobuf reader ----------------------------------------------

function parseMessage(buf, start, end, filePath) {
  const records = [];
  let pos = start;
  while (pos < end) {
    const tag = readVarint(buf, pos);
    pos = tag.pos;
    const field = Math.floor(tag.value / 8);
    const wireType = tag.value % 8;
    if (wireType === WIRE_VARINT) {
      const v = readVarint(buf, pos);
      pos = v.pos;
      records.push({ field, wireType, value: v.value });
    } else if (wireType === WIRE_LENGTH) {
      const len = readVarint(buf, pos);
      pos = len.pos;
      if (pos + len.value > end) {
        throw new Error(`Malformed length-delimited field in ${filePath}`);
      }
      records.push({
        field,
        wireType,
        value: buf.subarray(pos, pos + len.value),
        valueStart: pos,
        valueLen: len.value,
      });
      pos += len.value;
    } else {
      throw new Error(`Unsupported wire type ${wireType} (field ${field}) in ${filePath}`);
    }
  }
  return records;
}

function parseGlyph(buf, start, end, filePath) {
  const records = parseMessage(buf, start, end, filePath);
  let id = null;
  for (const rec of records) {
    if (rec.field === 1 && rec.wireType === WIRE_VARINT) id = rec.value;
    else if ((rec.field === 5 || rec.field === 6) && rec.wireType === WIRE_VARINT) {
      rec.value = zigzagDecode(rec.value);
    }
  }
  return { id, records };
}

// --- minimal protobuf writer ----------------------------------------------

function ByteWriter() {
  this.chunks = [];
  this.length = 0;
}

ByteWriter.prototype.pushByte = function (b) {
  this.chunks.push(b);
  this.length++;
};

ByteWriter.prototype.pushBytes = function (buf) {
  this.chunks.push(buf);
  this.length += buf.length;
};

ByteWriter.prototype.writeVarint = function (value) {
  while (value >= 0x80) {
    this.pushByte((value % 128) | 0x80);
    value = Math.floor(value / 128);
  }
  this.pushByte(value);
};

ByteWriter.prototype.writeTag = function (field, wireType) {
  this.writeVarint((field << 3) | wireType);
};

ByteWriter.prototype.writeString = function (field, str) {
  this.writeTag(field, WIRE_LENGTH);
  this.writeVarint(Buffer.byteLength(str));
  this.pushBytes(Buffer.from(str, 'utf8'));
};

ByteWriter.prototype.writeGlyph = function (records) {
  for (const rec of records) {
    this.writeTag(rec.field, rec.wireType);
    if (rec.wireType === WIRE_VARINT) {
      const value = rec.field === 5 || rec.field === 6 ? zigzagEncode(rec.value) : rec.value;
      this.writeVarint(value);
    } else {
      this.writeVarint(rec.valueLen);
      this.pushBytes(rec.value);
    }
  }
};

ByteWriter.prototype.toBuffer = function () {
  const out = Buffer.alloc(this.length);
  let pos = 0;
  for (const chunk of this.chunks) {
    if (typeof chunk === 'number') out[pos++] = chunk;
    else {
      chunk.copy(out, pos);
      pos += chunk.length;
    }
  }
  return out;
};

// --- merge logic -----------------------------------------------------------

function distinctTextFonts(style) {
  const seen = new Set();
  const stacks = [];
  for (const layer of style.layers || []) {
    if (layer.type !== 'symbol' || !layer.layout) continue;
    const fonts = layer.layout['text-font'];
    if (!Array.isArray(fonts) || fonts.length === 0) continue;
    const key = fonts.join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    stacks.push(fonts);
  }
  return stacks.sort((a, b) => a.join(' ').localeCompare(b.join(' ')));
}

function readRangeGlyphs(font, rangeName) {
  const file = path.join(FONTS_DIR, font, `${rangeName}.pbf`);
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  const glyphs = [];
  const root = parseMessage(buf, 0, buf.length, file);
  for (const rec of root) {
    if (rec.field !== 1 || rec.wireType !== WIRE_LENGTH) continue;
    const fontstack = parseMessage(buf, rec.valueStart, rec.valueStart + rec.valueLen, file);
    for (const fr of fontstack) {
      if (fr.field !== 3 || fr.wireType !== WIRE_LENGTH) continue;
      glyphs.push(parseGlyph(buf, fr.valueStart, fr.valueStart + fr.valueLen, file));
    }
  }
  return glyphs;
}

function main() {
  const style = JSON.parse(fs.readFileSync(STYLE_JSON, 'utf8'));
  const stacks = distinctTextFonts(style);

  let mergedCount = 0;
  let writtenRanges = 0;

  for (const stack of stacks) {
    if (stack.length === 1) {
      console.log(`skip single-font stack: ${stack[0]}`);
      continue;
    }

    const mergedName = stack.join(',');
    const mergedDir = path.join(FONTS_DIR, mergedName);
    fs.rmSync(mergedDir, { recursive: true, force: true });
    fs.mkdirSync(mergedDir, { recursive: true });
    mergedCount++;

    let stackRanges = 0;
    for (let range = 0; range < 256; range++) {
      const rangeName = `${range * 256}-${range * 256 + 255}`;
      const merged = new Map();
      let sourcesFound = false;
      for (const font of stack) {
        const glyphs = readRangeGlyphs(font, rangeName);
        if (!glyphs) continue;
        sourcesFound = true;
        for (const glyph of glyphs) {
          if (glyph.id !== null && !merged.has(glyph.id)) merged.set(glyph.id, glyph);
        }
      }
      if (!sourcesFound) continue;

      const sorted = [...merged.values()].sort((a, b) => a.id - b.id);
      const fontstack = new ByteWriter();
      fontstack.writeString(1, stack[0]);
      fontstack.writeString(2, rangeName);
      for (const glyph of sorted) {
        fontstack.writeTag(3, WIRE_LENGTH);
        const g = new ByteWriter();
        g.writeGlyph(glyph.records);
        fontstack.writeVarint(g.length);
        fontstack.pushBytes(g.toBuffer());
      }
      const pbf = new ByteWriter();
      pbf.writeTag(1, WIRE_LENGTH);
      pbf.writeVarint(fontstack.length);
      pbf.pushBytes(fontstack.toBuffer());

      fs.writeFileSync(path.join(mergedDir, `${rangeName}.pbf`), pbf.toBuffer());
      stackRanges++;
    }

    console.log(`merged ${stack.join(' -> ')} (${stackRanges} ranges)`);
    writtenRanges += stackRanges;
  }

  console.log(`\nMerged ${mergedCount} multi-font stacks into fonts/, wrote ${writtenRanges} range PBFs.`);
}

main();