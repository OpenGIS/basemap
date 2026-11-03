'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const appRoot = path.join(root, 'app');
const palettePath = path.join(appRoot, 'assets', 'data', 'palette.json');
const paletteData = JSON.parse(fs.readFileSync(palettePath, 'utf8'));
const allRoles = paletteData.palette.roles.map((role) => role.id);

let colour;
let filters;

test.before(async () => {
  colour = await import(pathToFileURL(path.join(appRoot, 'utils', 'colour.js')).href);
  filters = await import(pathToFileURL(path.join(appRoot, 'utils', 'filters.js')).href);
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

test('filterPalette reports the full source counts', () => {
  const result = filters.filterPalette(paletteData, { roles: allRoles });

  assert.equal(result.existingCount, 129);
  assert.equal(result.existingTotal, 129);
  assert.equal(result.classCount, 57);
  assert.equal(result.missingCount, 91);
  assert.equal(result.missingTotal, 91);
  assert.equal(result.missingGroups.length, 13);
  assert.deepEqual(result.roles.map((role) => role.id), allRoles);
});

test('filterPalette searches role labels and ids', () => {
  const result = filters.filterPalette(paletteData, {
    roles: allRoles,
    search: 'food and drink'
  });

  assert.deepEqual(result.roles.map((role) => role.id), ['food']);
  assert.equal(result.existingCount, 7);
  assert.equal(result.classCount, 6);
});

test('filterPalette searches classes, icons, subclasses, mapping keys and layers', () => {
  const byClass = filters.filterPalette(paletteData, { roles: allRoles, search: 'pharmacy' });
  assert.deepEqual(byClass.roles.map((role) => role.id), ['health']);
  assert.equal(byClass.roles[0].classes[0].name, 'pharmacy');

  const byIcon = filters.filterPalette(paletteData, { roles: allRoles, search: 'hotel' });
  assert.ok(byIcon.roles[0].classes.some((group) => group.icons.some((icon) => icon.name === 'hotel')));

  const bySubclass = filters.filterPalette(paletteData, {
    roles: allRoles,
    search: 'bus_station'
  });
  assert.ok(
    bySubclass.roles[0].classes.some((group) =>
      group.icons.some((icon) => icon.subclasses.includes('bus_station'))
    )
  );

  const byMappingKey = filters.filterPalette(paletteData, {
    roles: allRoles,
    search: 'amenity'
  });
  assert.ok(
    byMappingKey.roles.some((role) =>
      role.classes.some((group) => group.icons.some((icon) => icon.name === 'bicycle_parking'))
    )
  );

  const byLayer = filters.filterPalette(paletteData, { roles: allRoles, search: 'Ferry' });
  assert.deepEqual(byLayer.roles.map((role) => role.id), ['terminals']);
  assert.equal(byLayer.existingCount, 1);
});

test('filterPalette applies role selection to existing icons only', () => {
  const result = filters.filterPalette(paletteData, { roles: ['food'] });

  assert.deepEqual(result.roles.map((role) => role.id), ['food']);
  assert.equal(result.existingCount, 7);
  assert.equal(result.classCount, 6);
  assert.equal(result.missingCount, 91);

  const none = filters.filterPalette(paletteData, { roles: [] });
  assert.deepEqual(none.roles, []);
  assert.equal(none.existingCount, 0);
  assert.equal(none.missingCount, 91);
});

test('filterPalette applies provenance at class level', () => {
  const result = filters.filterPalette(paletteData, {
    roles: allRoles,
    provenance: 'schema'
  });

  assert.ok(result.roles.length > 0);
  assert.ok(result.existingCount < 129);
  for (const role of result.roles) {
    for (const group of role.classes) assert.equal(group.provenance, 'schema');
  }
});

test('filterPalette applies layer and class filters to icons', () => {
  const byLayer = filters.filterPalette(paletteData, { roles: allRoles, layer: 'Shop' });
  assert.ok(byLayer.roles.some((role) => role.id === 'shops'));
  assert.equal(byLayer.existingCount, 57);
  for (const role of byLayer.roles) {
    for (const group of role.classes) {
      for (const icon of group.icons) assert.ok(icon.layers.includes('Shop'));
    }
  }

  const byClass = filters.filterPalette(paletteData, {
    roles: allRoles,
    className: 'pharmacy'
  });
  assert.deepEqual(byClass.roles.map((role) => role.id), ['health']);
  assert.deepEqual(byClass.roles[0].classes.map((group) => group.name), ['pharmacy']);
  assert.equal(byClass.existingCount, 1);
});

test('filterPalette applies the status segmented control', () => {
  const existing = filters.filterPalette(paletteData, {
    roles: allRoles,
    status: 'existing'
  });
  assert.equal(existing.missingCount, 0);
  assert.deepEqual(existing.missingGroups, []);

  const missing = filters.filterPalette(paletteData, {
    roles: allRoles,
    status: 'missing'
  });
  assert.deepEqual(missing.roles, []);
  assert.equal(missing.existingCount, 0);
  assert.equal(missing.missingCount, 91);
  assert.equal(missing.missingGroups.length, 13);

  const all = filters.filterPalette(paletteData, {
    roles: allRoles,
    status: 'all'
  });
  assert.equal(all.existingCount, 129);
  assert.equal(all.missingCount, 91);
});

test('filterPalette filters missing names by search and class', () => {
  const bySearch = filters.filterPalette(paletteData, {
    roles: allRoles,
    status: 'missing',
    search: 'ruins'
  });
  assert.equal(bySearch.missingCount, 1);
  assert.deepEqual(bySearch.missingGroups.map((group) => group.class), ['castle']);
  assert.deepEqual(bySearch.missingGroups[0].items.map((item) => item.name), ['ruins']);

  const byClass = filters.filterPalette(paletteData, {
    roles: allRoles,
    status: 'missing',
    className: 'castle'
  });
  assert.equal(byClass.missingCount, 1);

  const bySecondaryClass = filters.filterPalette(paletteData, {
    roles: allRoles,
    status: 'missing',
    className: 'grocery'
  });
  assert.equal(bySecondaryClass.missingCount, 1);
  assert.equal(bySecondaryClass.missingGroups[0].class, 'alcohol_shop');
  assert.ok(bySecondaryClass.missingGroups[0].items[0].classes.includes('grocery'));
});

test('filterPalette counts are consistent with the returned hierarchy', () => {
  const result = filters.filterPalette(paletteData, {
    roles: allRoles,
    status: 'all'
  });
  const names = new Set();
  let classes = 0;

  for (const role of result.roles) {
    const roleNames = new Set();
    for (const group of role.classes) {
      classes += 1;
      for (const icon of group.icons) {
        names.add(icon.name);
        roleNames.add(icon.name);
      }
    }
    assert.equal(role.iconCount, roleNames.size);
    assert.equal(role.classCount, role.classes.length);
  }

  assert.equal(result.classCount, classes);
  assert.equal(result.existingCount, names.size);
  assert.equal(result.missingCount, result.missingNames.length);
});

test('filterPalette does not mutate the source data', () => {
  const snapshot = JSON.stringify(paletteData);

  filters.filterPalette(paletteData, { roles: allRoles });
  filters.filterPalette(paletteData, { roles: ['food'], search: 'hotel' });
  filters.filterPalette(paletteData, { roles: allRoles, status: 'missing', className: 'pitch' });
  filters.filterPalette(paletteData, { roles: allRoles, provenance: 'schema', layer: 'Shop' });

  assert.equal(JSON.stringify(paletteData), snapshot);
});

test('collectClassOptions and collectLayerOptions describe the current data', () => {
  const classes = filters.collectClassOptions(paletteData);
  const layers = filters.collectLayerOptions(paletteData);

  assert.deepEqual(classes, [...classes].sort());
  assert.ok(classes.includes('pharmacy'));
  assert.ok(classes.includes('castle'));
  assert.equal(new Set(classes).size, classes.length);

  assert.deepEqual(layers, [...layers].sort());
  assert.equal(layers.length, 17);
  assert.ok(layers.includes('Shop'));
  assert.equal(layers.includes('Mortuary'), false);
});
