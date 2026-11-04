'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseColour,
  tryParseColour,
  canonicalColour,
  formatColour,
  compositeColour,
  relativeLuminance,
  contrastRatio
} = require('./lib/colour');
const {
  ThemeError,
  loadTheme,
  compileTheme,
  applyTheme,
  applyThemeFile
} = require('./lib/theme');

const root = path.resolve(__dirname, '..');
const darkThemePath = path.join(root, 'themes', 'dark', 'theme.json');
const fixtures = path.join(root, 'tests', 'fixtures', 'theme');

function styleWith(layers, extras = {}) {
  return { version: 8, layers, ...extras };
}

function layerPaint(style, id, property) {
  const layer = style.layers.find((entry) => entry.id === id);
  assert.ok(layer, `expected layer ${id}`);
  return layer.paint[property];
}

function colourCount(style) {
  const properties = new Set([
    'background-color',
    'fill-color',
    'fill-outline-color',
    'line-color',
    'icon-color',
    'icon-halo-color',
    'text-color',
    'text-halo-color'
  ]);
  let count = 0;

  for (const layer of style.layers) {
    for (const [property, value] of Object.entries(layer.paint || {})) {
      if (!properties.has(property)) continue;
      const walk = (entry) => {
        if (typeof entry === 'string' && tryParseColour(entry)) count += 1;
        else if (Array.isArray(entry)) entry.forEach(walk);
        else if (entry && typeof entry === 'object') Object.values(entry).forEach(walk);
      };
      walk(value);
    }
  }

  return count;
}

