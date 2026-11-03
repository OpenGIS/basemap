'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildModel } = require('./lib/palette');

const root = path.resolve(__dirname, '..');
const model = buildModel({ root });
const icon = (name) => model.icons.find((entry) => entry.name === name);
const rowsFor = (className) => model.rows.filter((row) => row.class === className);
const role = (id) => model.roles.find((entry) => entry.id === id);
const roleColours = model.roles.flatMap((entry) =>
  Array.from(new Set([entry.color, ...entry.sourceColors]))
);

test('class catalogue contains schema, runtime and dynamic classes', () => {
  assert.equal(model.summary.classes, 68);
  assert.equal(model.summary.schemaClasses, 36);
  assert.equal(model.summary.runtimeClasses, 32);
  assert.equal(model.summary.dynamicClasses, 3);
  assert.equal(model.summary.phantomClasses, 3);
  assert.equal(model.summary.iconCapableClasses, 57);
  assert.equal(model.summary.schema.classes, 36);
  assert.equal(model.summary.schema.rows, 208);

  const shop = model.classes.find((entry) => entry.name === 'shop');
  assert.equal(shop.schemaBacked, true);
  assert.equal(shop.dynamic, false);
  assert.equal(shop.subclasses.length, 61);
  assert.ok(shop.subclasses.includes('accessories'));
  assert.ok(shop.subclasses.includes('wholesale'));

  const office = model.classes.find((entry) => entry.name === 'office');
  assert.equal(office.schemaBacked, true);
  assert.equal(office.subclasses.length, 60);
  assert.ok(office.subclasses.includes('accountant'));
  assert.ok(office.subclasses.includes('wedding_planner'));

  const bakery = model.classes.find((entry) => entry.name === 'bakery');
  assert.equal(bakery.schemaBacked, false);
  assert.equal(bakery.runtime, true);
  assert.equal(bakery.dynamic, false);

  for (const name of ['information', 'pitch', 'place_of_worship']) {
    const entry = model.classes.find((candidate) => candidate.name === name);
    assert.equal(entry.runtime, true, `${name} should be runtime`);
    assert.equal(entry.dynamic, true, `${name} should be dynamic`);
  }
});

test('mapping value lists are parsed from source', () => {
  assert.equal(Object.keys(model.mappings).length, 14);
  assert.equal(
    Object.values(model.mappings).reduce((total, values) => total + values.length, 0),
    339
  );
  assert.equal(model.mappings.sport.length, 78);
  assert.equal(model.mappings.shop.includes('seafood'), false);
});

test('railway and aerialway catalogue shapes include mapping keys', () => {
  const railway = rowsFor('railway');
  assert.deepEqual(
    railway.map((row) => row.subclass),
    ['halt', 'station', 'subway', 'tram_stop']
  );
  assert.equal(railway.find((row) => row.subclass === 'station').mappingKey, 'railway');
  assert.equal(railway.find((row) => row.subclass === 'halt').mappingKey, undefined);

  const aerialway = rowsFor('aerialway');
  assert.equal(aerialway.length, 1);
  assert.equal(aerialway[0].subclass, 'station');
  assert.equal(aerialway[0].mappingKey, 'aerialway');
});

test('style layers and both feature sets match the expected counts', () => {
  assert.equal(model.summary.layers, 23);
  assert.equal(model.summary.iconLayers, 17);
  assert.equal(model.summary.textOnlyLayers, 6);

  assert.equal(model.summary.features, 331);
  assert.deepEqual(model.summary.featureProvenance, {
    schema: 208,
    runtime: 29,
    dynamic: 94
  });
  assert.equal(model.summary.resolved, 251);
  assert.equal(model.summary.textOnly, 11);
  assert.equal(model.summary.noLayer, 69);

  assert.deepEqual(model.summary.schema, {
    classes: 36,
    rows: 208,
    resolved: 128,
    textOnly: 11,
    noLayer: 69,
    icons: 89,
    selectedNames: 100,
    missingSprite: 11
  });
});

