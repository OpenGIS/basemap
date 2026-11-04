'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MAP_FILES,
  STYLE_FILES,
  SITE_PREFIX,
  mapRequestToFile,
  validateArtifact,
  validateAssetPaths
} = require('./site-build');

const scratchBase = path.join(__dirname, '..', '.opencode', 'tmp');

fs.mkdirSync(scratchBase, { recursive: true });

function scratch(name) {
  return fs.mkdtempSync(path.join(scratchBase, `site-build-${name}-`));
}

function write(root, relative, content = '') {
  const filePath = path.join(root, relative);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function cleanup(t, directory) {
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
}

function pageHtml(assets) {
  return `<!doctype html>
<html lang="en-GB">
  <head>
    ${assets}
  </head>
  <body>
    <a href="https://www.ogis.org/">Open GIS</a>
  </body>
</html>`;
}

function styleDocument(theme) {
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
    sprite: theme === 'dark' ? 'https://www.ogis.org/basemap/sprite' : 'https://www.ogis.org/basemap/sprite-light',
    glyphs: 'https://www.ogis.org/basemap/fonts/{fontstack}/{range}.pbf',
    metadata: { 'ogis:theme': theme, 'ogis:upstreamCommit': 'abc123' },
    layers: [{ id: 'Background', type: 'background', paint: { 'background-color': '#000000' } }]
  });
}

function spriteDocument() {
  return JSON.stringify({ example: { width: 1, height: 1, x: 0, y: 0, pixelRatio: 1 } });
}

function createArtifact(name) {
  const root = scratch(name);
  write(
    root,
    'index.html',
    pageHtml(
      '<script type="module" src="/basemap/nuxt-assets/app.js"></script>' +
        '<link rel="icon" href="/basemap/branding/logo-green.png">'
    )
  );
  for (const file of MAP_FILES) {
    if (STYLE_FILES.includes(file)) {
      write(root, file, styleDocument(file === 'style.json' ? 'dark' : 'light'));
    } else if (file.endsWith('.json')) {
      write(root, file, spriteDocument());
    } else {
      write(root, file, 'png');
    }
  }
  write(root, 'icons/example.svg', '<svg></svg>');
  write(root, 'icons-light/example.svg', '<svg></svg>');
  write(root, 'fonts/Noto Sans Regular/0-255.pbf', '');
  write(root, 'nuxt-assets/app.js', '');
  write(root, 'nuxt-assets/app.css', '');
  write(root, 'nuxt-assets/maplibre-gl-worker.mjs', '');
  write(root, 'nuxt-assets/maplibre-gl-shared.mjs', '');
  write(root, 'branding/logo-green.png', '');
  return root;
}

test('base-path validation accepts /basemap/ assets and external links', (t) => {
  const root = scratch('valid-paths');
  cleanup(t, root);
  write(root, 'nuxt-assets/app.js', '');
  write(root, 'nuxt-assets/app.css', '');
  write(root, 'branding/logo-green.png', '');

  const html = pageHtml(
    '<script type="module" src="/basemap/nuxt-assets/app.js"></script>' +
      '<link rel="stylesheet" href="./nuxt-assets/app.css">' +
      '<link rel="icon" href="/basemap/branding/logo-green.png">' +
      '<img src="data:image/png;base64,AAAA">'
  );

  assert.deepEqual(validateAssetPaths(html, { pageUrlPath: SITE_PREFIX, outputDir: root }), []);
});

test('base-path validation rejects /_nuxt/ references', (t) => {
  const root = scratch('nuxt-prefix');
  cleanup(t, root);

  const errors = validateAssetPaths(
    pageHtml('<script type="module" src="/_nuxt/app.js"></script>'),
    { pageUrlPath: SITE_PREFIX, outputDir: root }
  );

  assert.ok(errors.some((error) => error.includes('/_nuxt/')), errors.join('\n'));
});

test('base-path validation rejects external asset URLs', (t) => {
  const root = scratch('external-asset');
  cleanup(t, root);

  const errors = validateAssetPaths(
    pageHtml('<script src="https://cdn.example.com/app.js"></script>'),
    { pageUrlPath: SITE_PREFIX, outputDir: root }
  );

  assert.ok(errors.some((error) => error.includes('external asset URL')), errors.join('\n'));
});

test('base-path validation rejects missing local assets', (t) => {
  const root = scratch('missing-asset');
  cleanup(t, root);

  const errors = validateAssetPaths(
    pageHtml('<script src="/basemap/nuxt-assets/missing.js"></script>'),
    { pageUrlPath: SITE_PREFIX, outputDir: root }
  );

  assert.ok(errors.some((error) => error.includes('missing local asset')), errors.join('\n'));
});

