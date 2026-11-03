'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  PLACEHOLDER,
  SENTINEL,
  buildAppData,
  checkAppData,
  writeAppData
} = require('./palette-data');

const root = path.resolve(__dirname, '..');
const cliPath = path.join(root, 'scripts', 'palette-data.js');
const scratchBase = path.join(root, '.opencode', 'tmp');
const data = buildAppData({ root });

fs.mkdirSync(scratchBase, { recursive: true });

function scratch(name) {
  return fs.mkdtempSync(path.join(scratchBase, `palette-data-${name}-`));
}

function cleanup(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

test('summary counts match the runtime POI model', () => {
  assert.deepEqual(data.palette.summary, {
    roles: 11,
    classes: 68,
    features: 331,
    existingIcons: 129,
    missingIcons: 91,
    phantoms: 3,
    layers: 23,
    iconLayers: 17,
    textLayers: 6
  });
  assert.equal(data.palette.roles.length, 11);
  assert.equal(data.palette.missingNames.length, 91);
  assert.equal(data.palette.missingGroups.length, 13);
  assert.equal(data.palette.layers.length, 23);
  assert.equal(data.palette.phantoms.length, 3);
});

test('every role hierarchy icon has one template', () => {
  const names = new Set();
  for (const role of data.palette.roles) {
    assert.equal(role.iconCount, role.iconNames.length);
    for (const group of role.classes) {
      for (const icon of group.icons) {
        assert.equal(icon.inSprite, true);
        assert.ok(icon.roleId);
        names.add(icon.name);
      }
    }
  }

  assert.equal(names.size, 129);
  assert.equal(Object.keys(data.icons).length, 129);

  for (const name of names) {
    assert.ok(Object.prototype.hasOwnProperty.call(data.icons, name), `${name} has no template`);
  }

  for (const [name, template] of Object.entries(data.icons)) {
    assert.ok(template.includes(PLACEHOLDER), `${name} should contain the role placeholder`);
    assert.equal(template.includes(SENTINEL), false, `${name} should not contain the sentinel`);
    assert.equal(
      template.toLowerCase().includes(SENTINEL.toLowerCase()),
      false,
      `${name} should not contain the sentinel in any case`
    );
  }
});

test('inline style fills win and secondary fills are preserved', () => {
  const books = data.icons.books;
  assert.ok(books.includes('style="fill:__PALETTE_ROLE__;fill-opacity:1"'));
  assert.ok(books.includes('fill="#734A08"'));
  assert.equal(books.toLowerCase().includes('#ac39ac'), false);

  const gate = data.icons.gate;
  assert.ok(gate.includes('fill="white"'));
  assert.ok(gate.includes(PLACEHOLDER));

  for (const name of ['buddhist', 'christian', 'place_of_worship']) {
    const template = data.icons[name];
    assert.ok(template.includes(`fill="${PLACEHOLDER}"`), `${name} should use the placeholder`);
    assert.equal(template.includes('#000000'), false, `${name} should not keep explicit black`);
  }
});

test('generated data has no local paths, personal details or tooling references', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(data.palette, 'root'), false);

  for (const text of [data.paletteText, data.iconsText, data.manifestText]) {
    assert.equal(text.includes('/Users/'), false);
    assert.equal(/file:\/\//i.test(text), false);
    assert.equal(/opencode|open code|anthropic|openai|chatgpt|claude|copilot/i.test(text), false);
    assert.equal(/\bjoe\b/i.test(text), false);
  }
});

test('two builds produce identical output strings', () => {
  const again = buildAppData({ root });
  assert.equal(again.paletteText, data.paletteText);
  assert.equal(again.iconsText, data.iconsText);
  assert.equal(again.manifestText, data.manifestText);
});

test('manifest records an inputs hash and both data file hashes', () => {
  assert.match(data.palette.inputsHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(data.manifest.inputsHash, data.palette.inputsHash);
  assert.equal(
    data.manifest.files['palette.json'],
    `sha256:${sha256Hex(data.paletteText)}`
  );
  assert.equal(data.manifest.files['icons.json'], `sha256:${sha256Hex(data.iconsText)}`);
});

test('templates do not fetch external assets', () => {
  const fetchPattern =
    /(?:^|[\s"'<])(?:xlink:)?(?:href|src)\s*=\s*["']https?:|url\(\s*["']?https?:/i;

  for (const [name, template] of Object.entries(data.icons)) {
    assert.equal(fetchPattern.test(template), false, `${name} should not fetch an external asset`);
  }
});

test('--check passes for freshly written output', (t) => {
  const outDir = scratch('fresh');
  t.after(() => cleanup(outDir));

  const written = writeAppData({ root, outDir });
  const result = checkAppData({ root, outDir });
  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
  assert.equal(written.files['palette.json'].bytes, Buffer.byteLength(data.paletteText));

  const cli = spawnSync(process.execPath, [cliPath, '--check', '--out', outDir], {
    encoding: 'utf8'
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /in sync/);
});

test('--check fails for stale or missing output', (t) => {
  const outDir = scratch('stale');
  t.after(() => cleanup(outDir));
  writeAppData({ root, outDir });

  fs.writeFileSync(path.join(outDir, 'palette.json'), '{"stale":true}\n');
  const stale = checkAppData({ root, outDir });
  assert.equal(stale.ok, false);
  assert.ok(stale.problems.includes('stale palette.json'));
  assert.match(stale.message, /out of date/);

  const cliStale = spawnSync(process.execPath, [cliPath, '--check', '--out', outDir], {
    encoding: 'utf8'
  });
  assert.equal(cliStale.status, 1);
  assert.match(cliStale.stderr, /out of date/);

  fs.rmSync(path.join(outDir, 'icons.json'));
  const missing = checkAppData({ root, outDir });
  assert.equal(missing.ok, false);
  assert.ok(missing.problems.includes('missing icons.json'));

  const cliMissing = spawnSync(process.execPath, [cliPath, '--check', '--out', outDir], {
    encoding: 'utf8'
  });
  assert.equal(cliMissing.status, 1);
  assert.match(cliMissing.stderr, /missing icons\.json/);
});

test('output directories outside the generated allowlist are refused', (t) => {
  const unsafe = path.join(root, '.opencode', 'other');
  t.after(() => cleanup(unsafe));

  assert.throws(
    () => writeAppData({ root, outDir: path.join(root, 'docs', 'palette-data') }),
    /Refusing to write palette app data/
  );
  assert.throws(
    () => writeAppData({ root, outDir: unsafe }),
    /Refusing to write palette app data/
  );
  assert.equal(fs.existsSync(unsafe), false);
});