test('complete POI candidate set and schema subset match expected icons', () => {
  assert.equal(model.summary.candidates, 220);
  assert.equal(model.summary.existingIcons, 129);
  assert.equal(model.summary.missingSprite, 91);
  assert.equal(model.selectedIcons.length, 220);
  assert.equal(model.poiIcons.length, 129);
  assert.equal(model.selectedIcons.filter((entry) => entry.inSprite).length, 129);

  const missingIssue = model.issues.find((issue) => issue.code === 'missing-sprite');
  assert.ok(missingIssue);
  assert.equal(missingIssue.count, 91);
  assert.equal(missingIssue.icons.length, 91);
  for (const name of [
    'alpine_hut',
    'american_football',
    'bed_and_breakfast',
    'dormitory',
    'dot',
    'food_court',
    'golf_course',
    'parcel_locker',
    'ruins',
    'soccer',
    'stadium'
  ]) {
    assert.ok(missingIssue.icons.includes(name), `${name} should be missing from the sprite`);
  }
});

test('runtime families generate the expected features', () => {
  assert.equal(rowsFor('pitch').length, 78);
  assert.equal(rowsFor('information').length, 5);
  assert.equal(rowsFor('place_of_worship').length, 11);

  for (const [className, size] of [
    ['pitch', 78],
    ['information', 5],
    ['place_of_worship', 11]
  ]) {
    for (const row of rowsFor(className)) {
      assert.equal(row.provenance, 'dynamic');
      assert.equal(row.classSource, 'dynamic');
      assert.equal(row.schemaRow, false);
      assert.equal(row.status, 'resolved');
      assert.ok(row.icon);
      assert.ok(Array.isArray(row.styleLayers));
    }
    assert.equal(rowsFor(className).length, size);
  }
});

test('runtime classes resolve through their icon layers', () => {
  const expected = {
    recycling: 'recycling',
    waste_basket: 'waste_basket',
    drinking_water: 'drinking_water',
    toilets: 'toilets',
    gate: 'gate',
    stile: 'stile',
    playground: 'playground',
    pharmacy: 'pharmacy',
    museum: 'museum',
    restaurant: 'restaurant',
    parking: 'parking'
  };

  const religion = rowsFor('place_of_worship').find((row) => row.subclass === 'buddhist');
  assert.equal(religion.provenance, 'dynamic');
  assert.equal(religion.classSource, 'dynamic');
  assert.equal(religion.status, 'resolved');
  assert.equal(religion.icon, 'buddhist');

  for (const [className, iconName] of Object.entries(expected)) {
    const row = rowsFor(className)[0];
    assert.ok(row, `${className} should be a feature`);
    assert.equal(row.provenance, 'runtime');
    assert.equal(row.classSource, 'runtime');
    assert.equal(row.schemaRow, false);
    assert.equal(row.status, 'resolved');
    assert.equal(row.icon, iconName);
    assert.equal(row.inSprite, true);
    assert.ok(row.roleId);
  }
});

test('phantom literals are flagged but are not features', () => {
  assert.deepEqual(
    model.phantoms.map((entry) => entry.name),
    ['arts_centre', 'gallery', 'seafood']
  );
  assert.ok(model.phantoms.every((entry) => entry.phantom));
  for (const name of ['arts_centre', 'gallery', 'seafood']) {
    assert.equal(model.rows.some((row) => row.class === name), false);
  }

  const artGallery = rowsFor('art_gallery');
  assert.ok(artGallery.some((row) => row.subclass === 'arts_centre'));
  assert.ok(artGallery.some((row) => row.subclass === 'gallery'));

  const phantomIssues = model.issues.filter((issue) => issue.code === 'phantom-class-literal');
  assert.equal(phantomIssues.length, 3);
});

test('effective fills follow inline styles and the documented quirks', () => {
  assert.equal(icon('camping').primaryFill, '#0092DA');
  assert.equal(icon('restaurant').primaryFill, '#C77400');
  assert.equal(icon('pharmacy').primaryFill, '#BF0000');
  assert.equal(icon('chemist').primaryFill, '#AC39AC');
  assert.equal(icon('books').primaryFill, '#AC39AC');

  for (const name of [
    'buddhist',
    'christian',
    'hinduist',
    'jewish',
    'muslim',
    'shintoist',
    'sikhist',
    'taoist'
  ]) {
    assert.equal(icon(name).primaryFill, '#000000', `${name} should default to black`);
  }

  assert.equal(new Set(model.icons.flatMap((entry) => entry.distinctFills)).size, 45);
});