test('colour parser handles hex forms and alpha', () => {
  assert.deepEqual(parseColour('#abc'), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(parseColour('ABC'), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(parseColour('#abcd'), { r: 170, g: 187, b: 204, a: 0.867 });
  assert.deepEqual(parseColour('#112233'), { r: 17, g: 34, b: 51, a: 1 });
  assert.deepEqual(parseColour('#11223380'), { r: 17, g: 34, b: 51, a: 0.502 });
});

test('colour parser handles rgb, rgba, space syntax and percentages', () => {
  assert.deepEqual(parseColour('rgb(255, 0, 0)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColour('RGB(255 0 0 / 50%)'), { r: 255, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(parseColour('rgba(10, 20, 30, 0.25)'), { r: 10, g: 20, b: 30, a: 0.25 });
  assert.deepEqual(parseColour('rgb(100%, 0%, 50%)'), { r: 255, g: 0, b: 128, a: 1 });
  assert.deepEqual(parseColour('rgba(0 0 0 / 25%)'), { r: 0, g: 0, b: 0, a: 0.25 });
});

test('colour parser handles hsl and hsla', () => {
  assert.deepEqual(parseColour('hsl(0, 100%, 50%)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColour('hsla(120, 100%, 25%, 0.5)'), { r: 0, g: 128, b: 0, a: 0.5 });
  assert.deepEqual(parseColour('HSL(210 50% 50% / 25%)'), { r: 64, g: 128, b: 191, a: 0.25 });
  assert.deepEqual(parseColour('hsl(-120, 100%, 50%)'), { r: 0, g: 0, b: 255, a: 1 });
  assert.deepEqual(parseColour('transparent'), { r: 0, g: 0, b: 0, a: 0 });
});

test('malformed colours are rejected', () => {
  for (const value of [
    '',
    '   ',
    'red',
    '#12',
    '#12345',
    '#gggggg',
    'rgb(300, 0, 0)',
    'rgb(0, 0)',
    'rgb(0, 0, 0, 1, 1)',
    'rgba(0, 0, 0, 2)',
    'hsl(0, 100)',
    'hsl(0, 100%, 50%, 0.5, 1)',
    'hsl(0 100% 50% / 120%)',
    null,
    undefined,
    { r: 1, g: 2 }
  ]) {
    assert.throws(() => parseColour(value), TypeError, `${String(value)} should be rejected`);
    assert.equal(tryParseColour(value), null);
  }
});

test('canonical and output formatting are stable', () => {
  assert.equal(canonicalColour('#FF000080'), 'rgba(255, 0, 0, 0.502)');
  assert.equal(canonicalColour('hsl(0, 100%, 50%)'), 'rgba(255, 0, 0, 1)');
  assert.equal(canonicalColour('rgba(255,0,0,0.5)'), 'rgba(255, 0, 0, 0.5)');
  assert.equal(canonicalColour('transparent'), 'rgba(0, 0, 0, 0)');

  assert.equal(formatColour('#FF0000'), '#ff0000');
  assert.equal(formatColour('rgba(255, 0, 0, 0.5)'), 'rgba(255, 0, 0, 0.5)');
  assert.equal(formatColour({ r: 0, g: 128, b: 0, a: 1 }), '#008000');
});

test('contrast helpers return known WCAG and branding ratios', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 1e-9);
  assert.ok(contrastRatio('#eeeeee', '#000b00') > 15);
  assert.ok(contrastRatio('#9bb0a3', '#000b00') > 4.5);
  assert.ok(contrastRatio('#0dd70d', '#000b00') > 7);

  const composite = compositeColour('rgba(255, 255, 255, 0.5)', '#000000');
  assert.ok(composite.r > 120 && composite.r < 130);
  assert.ok(Math.abs(relativeLuminance('#ffffff') - 1) < 1e-9);
});

test('rules match exact layers, globs and properties', () => {
  const style = styleWith([
    { id: 'water', paint: { 'fill-color': '#112233', 'line-color': '#112233' } },
    { id: 'park-1', paint: { 'fill-color': '#445566' } }
  ]);
  const theme = {
    version: 1,
    name: 'matching',
    tokens: { sea: '#0000ff', green: '#00ff00' },
    rules: [
      { layer: 'water', property: 'fill-color', to: '@sea' },
      { layer: 'park-*', property: 'fill-color', to: '@green' }
    ]
  };
  const output = applyTheme(style, theme, { strict: false });

  assert.equal(layerPaint(output, 'water', 'fill-color'), '#0000ff');
  assert.equal(layerPaint(output, 'water', 'line-color'), '#112233');
  assert.equal(layerPaint(output, 'park-1', 'fill-color'), '#00ff00');
});

test('glob wildcards are escaped and only * is special', () => {
  const style = styleWith([
    { id: 'road.one', paint: { 'fill-color': '#111111' } },
    { id: 'roadXone', paint: { 'fill-color': '#222222' } }
  ]);
  const theme = {
    version: 1,
    name: 'escaped',
    tokens: {},
    rules: [{ layer: 'road.*', property: 'fill-color', to: '#ff0000' }]
  };
  const output = applyTheme(style, theme, { strict: false });

  assert.equal(layerPaint(output, 'road.one', 'fill-color'), '#ff0000');
  assert.equal(layerPaint(output, 'roadXone', 'fill-color'), '#222222');
});

test('from filters by canonical colour and first match wins', () => {
  const style = styleWith([{ id: 'water', paint: { 'fill-color': '#112233' } }]);
  const theme = {
    version: 1,
    name: 'order',
    tokens: {},
    rules: [
      { layer: '*', property: 'fill-color', to: '#ff0000' },
      { layer: 'water', property: 'fill-color', to: '#00ff00' }
    ]
  };

  assert.equal(layerPaint(applyTheme(style, theme), 'water', 'fill-color'), '#ff0000');

  const specificFirst = {
    ...theme,
    rules: [...theme.rules].reverse()
  };
  assert.equal(layerPaint(applyTheme(style, specificFirst), 'water', 'fill-color'), '#00ff00');

  const fromTheme = {
    version: 1,
    name: 'from',
    tokens: {},
    rules: [{ layer: '*', property: 'fill-color', from: 'rgb(17, 34, 51)', to: '#abcdef' }]
  };
  assert.equal(layerPaint(applyTheme(style, fromTheme), 'water', 'fill-color'), '#abcdef');
});

test('from mismatch leaves the literal unchanged in non-strict mode', () => {
  const style = styleWith([{ id: 'water', paint: { 'fill-color': '#112233' } }]);
  const theme = {
    version: 1,
    name: 'from-miss',
    tokens: {},
    rules: [{ layer: 'water', property: 'fill-color', from: '#000000', to: '#ff0000' }]
  };

  assert.equal(
    layerPaint(applyTheme(style, theme, { strict: false }), 'water', 'fill-color'),
    '#112233'
  );
  assert.equal(
    layerPaint(applyTheme(style, compileTheme(theme), { strict: false }), 'water', 'fill-color'),
    '#112233'
  );
  assert.throws(() => applyTheme(style, theme), ThemeError);

  const fallThrough = {
    version: 1,
    name: 'from-fall-through',
    tokens: {},
    rules: [
      { layer: 'water', property: 'fill-color', from: '#000000', to: '#ff0000' },
      { layer: '*', property: 'fill-color', from: '#112233', to: '#00ff00' }
    ]
  };
  assert.equal(layerPaint(applyTheme(style, fallThrough), 'water', 'fill-color'), '#00ff00');
});

test('preserveAlpha controls alpha composition', () => {
  const style = styleWith([{ id: 'halo', paint: { 'text-halo-color': 'rgba(10, 20, 30, 0.4)' } }]);
  const opaque = {
    version: 1,
    name: 'opaque',
    tokens: {},
    rules: [{ layer: '*', property: 'text-halo-color', to: '#ffffff' }]
  };
  const translucent = {
    version: 1,
    name: 'translucent',
    tokens: {},
    rules: [{ layer: '*', property: 'text-halo-color', to: 'rgba(255, 0, 0, 0.5)' }]
  };

  assert.equal(
    layerPaint(applyTheme(style, opaque), 'halo', 'text-halo-color'),
    'rgba(255, 255, 255, 0.4)'
  );
  assert.equal(
    layerPaint(applyTheme(style, translucent), 'halo', 'text-halo-color'),
    'rgba(255, 0, 0, 0.2)'
  );

  const replaceAlpha = {
    ...translucent,
    rules: [{ layer: '*', property: 'text-halo-color', to: 'rgba(255, 0, 0, 0.5)', preserveAlpha: false }]
  };
  assert.equal(
    layerPaint(applyTheme(style, replaceAlpha), 'halo', 'text-halo-color'),
    'rgba(255, 0, 0, 0.5)'
  );
});

test('preserveAlpha handles opaque and transparent alpha edges', () => {
  const opaqueSource = styleWith([{ id: 'halo', paint: { 'text-halo-color': '#102030' } }]);
  const translucentTarget = {
    version: 1,
    name: 'opaque-to-translucent',
    tokens: {},
    rules: [{ layer: '*', property: 'text-halo-color', to: 'rgba(255, 0, 0, 0.5)' }]
  };
  assert.equal(
    layerPaint(applyTheme(opaqueSource, translucentTarget), 'halo', 'text-halo-color'),
    'rgba(255, 0, 0, 0.5)'
  );

  const transparentSource = styleWith([
    { id: 'halo', paint: { 'text-halo-color': 'transparent' } }
  ]);
  const opaqueTarget = {
    version: 1,
    name: 'transparent-to-opaque',
    tokens: {},
    rules: [{ layer: '*', property: 'text-halo-color', to: '#ffffff' }]
  };
  assert.equal(
    layerPaint(applyTheme(transparentSource, opaqueTarget), 'halo', 'text-halo-color'),
    'rgba(255, 255, 255, 0)'
  );
});

test('recursive walking replaces colours in expressions but not keywords', () => {
  const style = styleWith([
    {
      id: 'conditional',
      paint: {
        'fill-color': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0,
          '#000000',
          10,
          ['match', ['get', 'kind'], 'water', '#111111', ['case', ['has', 'park'], '#222222', '#333333']]
        ]
      }
    }
  ]);
  const theme = {
    version: 1,
    name: 'expressions',
    tokens: {},
    rules: [{ layer: '*', property: 'fill-color', to: '#ff0000' }]
  };
  const output = applyTheme(style, theme);

  assert.deepEqual(layerPaint(output, 'conditional', 'fill-color'), [
    'interpolate',
    ['linear'],
    ['zoom'],
    0,
    '#ff0000',
    10,
    ['match', ['get', 'kind'], 'water', '#ff0000', ['case', ['has', 'park'], '#ff0000', '#ff0000']]
  ]);
});

test('hex-looking expression operands are preserved', () => {
  const style = styleWith([
    {
      id: 'conditional',
      paint: {
        'fill-color': [
          'match',
          ['get', 'class'],
          'cafe',
          '#111111',
          'beef',
          '#222222',
          '#333333'
        ]
      }
    }
  ]);
  const theme = {
    version: 1,
    name: 'operands',
    tokens: {},
    rules: [{ layer: '*', property: 'fill-color', to: '#ff0000' }]
  };
  const output = applyTheme(style, theme);

  assert.deepEqual(layerPaint(output, 'conditional', 'fill-color'), [
    'match',
    ['get', 'class'],
    'cafe',
    '#ff0000',
    'beef',
    '#ff0000',
    '#ff0000'
  ]);
});

test('object stops are walked recursively', () => {
  const style = styleWith([
    {
      id: 'building',
      paint: {
        'fill-color': { base: 1, stops: [[13, '#111111'], [16, '#222222']] }
      }
    }
  ]);
  const theme = {
    version: 1,
    name: 'stops',
    tokens: {},
    rules: [{ layer: '*', property: 'fill-color', to: '#00ff00' }]
  };
  const output = applyTheme(style, theme);

  assert.deepEqual(layerPaint(output, 'building', 'fill-color'), {
    base: 1,
    stops: [[13, '#00ff00'], [16, '#00ff00']]
  });
});

test('only allowlisted paint colour properties are changed', () => {
  const style = {
    version: 8,
    sources: { openmaptiles: { type: 'vector', url: 'https://example.test/tiles' } },
    metadata: { note: '#000000' },
    layers: [
      {
        id: 'road',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'primary'],
        layout: { visibility: 'visible', 'line-cap': 'round' },
        paint: {
          'line-color': '#111111',
          'custom-color': '#123456',
          'line-width': 2,
          'line-dasharray': [1, 2]
        }
      }
    ]
  };
  const before = JSON.stringify(style);
  const theme = {
    version: 1,
    name: 'scope',
    tokens: {},
    rules: [{ layer: '*', property: 'line-color', to: '#eeeeee' }]
  };
  const output = applyTheme(style, theme);

  assert.equal(output.layers[0].paint['line-color'], '#eeeeee');
  assert.equal(output.layers[0].paint['custom-color'], '#123456');
  assert.deepEqual(output.layers[0].paint['line-width'], 2);
  assert.deepEqual(output.layers[0].paint['line-dasharray'], [1, 2]);
  assert.deepEqual(output.layers[0].layout, style.layers[0].layout);
  assert.deepEqual(output.layers[0].filter, style.layers[0].filter);
  assert.equal(output.layers[0].id, 'road');
  assert.equal(output.layers[0].source, 'openmaptiles');
  assert.deepEqual(output.sources, style.sources);
  assert.deepEqual(output.metadata, style.metadata);
  assert.equal(JSON.stringify(style), before);
});

test('identity mode clones without mutating the input', () => {
  const style = styleWith([{ id: 'water', paint: { 'fill-color': '#112233' } }]);
  const before = JSON.stringify(style);
  const output = applyTheme(style, null);

  assert.deepEqual(output, style);
  assert.notEqual(output, style);
  assert.equal(JSON.stringify(style), before);

  output.layers[0].paint['fill-color'] = '#ffffff';
  assert.equal(style.layers[0].paint['fill-color'], '#112233');

  const empty = loadTheme(path.join(fixtures, 'empty.json'));
  const cloned = applyTheme(style, empty, { strict: false });
  assert.deepEqual(cloned, style);
  assert.notEqual(cloned, style);
  assert.equal(JSON.stringify(style), before);
});

test('strict mode reports every unmatched layer, property and literal once', () => {
  const style = styleWith([
    { id: 'Known', paint: { 'fill-color': '#000000' } },
    {
      id: 'Alpha',
      paint: {
        'fill-color': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0,
           '#111111',
           10,
           'rgb(17, 17, 17)'
        ],
        'line-color': '#222222'
      }
    },
    { id: 'Beta', paint: { 'text-color': 'rgba(51, 51, 51, 0.5)' } }
  ]);
  const theme = {
    version: 1,
    name: 'partial',
    tokens: {},
    rules: [{ layer: 'Known', property: 'fill-color', to: '#eeeeee' }]
  };

  assert.throws(
    () => applyTheme(style, theme),
    (error) => {
      assert.ok(error instanceof ThemeError);
      assert.equal(error.unmatched.length, 3);
      assert.deepEqual(
        error.unmatched.map((entry) => [entry.layer, entry.property]),
        [
          ['Alpha', 'fill-color'],
          ['Alpha', 'line-color'],
          ['Beta', 'text-color']
        ]
      );
      assert.match(error.message, /Alpha/);
      assert.match(error.message, /Beta/);
      assert.match(error.message, /line-color/);
      assert.match(error.message, /text-color/);

      const duplicate = error.unmatched.find(
        (entry) => entry.layer === 'Alpha' && entry.property === 'fill-color'
      );
      assert.equal(duplicate.literal, '#111111');
      assert.equal(duplicate.canonical, 'rgba(17, 17, 17, 1)');
      return true;
    }
  );
});

test('theme compilation rejects unknown tokens, invalid rules and colours', () => {
  const base = { version: 1, name: 'invalid', tokens: {}, rules: [] };

  assert.throws(
    () =>
      compileTheme({
        ...base,
        rules: [{ layer: '*', property: 'line-color', to: '@missing' }]
      }),
    /unknown token @missing/
  );

  assert.throws(
    () =>
      compileTheme({
        ...base,
        rules: [{ layer: '*', property: 'text-opacity', to: '#ffffff' }]
      }),
    /colour paint properties/
  );

  assert.throws(
    () =>
      compileTheme({
        ...base,
        rules: [{ layer: '*', property: 'line-color', from: 'not-a-colour', to: '#ffffff' }]
      }),
    /\.from is not a valid colour/
  );

  assert.throws(
    () =>
      compileTheme({
        ...base,
        rules: [{ layer: '*', property: 'line-color', to: '#ffffff', preserveAlpha: 'yes' }]
      }),
    /preserveAlpha must be a boolean/
  );

  assert.throws(
    () =>
      compileTheme({
        ...base,
        rules: [{ layer: '*', property: 'line-color', to: '#ffffff', unexpected: true }]
      }),
    /unknown key/
  );

  assert.throws(
    () => compileTheme({ ...base, tokens: { broken: 'red' } }),
    /Token "broken" is not a valid colour/
  );

  assert.throws(() => compileTheme({ ...base, version: 2 }), /version must be 1/);
});

test('fixture with an unmatched layer fails strict application', () => {
  const theme = path.join(fixtures, 'unmatched-layer.json');
  const style = JSON.parse(fs.readFileSync(path.join(fixtures, 'unmatched-style.json'), 'utf8'));

  assert.throws(
    () => applyThemeFile(style, theme),
    (error) => {
      assert.ok(error instanceof ThemeError);
      assert.equal(error.unmatched.length, 1);
      assert.equal(error.unmatched[0].layer, 'Missing');
      assert.equal(error.unmatched[0].property, 'line-color');
      assert.match(error.message, /Missing/);
      return true;
    }
  );
});

function representativeRawStyle() {
  return styleWith([
    { id: 'Background', type: 'background', paint: { 'background-color': 'hsl(40, 26%, 93%)' } },
    { id: 'Water', type: 'fill', paint: { 'fill-color': 'hsl(194, 45%, 77%)' } },
    { id: 'Park', type: 'fill', paint: { 'fill-color': 'hsl(125, 83%, 88%)' } },
    { id: 'Wood', type: 'fill', paint: { 'fill-color': 'hsl(102, 36%, 72%)' } },
    {
      id: 'Residential',
      type: 'fill',
      paint: {
        'fill-color': {
          stops: [
            [7, 'hsl(0, 0%, 82%)'],
            [11, 'hsl(0, 0%, 87%)'],
            [12, 'hsl(0, 2%, 88%)']
          ]
        }
      }
    },
    {
      id: 'Aeroway',
      type: 'fill',
      paint: {
        'fill-color': {
          stops: [
            [6, 'hsl(240, 8%, 88%)'],
            [12, 'hsl(53, 16%, 89%)']
          ]
        }
      }
    },
    {
      id: 'Minor rail hatching',
      type: 'line',
      paint: { 'line-color': 'hsl(0, 0%, 73%)' }
    },
    {
      id: 'Minor rail bridge hatching',
      type: 'line',
      paint: { 'line-color': 'hsl(0, 0%, 73%)' }
    },
    {
      id: 'Service road outline',
      type: 'line',
      paint: { 'line-color': 'hsl(0, 0%, 73%)' }
    },
    {
      id: 'Track road outline',
      type: 'line',
      paint: {
        'line-color': {
          stops: [
            [11, 'hsla(0, 0%, 100%, 0.5)'],
            [22, 'hsla(0, 0%, 100%, 0.7)']
          ]
        }
      }
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
    },
    {
      id: 'Secondary road link',
      type: 'line',
      paint: {
        'line-color': {
          stops: [
            [10.5, 'hsl(0, 0%, 73%)'],
            [10.6, 'hsl(63, 86%, 86%)']
          ]
        }
      }
    },
    {
      id: 'Building',
      type: 'fill',
      paint: {
        'fill-color': {
          stops: [
            [13, 'hsl(24, 19%, 84%)'],
            [16, 'hsl(26, 17%, 82%)']
          ]
        },
        'fill-outline-color': {
          stops: [
            [13, 'hsl(26, 7%, 57%)'],
            [16, 'hsl(26, 8%, 62%)']
          ]
        }
      }
    },
    {
      id: 'Primary road',
      type: 'line',
      paint: {
        'line-color': {
          stops: [
            [7, 'hsl(35, 83%, 73%)'],
            [11, 'hsl(34, 94%, 82%)']
          ]
        }
      }
    },
    {
      id: 'Highway road',
      type: 'line',
      paint: {
        'line-color': {
          stops: [
            [6, 'hsl(347, 71%, 67%)'],
            [10, 'hsl(349, 65%, 74%)']
          ]
        }
      }
    },
    {
      id: 'Major rail',
      type: 'line',
      paint: {
        'line-color': {
          stops: [
            [8, 'hsl(0, 0%, 47%)'],
            [14, 'hsl(0, 0%, 51%)']
          ]
        }
      }
    },
    {
      id: 'River labels',
      type: 'symbol',
      paint: {
        'text-color': 'hsl(210, 40%, 50%)',
        'text-halo-color': 'hsla(0, 0%, 100%, 0.8)'
      }
    },
    {
      id: 'Capital city labels',
      type: 'symbol',
      paint: {
        'text-color': {
          stops: [
            [6, 'hsl(0, 0%, 29%)'],
            [14, 'hsla(0, 0%, 13%, 1)']
          ]
        }
      }
    },
    {
      id: 'House number labels',
      type: 'symbol',
      paint: {
        'text-color': 'hsl(0, 0%, 33%)'
      }
    },
    {
      id: 'Shop',
      type: 'symbol',
      paint: {
        'icon-color': 'hsl(0, 0%, 0%)',
        'icon-halo-color': 'hsl(0, 0%, 100%)',
        'text-color': 'hsl(300, 50%, 40%)',
        'text-halo-color': 'hsl(0, 0%, 100%)'
      }
    }
  ]);
}

test('dark theme covers representative raw layers and changes every colour', () => {
  const style = representativeRawStyle();
  const before = JSON.stringify(style);
  const output = applyThemeFile(style, darkThemePath);

  assert.equal(JSON.stringify(style), before);
  assert.notEqual(JSON.stringify(output), before);
  assert.equal(colourCount(style), colourCount(output));
  assert.equal(output.layers.length, style.layers.length);

  assert.equal(layerPaint(output, 'Background', 'background-color'), '#000b00');
  assert.equal(layerPaint(output, 'Water', 'fill-color'), '#07303d');
  assert.equal(layerPaint(output, 'Park', 'fill-color'), '#0b3214');
  assert.equal(layerPaint(output, 'Wood', 'fill-color'), '#082a0e');
  assert.deepEqual(layerPaint(output, 'Residential', 'fill-color'), {
    stops: [[7, '#001800'], [11, '#001800'], [12, '#001800']]
  });
  assert.deepEqual(layerPaint(output, 'Aeroway', 'fill-color'), {
    stops: [[6, '#001c00'], [12, '#001c00']]
  });
  assert.equal(layerPaint(output, 'Minor rail hatching', 'line-color'), '#8fa295');
  assert.equal(layerPaint(output, 'Minor rail bridge hatching', 'line-color'), '#8fa295');
  assert.equal(layerPaint(output, 'Service road outline', 'line-color'), '#101f14');
  assert.deepEqual(layerPaint(output, 'Track road outline', 'line-color'), {
    stops: [
      [11, 'rgba(16, 31, 20, 0.5)'],
      [22, 'rgba(16, 31, 20, 0.7)']
    ]
  });
  assert.deepEqual(layerPaint(output, 'Track road', 'line-color'), {
    stops: [
      [12, 'rgba(76, 91, 79, 0.5)'],
      [16, '#4c5b4f']
    ]
  });
  assert.equal(layerPaint(output, 'Platform area', 'fill-color'), '#03260a');
  assert.equal(layerPaint(output, 'Platform area', 'fill-outline-color'), '#0e3111');
  assert.deepEqual(layerPaint(output, 'Secondary road link', 'line-color'), {
    stops: [
      [10.5, '#6b4e2e'],
      [10.6, '#6b4e2e']
    ]
  });
  assert.deepEqual(layerPaint(output, 'Building', 'fill-color'), {
    stops: [[13, '#0f2410'], [16, '#0f2410']]
  });
  assert.deepEqual(layerPaint(output, 'Building', 'fill-outline-color'), {
    stops: [[13, '#2a4a2e'], [16, '#2a4a2e']]
  });
  assert.deepEqual(layerPaint(output, 'Primary road', 'line-color'), {
    stops: [[7, '#b3571f'], [11, '#b3571f']]
  });
  assert.deepEqual(layerPaint(output, 'Highway road', 'line-color'), {
    stops: [[6, '#dc8f4e'], [10, '#dc8f4e']]
  });
  assert.equal(layerPaint(output, 'Major rail', 'line-color').stops[0][1], '#6b7d72');
  assert.equal(layerPaint(output, 'River labels', 'text-color'), '#79c0ff');
  assert.equal(layerPaint(output, 'River labels', 'text-halo-color'), 'rgba(0, 19, 0, 0.8)');
  assert.deepEqual(layerPaint(output, 'Capital city labels', 'text-color'), {
    stops: [[6, '#0dd70d'], [14, '#0dd70d']]
  });
  assert.equal(layerPaint(output, 'House number labels', 'text-color'), '#7f8f84');
  assert.equal(layerPaint(output, 'Shop', 'icon-color'), '#fcfaf5');
  assert.equal(layerPaint(output, 'Shop', 'icon-halo-color'), '#000b00');
  assert.equal(layerPaint(output, 'Shop', 'text-color'), '#eeeeee');
  assert.equal(layerPaint(output, 'Shop', 'text-halo-color'), '#001300');

  assert.ok(contrastRatio('#eeeeee', '#000b00') > 15);
  assert.ok(contrastRatio('#9bb0a3', '#000b00') > 4.5);
});
