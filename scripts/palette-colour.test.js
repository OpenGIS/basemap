'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const appRoot = path.join(root, 'app');

let colour;

test.before(async () => {
  colour = await import(pathToFileURL(path.join(appRoot, 'utils', 'colour.js')).href);
});

test('normaliseHex accepts short and long hex with or without a hash', () => {
  assert.equal(colour.normaliseHex('#abc'), '#AABBCC');
  assert.equal(colour.normaliseHex('abc'), '#AABBCC');
  assert.equal(colour.normaliseHex('#AABBCC'), '#AABBCC');
  assert.equal(colour.normaliseHex('aabbcc'), '#AABBCC');
  assert.equal(colour.normaliseHex('  #0092da  '), '#0092DA');
});

test('normaliseHex rejects empty and malformed values', () => {
  for (const value of ['', '   ', '#', '#12', '#1234', '#12345', '1234567', '#GGGGGG', 'red', null, undefined]) {
    assert.equal(colour.normaliseHex(value), null, `${String(value)} should be rejected`);
  }
});

test('iconDataUri replaces only the role placeholder and encodes the SVG', () => {
  const template =
    '<svg><path fill="__PALETTE_ROLE__"/><path fill="white"/><path fill="#123456"/></svg>';
  const uri = colour.iconDataUri(template, '#0092DA');

  assert.ok(uri.startsWith('data:image/svg+xml;charset=utf-8,'));
  assert.equal(uri.includes('__PALETTE_ROLE__'), false);

  const svg = decodeURIComponent(uri.slice('data:image/svg+xml;charset=utf-8,'.length));
  assert.ok(svg.includes('fill="#0092DA"'));
  assert.ok(svg.includes('fill="white"'));
  assert.ok(svg.includes('fill="#123456"'));
  assert.equal((svg.match(/#0092DA/g) || []).length, 1);
});

test('iconDataUri normalises the colour and rejects invalid colours', () => {
  const template = '<svg><path fill="__PALETTE_ROLE__"/></svg>';

  assert.ok(decodeURIComponent(colour.iconDataUri(template, 'abc')).includes('fill="#AABBCC"'));
  assert.equal(colour.iconDataUri(template, 'not-a-colour'), '');
  assert.equal(colour.iconDataUri('', '#AABBCC'), '');
});

test('buildPaletteDocument updates only role colours and preserves structure', () => {
  const source = {
    version: 7,
    roles: [
      {
        id: 'alpha',
        label: 'Alpha',
        color: '#111111',
        sourceColors: ['#111111'],
        order: 10
      },
      {
        id: 'beta',
        label: 'Beta',
        color: '#222222',
        sourceColors: ['#222222', '#333333'],
        order: 20
      }
    ],
    preserve: ['#FFFFFF'],
    overrides: { alpha: 'beta' }
  };
  const snapshot = JSON.stringify(source);
  const text = colour.buildPaletteDocument(source, { alpha: 'abcdef' });
  const document = JSON.parse(text);

  assert.ok(text.endsWith('\n'));
  assert.equal(text, `${JSON.stringify(document, null, 2)}\n`);
  assert.equal(document.version, 7);
  assert.deepEqual(document.roles.map((role) => role.id), ['alpha', 'beta']);
  assert.equal(document.roles[0].color, '#ABCDEF');
  assert.equal(document.roles[1].color, '#222222');
  assert.equal(document.roles[0].label, 'Alpha');
  assert.deepEqual(document.roles[0].sourceColors, ['#111111']);
  assert.equal(document.roles[0].order, 10);
  assert.deepEqual(document.preserve, ['#FFFFFF']);
  assert.deepEqual(document.overrides, { alpha: 'beta' });
  assert.equal(JSON.stringify(source), snapshot);
});

test('buildPaletteDocument ignores invalid colours and keeps the source colour', () => {
  const source = {
    version: 1,
    roles: [
      {
        id: 'alpha',
        label: 'Alpha',
        color: '#111111',
        sourceColors: ['#111111'],
        order: 10
      }
    ],
    preserve: [],
    overrides: {}
  };
  const document = JSON.parse(colour.buildPaletteDocument(source, { alpha: 'nope' }));
  assert.equal(document.roles[0].color, '#111111');
});
