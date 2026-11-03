'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MAP_FILES,
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
  write(
    root,
    'palette/index.html',
    pageHtml('<link rel="stylesheet" href="/basemap/nuxt-assets/app.css">')
  );
  for (const file of MAP_FILES) {
    write(root, file, file.endsWith('.json') ? '{}' : '');
  }
  write(root, 'icons/example.svg', '<svg></svg>');
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

test('artifact checks reject _payload.json anywhere in the output', (t) => {
  const root = createArtifact('payload');
  cleanup(t, root);
  write(root, 'palette/_payload.json', '{}');

  const errors = validateArtifact(root);

  assert.ok(errors.some((error) => error.includes('_payload.json')), errors.join('\n'));
});

test('request mapping strips the /basemap/ prefix and maps directories to index.html', () => {
  const outputDir = path.resolve(scratchBase, 'mapping-output');

  assert.deepEqual(mapRequestToFile('/basemap/', outputDir), {
    status: 200,
    filePath: path.join(outputDir, 'index.html')
  });
  assert.deepEqual(mapRequestToFile('/basemap/palette/', outputDir), {
    status: 200,
    filePath: path.join(outputDir, 'palette', 'index.html')
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