test('stroke-only and pattern-fill icons are reported separately', () => {
  const strokeOnly = model.icons
    .filter((entry) => entry.strokeOnly)
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(strokeOnly, [
    'grey_vertical_hatch',
    'plant_nursery',
    'spring',
    'vineyard'
  ]);

  const pattern = model.icons
    .filter((entry) => entry.pattern)
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(pattern, [
    'beach',
    'beach_coarse',
    'rock_overlay',
    'scree_overlay',
    'scrub',
    'wetland',
    'wetland_bog',
    'wetland_mangrove',
    'wetland_marsh',
    'wetland_reed',
    'wetland_swamp'
  ]);
});

test('role counts use only existing selectable icons', () => {
  assert.deepEqual(model.summary.roleCounts, {
    transport: 14,
    food: 7,
    health: 4,
    shops: 58,
    public: 24,
    infrastructure: 3,
    barriers: 2,
    leisure: 1,
    sport: 3,
    terminals: 2,
    worship: 11
  });

  assert.deepEqual(role('infrastructure').icons, ['map', 'terminal', 'waste_basket']);
  assert.deepEqual(role('barriers').icons, ['gate', 'stile']);
  assert.deepEqual(role('worship').icons, [
    'buddhist',
    'christian',
    'cross',
    'hinduist',
    'jewish',
    'multifaith',
    'muslim',
    'place_of_worship',
    'shintoist',
    'sikhist',
    'taoist'
  ]);

  for (const entry of model.roles) {
    assert.ok(entry.iconCount > 0, `${entry.id} should map at least one POI icon`);
  }

  const unresolved = model.poiIcons.filter((entry) => !entry.pattern && !entry.roleId);
  assert.deepEqual(unresolved, []);
  assert.equal(new Set(roleColours).size, roleColours.length);
  assert.deepEqual(
    model.issues.filter((issue) => issue.code === 'duplicate-role-hex'),
    []
  );
});

test('features expose provenance, fallback and resolution fields', () => {
  const wine = model.rows.find((row) => row.class === 'alcohol_shop' && row.subclass === 'wine');
  assert.equal(wine.provenance, 'schema');
  assert.equal(wine.classSource, 'schema');
  assert.equal(wine.schemaRow, true);
  assert.equal(wine.icon, 'dot');
  assert.equal(wine.fallback, 'dot');
  assert.equal(wine.inSprite, false);

  const supermarket = model.rows.find(
    (row) => row.class === 'grocery' && row.subclass === 'supermarket'
  );
  assert.equal(supermarket.icon, 'supermarket');
  assert.equal(supermarket.fallback, 'subclass');

  const fallbackToClass = model.rows.find(
    (row) => row.class === 'shop' && row.subclass === 'antiques'
  );
  assert.equal(fallbackToClass.icon, 'shop');
  assert.equal(fallbackToClass.fallback, 'class');

  const waste = model.rows.find((row) => row.class === 'waste_basket');
  assert.equal(waste.roleId, 'infrastructure');
  assert.ok(waste.styleLayers.includes('Waste'));
});

test('validation has no hard errors and reports expected warnings', () => {
  assert.deepEqual(
    model.issues.filter((issue) => issue.level === 'error'),
    []
  );

  assert.equal(model.issues.filter((issue) => issue.code === 'missing-sprite').length, 1);
  assert.equal(model.issues.filter((issue) => issue.code === 'phantom-class-literal').length, 3);
  assert.equal(model.issues.filter((issue) => issue.code === 'icon-pattern-fill').length, 11);
  assert.equal(model.issues.filter((issue) => issue.code === 'row-no-layer').length, 69);
  assert.equal(model.issues.filter((issue) => issue.code === 'text-only-layer').length, 6);
});
