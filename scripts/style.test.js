'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ThemeError, applyTheme, loadTheme } = require('./lib/theme');
const {
  ATTRIBUTION,
  DARK_SPRITE,
  GLYPHS,
  LIGHT_SPRITE,
  TILE_URL,
  createDarkStyle,
  createLightStyle,
  stripIdentity,
  stripMutableFields,
  validateStyles
} = require('./style');

const root = path.resolve(__dirname, '..');
const themePath = path.join(root, 'themes', 'dark', 'theme.json');
const commit = '6c11838d38030148832c039c2ea367274db86a87';

function rawStyle() {
  return {
    version: 8,
    name: 'OSM OpenMapTiles',
    id: 'openmaptiles',
    center: [0, 0],
    zoom: 1,
    bearing: 0,
    pitch: 0,
    metadata: { note: 'preserve me' },
    sources: {
      openmaptiles: { type: 'vector', url: 'mbtiles:///data/tiles.mbtiles' },
      attribution: { type: 'vector', attribution: 'Upstream attribution' }
    },
    glyphs: '{fontstack}/{range}.pbf',
    sprite: 'sprite',
    layers: [
      {
        id: 'Background',
        type: 'background',
        paint: { 'background-color': 'hsl(40, 26%, 93%)' }
      },
      {
        id: 'Water',
        type: 'fill',
        paint: { 'fill-color': 'hsl(194, 45%, 77%)' }
      },
      {
        id: 'Track road',
        type: 'line',
        paint: {
          'line-color': {
            stops: [
              [12, 'hsla(42, 61%, 41%, 0.5)'],
              [16, 'hsl(42, 61%, 41%)']
            ]
          }
        }
      },
      {
        id: 'Platform area',
        type: 'fill',
        paint: {
          'fill-color': 'hsl(0, 0%, 73%)',
          'fill-outline-color': 'hsl(0, 0%, 50%)'
        }
      }
    ]
  };
}

function theme() {
  return loadTheme(themePath);
}

test('light output is a layer-for-layer no-op of the raw recompose', () => {
  const raw = rawStyle();
  const before = JSON.stringify(raw);
  const light = createLightStyle(raw, { commit });

  assert.deepEqual(light.layers, raw.layers);
  assert.deepEqual(stripMutableFields(light), stripMutableFields(raw));
  assert.equal(JSON.stringify(raw), before);

  assert.equal(light.name, 'Basemap Light');
  assert.equal(light.sprite, LIGHT_SPRITE);
  assert.equal(light.glyphs, GLYPHS);
  assert.equal(light.sources.openmaptiles.url, TILE_URL);
  assert.equal(light.sources.openmaptiles.attribution, ATTRIBUTION);
  assert.equal(light.metadata.note, 'preserve me');
  assert.equal(light.metadata['ogis:theme'], 'light');
  assert.equal(light.metadata['ogis:upstreamCommit'], commit);
});

test('only the allowlisted top-level fields differ from the raw style', () => {
  const raw = rawStyle();
  const light = createLightStyle(raw, { commit });
  const differing = [];

  for (const key of new Set([...Object.keys(raw), ...Object.keys(light)])) {
    if (JSON.stringify(raw[key]) !== JSON.stringify(light[key])) differing.push(key);
  }

  assert.deepEqual(differing.sort(), ['glyphs', 'metadata', 'name', 'sources', 'sprite']);
});

test('dark output is the light style with strict colour transformations', () => {
  const raw = rawStyle();
  const before = JSON.stringify(raw);
  const light = createLightStyle(raw, { commit });
  const dark = createDarkStyle(light, theme(), { commit });

  assert.equal(JSON.stringify(raw), before);

  assert.equal(dark.name, 'Basemap Dark');
  assert.equal(dark.sprite, DARK_SPRITE);
  assert.equal(dark.glyphs, GLYPHS);
  assert.equal(dark.sources.openmaptiles.url, TILE_URL);
  assert.equal(dark.sources.openmaptiles.attribution, ATTRIBUTION);
  assert.equal(dark.metadata.note, 'preserve me');
  assert.equal(dark.metadata['ogis:theme'], 'dark');
  assert.equal(dark.metadata['ogis:upstreamCommit'], commit);

  assert.deepEqual(stripIdentity(dark), stripIdentity(light));
  assert.deepEqual(dark.layers, applyTheme(light, theme()).layers);

  const trackRoad = dark.layers.find((layer) => layer.id === 'Track road');
  assert.deepEqual(trackRoad.paint['line-color'], {
    stops: [
      [12, 'rgba(76, 91, 79, 0.5)'],
      [16, '#4c5b4f']
    ]
  });

  const platform = dark.layers.find((layer) => layer.id === 'Platform area');
  assert.equal(platform.paint['fill-outline-color'], '#0e3111');
});

test('strict theming fails on an unmatched colour literal', () => {
  const raw = rawStyle();
  raw.layers.push({
    id: 'Mystery',
    type: 'fill',
    paint: { 'fill-color': '#123456' }
  });
  const light = createLightStyle(raw, { commit });

  assert.throws(
    () => createDarkStyle(light, theme(), { commit }),
    (error) => {
      assert.ok(error instanceof ThemeError);
      assert.equal(error.unmatched.length, 1);
      assert.equal(error.unmatched[0].layer, 'Mystery');
      assert.equal(error.unmatched[0].literal, '#123456');
      return true;
    }
  );
});

test('validation rejects publication changes outside the allowlist', () => {
  const raw = rawStyle();
  const light = createLightStyle(raw, { commit });
  const dark = createDarkStyle(light, theme(), { commit });

  assert.equal(validateStyles({ rawStyle: raw, darkStyle: dark, lightStyle: light, theme: theme(), commit }), true);

  const tampered = JSON.parse(JSON.stringify(light));
  tampered.zoom = 4;
  assert.throws(
    () => validateStyles({ rawStyle: raw, darkStyle: dark, lightStyle: tampered, theme: theme(), commit }),
    /outside the publication allowlist/
  );
});

test('validation rejects a dark style that is not the strict transformation', () => {
  const raw = rawStyle();
  const light = createLightStyle(raw, { commit });
  const dark = createDarkStyle(light, theme(), { commit });
  dark.layers[0].paint['background-color'] = '#ffffff';

  assert.throws(
    () => validateStyles({ rawStyle: raw, darkStyle: dark, lightStyle: light, theme: theme(), commit }),
    /strict theme transformations/
  );
});
