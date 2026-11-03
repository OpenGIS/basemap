'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const paletteData = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'app', 'assets', 'data', 'palette.json'),
    'utf8'
  )
);

let mapFeatures;

test.before(async () => {
  mapFeatures = await import(
    pathToFileURL(
      path.join(__dirname, '..', 'app', 'utils', 'mapFeatures.js')
    ).href
  );
});

function feature(layerId, properties = {}) {
  return { layer: { id: layerId }, properties };
}

test('resolveIconExpression handles subclass, class, literals and null', () => {
  assert.equal(
    mapFeatures.resolveIconExpression('{subclass}', { subclass: 'cafe' }),
    'cafe'
  );
  assert.equal(
    mapFeatures.resolveIconExpression('{class}', { class: 'hospital' }),
    'hospital'
  );
  assert.equal(mapFeatures.resolveIconExpression('ferry', {}), 'ferry');
  assert.equal(mapFeatures.resolveIconExpression('camping', {}), 'camping');
  assert.equal(mapFeatures.resolveIconExpression(null, {}), null);
  assert.equal(
    mapFeatures.resolveIconExpression({ unexpected: true }, {}),
    null
  );
});

test('resolveFeature resolves a food POI by subclass', () => {
  const result = mapFeatures.resolveFeature(
    feature('Food', {
      subclass: 'restaurant',
      name_en: 'The Green Table'
    }),
    paletteData
  );

  assert.equal(result.iconName, 'restaurant');
  assert.equal(result.roleId, 'food');
  assert.equal(result.role.label, 'Food and drink');
  assert.equal(result.className, 'restaurant');
  assert.equal(result.layerId, 'Food');
  assert.equal(result.name, 'The Green Table');
  assert.equal(result.subclass, 'restaurant');
});

test('resolveFeature resolves a health POI by class', () => {
  const result = mapFeatures.resolveFeature(
    feature('Health', { class: 'pharmacy', name: 'High Street Pharmacy' }),
    paletteData
  );

  assert.equal(result.iconName, 'pharmacy');
  assert.equal(result.roleId, 'health');
  assert.equal(result.className, 'pharmacy');
  assert.equal(result.name, 'High Street Pharmacy');
  assert.equal(result.subclass, 'pharmacy');
});

test('resolveFeature resolves the Shop coalesce expression in order', () => {
  const bySubclass = mapFeatures.resolveFeature(
    feature('Shop', { subclass: 'bakery', class: 'shop' }),
    paletteData
  );
  assert.equal(bySubclass.iconName, 'bakery');
  assert.equal(bySubclass.roleId, 'shops');

  const byClass = mapFeatures.resolveFeature(
    feature('Shop', { class: 'convenience' }),
    paletteData
  );
  assert.equal(byClass.iconName, 'convenience');
  assert.equal(byClass.roleId, 'shops');

  const dotOnly = mapFeatures.resolveFeature(feature('Shop', {}), paletteData);
  assert.equal(dotOnly, null);
});

test('resolveFeature resolves literal icon layers', () => {
  const ferry = mapFeatures.resolveFeature(
    feature('Ferry', { name: 'Pier' }),
    paletteData
  );
  assert.equal(ferry.iconName, 'ferry');
  assert.equal(ferry.roleId, 'terminals');
  assert.equal(ferry.className, 'ferry_terminal');

  const campsite = mapFeatures.resolveFeature(
    feature('Campsite', { name: 'Meadow Camp' }),
    paletteData
  );
  assert.equal(campsite.iconName, 'camping');
  assert.equal(campsite.roleId, 'transport');
});

test('resolveFeature resolves a transport parking POI', () => {
  const result = mapFeatures.resolveFeature(
    feature('Transport', { subclass: 'parking', name: 'Station car park' }),
    paletteData
  );

  assert.equal(result.iconName, 'parking');
  assert.equal(result.roleId, 'transport');
  assert.equal(result.className, 'parking');
  assert.equal(result.layerId, 'Transport');
});

test('resolveFeature ignores text-only layers', () => {
  const result = mapFeatures.resolveFeature(
    feature('Mortuary', { subclass: 'mortuary', name: 'Chapel of rest' }),
    paletteData
  );

  assert.equal(result, null);
});

test('resolveFeature returns null for missing icons and unknown layers', () => {
  assert.equal(
    mapFeatures.resolveFeature(
      feature('Food', { subclass: 'not_a_real_icon' }),
      paletteData
    ),
    null
  );

  assert.equal(
    mapFeatures.resolveFeature(feature('Not a layer', {}), paletteData),
    null
  );

  assert.equal(mapFeatures.resolveFeature({ properties: {} }, paletteData), null);
});