test('artifact checks pass for a complete output tree', (t) => {
  const root = createArtifact('complete');
  cleanup(t, root);

  assert.deepEqual(validateArtifact(root), []);
});

test('artifact checks report missing required paths', (t) => {
  const root = createArtifact('missing-map-file');
  cleanup(t, root);
  fs.unlinkSync(path.join(root, 'style.json'));

  const errors = validateArtifact(root);

  assert.ok(errors.some((error) => error.includes('missing map file style.json')), errors.join('\n'));
});

test('artifact checks report a missing light style', (t) => {
  const root = createArtifact('missing-light-style');
  cleanup(t, root);
  fs.unlinkSync(path.join(root, 'style-light.json'));

  const errors = validateArtifact(root);

  assert.ok(errors.some((error) => error.includes('missing map file style-light.json')), errors.join('\n'));
});

test('artifact checks report a missing light sprite set', (t) => {
  const root = createArtifact('missing-light-sprite');
  cleanup(t, root);
  fs.unlinkSync(path.join(root, 'sprite-light@2x.png'));

  const errors = validateArtifact(root);

  assert.ok(errors.some((error) => error.includes('missing map file sprite-light@2x.png')), errors.join('\n'));
});

test('artifact checks report invalid style JSON', (t) => {
  const root = createArtifact('invalid-style');
  cleanup(t, root);
  write(root, 'style-light.json', '{not json');

  const errors = validateArtifact(root);

  assert.ok(errors.some((error) => error.includes('invalid style style-light.json')), errors.join('\n'));
});

test('artifact checks report a style without required fields', (t) => {
  const root = createArtifact('style-fields');
  cleanup(t, root);
  write(root, 'style.json', '{}');

  const errors = validateArtifact(root);

  assert.ok(errors.some((error) => error.includes('missing sources.openmaptiles')), errors.join('\n'));
  assert.ok(errors.some((error) => error.includes('missing sprite')), errors.join('\n'));
  assert.ok(errors.some((error) => error.includes('missing glyphs')), errors.join('\n'));
  assert.ok(errors.some((error) => error.includes('missing layers')), errors.join('\n'));
});

test('artifact checks require style.json to be the dark default', (t) => {
  const root = createArtifact('dark-default');
  cleanup(t, root);
  write(root, 'style.json', styleDocument('light'));

  const errors = validateArtifact(root);

  assert.ok(errors.some((error) => error.includes('not the dark default')), errors.join('\n'));
});

test('artifact checks report a missing light icon directory', (t) => {
  const root = createArtifact('missing-light-icons');
  cleanup(t, root);
  fs.rmSync(path.join(root, 'icons-light'), { recursive: true, force: true });

  const errors = validateArtifact(root);

  assert.ok(errors.some((error) => error.includes('missing icons-light directory')), errors.join('\n'));
});

test('artifact checks reject _payload.json anywhere in the output', (t) => {
  const root = createArtifact('payload');
  cleanup(t, root);
  write(root, 'nested/_payload.json', '{}');

  const errors = validateArtifact(root);

  assert.ok(errors.some((error) => error.includes('_payload.json')), errors.join('\n'));
});

test('request mapping strips the /basemap/ prefix and maps directories to index.html', () => {
  const outputDir = path.resolve(scratchBase, 'mapping-output');

  assert.deepEqual(mapRequestToFile('/basemap/', outputDir), {
    status: 200,
    filePath: path.join(outputDir, 'index.html')
  });
  assert.deepEqual(mapRequestToFile('/basemap/icons/example.svg', outputDir), {
    status: 200,
    filePath: path.join(outputDir, 'icons', 'example.svg')
  });
  assert.deepEqual(mapRequestToFile('/basemap/nuxt-assets/app.js', outputDir), {
    status: 200,
    filePath: path.join(outputDir, 'nuxt-assets', 'app.js')
  });
});

test('request mapping rejects paths outside the prefix and traversal attempts', () => {
  const outputDir = path.resolve(scratchBase, 'mapping-guard');

  assert.deepEqual(mapRequestToFile('/index.html', outputDir), {
    status: 404,
    filePath: null
  });
  assert.deepEqual(mapRequestToFile('/basemap', outputDir), {
    status: 404,
    filePath: null
  });
  assert.deepEqual(mapRequestToFile('/basemap/../../etc/passwd', outputDir), {
    status: 403,
    filePath: null
  });
});
