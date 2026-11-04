'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildLocalStyle,
  prepareLocalStyle,
  removeLocalStyles,
} = require('./screenshot.js');

const scratchBase = path.join(__dirname, '..', '.opencode', 'tmp');

fs.mkdirSync(scratchBase, { recursive: true });

function scratch(name) {
  return fs.mkdtempSync(path.join(scratchBase, `screenshot-${name}-`));
}

function styleDocument(theme, sprite) {
  return JSON.stringify({
    version: 8,
    name: theme === 'dark' ? 'Basemap Dark' : 'Basemap Light',
    sources: {
      openmaptiles: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
        attribution: 'OpenFreeMap'
      }
    },
    sprite: `https://www.ogis.org/basemap/${sprite}`,
    glyphs: 'https://www.ogis.org/basemap/fonts/{fontstack}/{range}.pbf',
    metadata: { 'ogis:theme': theme },
    layers: [{ id: 'Background', type: 'background', paint: { 'background-color': '#000000' } }]
  });
}

function createSite(name) {
  const root = scratch(name);
  fs.writeFileSync(path.join(root, 'style.json'), styleDocument('dark', 'sprite'));
  fs.writeFileSync(path.join(root, 'style-light.json'), styleDocument('light', 'sprite-light'));
  return root;
}

function cleanup(t, directory) {
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
}

test('dark style maps to screenshot-style.json with a local dark sprite', (t) => {
  const root = createSite('dark');
  cleanup(t, root);

  const url = prepareLocalStyle('./style.json', 11234, { siteRoot: root });
  const local = JSON.parse(fs.readFileSync(path.join(root, 'screenshot-style.json'), 'utf8'));
  const source = JSON.parse(fs.readFileSync(path.join(root, 'style.json'), 'utf8'));

  assert.equal(url, './screenshot-style.json');
  assert.equal(local.sprite, 'http://127.0.0.1:11234/basemap/sprite');
  assert.equal(local.glyphs, 'http://127.0.0.1:11234/basemap/fonts/{fontstack}/{range}.pbf');
  assert.deepEqual(local.sources, source.sources);
  assert.deepEqual(source.sprite, 'https://www.ogis.org/basemap/sprite');
  assert.equal(local.metadata['ogis:theme'], 'dark');
});

test('light style maps to screenshot-light-style.json with a local light sprite', (t) => {
  const root = createSite('light');
  cleanup(t, root);

  const url = prepareLocalStyle('style-light.json', 11235, { siteRoot: root });
  const local = JSON.parse(
    fs.readFileSync(path.join(root, 'screenshot-light-style.json'), 'utf8')
  );
  const source = JSON.parse(fs.readFileSync(path.join(root, 'style-light.json'), 'utf8'));

  assert.equal(url, './screenshot-light-style.json');
  assert.equal(local.sprite, 'http://127.0.0.1:11235/basemap/sprite-light');
  assert.equal(local.glyphs, 'http://127.0.0.1:11235/basemap/fonts/{fontstack}/{range}.pbf');
  assert.deepEqual(local.sources, source.sources);
  assert.equal(source.sprite, 'https://www.ogis.org/basemap/sprite-light');
  assert.equal(local.metadata['ogis:theme'], 'light');
});

test('explicit custom styles are left untouched', (t) => {
  const root = createSite('custom');
  cleanup(t, root);

  assert.equal(
    prepareLocalStyle('./my-style.json', 11236, { siteRoot: root }),
    './my-style.json'
  );
  assert.equal(buildLocalStyle('./my-style.json', 11236, { siteRoot: root }), null);
  assert.deepEqual(fs.readdirSync(root).sort(), ['style-light.json', 'style.json']);
});

test('building a local style does not mutate the source document', (t) => {
  const root = createSite('immutable');
  cleanup(t, root);
  const before = fs.readFileSync(path.join(root, 'style.json'), 'utf8');

  const prepared = buildLocalStyle('./style.json', 11237, { siteRoot: root });

  assert.ok(prepared);
  assert.equal(prepared.name, 'screenshot-style.json');
  assert.equal(fs.readFileSync(path.join(root, 'style.json'), 'utf8'), before);
});

test('missing styles fail clearly and no temporary files are written', (t) => {
  const root = scratch('missing');
  cleanup(t, root);

  assert.throws(
    () => prepareLocalStyle('./style.json', 11238, { siteRoot: root }),
    /run npm run site:build first/
  );
  assert.deepEqual(fs.readdirSync(root), []);
});

test('cleanup removes both temporary style files', (t) => {
  const root = createSite('cleanup');
  cleanup(t, root);

  prepareLocalStyle('./style.json', 11239, { siteRoot: root });
  prepareLocalStyle('./style-light.json', 11239, { siteRoot: root });
  assert.ok(fs.existsSync(path.join(root, 'screenshot-style.json')));
  assert.ok(fs.existsSync(path.join(root, 'screenshot-light-style.json')));

  removeLocalStyles({ siteRoot: root });

  assert.deepEqual(fs.readdirSync(root).sort(), ['style-light.json', 'style.json']);
});
