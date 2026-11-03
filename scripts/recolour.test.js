'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildModel } = require('./lib/palette');
const {
  assertSafeOutputPath,
  prepareOutputDir,
  recolourIcons,
  validateRecolourInputs
} = require('./lib/recolour');
const { parseArguments } = require('./palette');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'vendor', 'openmaptiles', 'style', 'icons');
const scratchBase = path.join(root, '.opencode', 'tmp');
const cliPath = path.join(root, 'scripts', 'palette.js');
const model = buildModel({ root });
const sourceFiles = fs
  .readdirSync(sourceDir)
  .filter((file) => file.toLowerCase().endsWith('.svg'))
  .sort();
const sourceSnapshot = new Map(
  sourceFiles.map((file) => [file, Buffer.from(fs.readFileSync(path.join(sourceDir, file)))])
);

fs.mkdirSync(scratchBase, { recursive: true });

function scratch(name) {
  return fs.mkdtempSync(path.join(scratchBase, `palette-${name}-`));
}

function cleanup(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

function paletteCopy() {
  const copy = JSON.parse(JSON.stringify(model.palette));
  for (const role of copy.roles) {
    role.color = role.sourceColors[0];
  }
  copy.overrides = {};
  return copy;
}

function readOutput(directory, name) {
  return fs.readFileSync(path.join(directory, `${name}.svg`), 'utf8');
}

function createModelFixture(name) {
  const fixture = scratch(name);
  const poiDir = path.join(fixture, 'vendor', 'openmaptiles', 'layers', 'poi');
  const fixtureIcons = path.join(fixture, 'vendor', 'openmaptiles', 'style', 'icons');
  fs.mkdirSync(poiDir, { recursive: true });
  for (const file of ['poi.yaml', 'mapping.yaml', 'style.json']) {
    fs.copyFileSync(
      path.join(root, 'vendor', 'openmaptiles', 'layers', 'poi', file),
      path.join(poiDir, file)
    );
  }
  fs.cpSync(sourceDir, fixtureIcons, { recursive: true });
  return fixture;
}

function compareDirectories(left, right) {
  const leftFiles = fs.readdirSync(left).sort();
  const rightFiles = fs.readdirSync(right).sort();
  assert.deepEqual(leftFiles, rightFiles);
  for (const file of leftFiles) {
    assert.equal(
      Buffer.compare(fs.readFileSync(path.join(left, file)), fs.readFileSync(path.join(right, file))),
      0,
      `${file} should match`
    );
  }
}

test('identity apply writes every icon byte-identically', (t) => {
  const outDir = scratch('identity');
  t.after(() => cleanup(outDir));
  fs.writeFileSync(path.join(outDir, 'stale.svg'), '<svg/>');

  const result = recolourIcons({ root, palette: paletteCopy(), outDir });

  assert.equal(result.files, 306);
  assert.equal(result.recoloured.length, 0);
  assert.equal(result.unchanged.length, 306);
  assert.equal(fs.existsSync(path.join(outDir, 'stale.svg')), false);
  compareDirectories(sourceDir, outDir);
});

test('changing transport recolours transport icons but not food icons', (t) => {
  const outDir = scratch('transport');
  t.after(() => cleanup(outDir));
  const palette = paletteCopy();
  palette.roles.find((role) => role.id === 'transport').color = '#123456';

  const result = recolourIcons({ root, palette, outDir });

  assert.ok(result.recoloured.includes('camping'));
  assert.ok(!result.recoloured.includes('restaurant'));

  const camping = readOutput(outDir, 'camping');
  assert.ok(camping.includes('#123456'));
  assert.ok(!camping.includes('#0092DA'));

  const restaurant = readOutput(outDir, 'restaurant');
  assert.equal(Buffer.compare(Buffer.from(restaurant), sourceSnapshot.get('restaurant.svg')), 0);

  const hostel = readOutput(outDir, 'hostel');
  assert.ok(hostel.includes('fill="white"'));
  assert.ok(hostel.includes('#123456'));
});

test('changing shops updates books inline style but not its stale attribute', (t) => {
  const outDir = scratch('shops');
  t.after(() => cleanup(outDir));
  const palette = paletteCopy();
  palette.roles.find((role) => role.id === 'shops').color = '#112233';

  recolourIcons({ root, palette, outDir });
  const books = readOutput(outDir, 'books');

  assert.ok(books.includes('style="fill:#112233;'));
  assert.ok(books.includes('fill="#734A08"'));
  assert.ok(!books.toLowerCase().includes('#ac39ac'));
});

test('changing worship recolours black religion primaries', (t) => {
  const outDir = scratch('worship');
  t.after(() => cleanup(outDir));
  const palette = paletteCopy();
  palette.roles.find((role) => role.id === 'worship').color = '#ABCDEF';

  recolourIcons({ root, palette, outDir });
  const buddhist = readOutput(outDir, 'buddhist');
  const placeOfWorship = readOutput(outDir, 'place_of_worship');

  assert.ok(buddhist.includes('fill="#ABCDEF"'));
  assert.ok(placeOfWorship.includes('fill="#ABCDEF"'));
  assert.notEqual(
    Buffer.compare(Buffer.from(buddhist), sourceSnapshot.get('buddhist.svg')),
    0
  );
});

test('preserve leaves a preserved primary fill unchanged', (t) => {
  const outDir = scratch('preserve');
  t.after(() => cleanup(outDir));
  const palette = paletteCopy();
  palette.roles.find((role) => role.id === 'transport').color = '#123456';
  palette.preserve = ['#0092DA'];

  const result = recolourIcons({ root, palette, outDir });
  const camping = readOutput(outDir, 'camping');

  assert.ok(!result.recoloured.includes('camping'));
  assert.equal(Buffer.compare(Buffer.from(camping), sourceSnapshot.get('camping.svg')), 0);
});

test('overrides select an alternative role and invalid overrides fail', (t) => {
  const outDir = scratch('override');
  t.after(() => cleanup(outDir));
  const palette = paletteCopy();
  palette.roles.find((role) => role.id === 'transport').color = '#123456';
  palette.overrides = { restaurant: 'transport' };

  recolourIcons({ root, palette, outDir });
  const restaurant = readOutput(outDir, 'restaurant');
  assert.ok(restaurant.includes('#123456'));

  const invalidDir = scratch('invalid-override');
  t.after(() => cleanup(invalidDir));
  const invalid = paletteCopy();
  invalid.overrides = { camping: 'missing-role' };
  assert.throws(
    () => recolourIcons({ root, palette: invalid, outDir: path.join(invalidDir, 'role') }),
    /unknown role missing-role/
  );

  const unknown = paletteCopy();
  unknown.overrides = { no_such_icon: 'transport' };
  assert.throws(
    () => recolourIcons({ root, palette: unknown, outDir: path.join(invalidDir, 'unknown') }),
    /not a selected POI icon with a source SVG/
  );

  const nonPoi = paletteCopy();
  nonPoi.overrides = { road_motorway: 'transport' };
  assert.throws(
    () => recolourIcons({ root, palette: nonPoi, outDir: path.join(invalidDir, 'non-poi') }),
    /not a selected POI icon with a source SVG/
  );
});

test('duplicate source colours fail validation', (t) => {
  const outDir = scratch('duplicate-source');
  t.after(() => cleanup(outDir));
  const palette = paletteCopy();
  palette.roles.find((role) => role.id === 'food').sourceColors.push('#0092DA');

  assert.throws(
    () => recolourIcons({ root, palette, outDir }),
    /#0092DA is assigned to both transport and food/
  );
});

test('unsafe output directories are rejected by the canonical allowlist', (t) => {
  const sandbox = scratch('guard-sandbox');
  t.after(() => cleanup(sandbox));
  const fixture = path.join(sandbox, 'repo');
  const docs = path.join(fixture, 'docs');
  const scripts = path.join(fixture, 'scripts');
  const layers = path.join(fixture, 'vendor', 'openmaptiles', 'layers');
  const icons = path.join(fixture, 'vendor', 'openmaptiles', 'style', 'icons');
  const buildRoot = path.join(fixture, 'build');
  const tmpRoot = path.join(fixture, '.opencode', 'tmp');
  const external = path.join(sandbox, 'external');

  for (const directory of [docs, scripts, layers, icons, buildRoot, tmpRoot, external]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'sentinel.txt'), 'keep');
  }
  fs.writeFileSync(path.join(fixture, 'root-sentinel.txt'), 'keep');
  fs.writeFileSync(path.join(icons, 'camping.svg'), '<svg/>');
  fs.writeFileSync(path.join(icons, 'restaurant.svg'), '<svg/>');
  fs.writeFileSync(path.join(external, 'sentinel.txt'), 'keep');

  const rejected = [
    fixture,
    docs,
    scripts,
    layers,
    icons,
    sandbox,
    buildRoot,
    tmpRoot,
    path.join(fixture, '.opencode'),
    external
  ];

  for (const outDir of rejected) {
    assert.throws(
      () => recolourIcons({ root: fixture, outDir }),
      /Refusing to write palette icons/,
      `${outDir} should be rejected`
    );
    assert.equal(fs.readFileSync(path.join(fixture, 'root-sentinel.txt'), 'utf8'), 'keep');
    for (const directory of [docs, scripts, layers, buildRoot, tmpRoot, external]) {
      assert.equal(fs.readFileSync(path.join(directory, 'sentinel.txt'), 'utf8'), 'keep');
    }
    assert.equal(fs.readdirSync(icons).filter((file) => file.endsWith('.svg')).length, 2);
  }

  for (const outDir of [
    path.join(fixture, 'build', 'icons'),
    path.join(fixture, 'build', 'tmp'),
    path.join(fixture, '.opencode', 'tmp', 'test')
  ]) {
    assert.doesNotThrow(() => assertSafeOutputPath({ root: fixture, outDir }));
  }
});

test('case-insensitive aliases of protected paths are rejected', (t) => {
  const fixture = scratch('case-alias');
  t.after(() => cleanup(fixture));
  const icons = path.join(fixture, 'vendor', 'openmaptiles', 'style', 'icons');
  fs.mkdirSync(icons, { recursive: true });
  fs.writeFileSync(path.join(icons, 'sentinel.txt'), 'keep');

  const alias = path.join(fixture, 'VENDOR', 'OPENMAPTILES', 'STYLE', 'ICONS');
  if (!fs.existsSync(alias)) {
    t.skip('case-sensitive filesystem');
    return;
  }

  assert.throws(
    () => assertSafeOutputPath({ root: fixture, outDir: alias }),
    /Refusing to write palette icons/
  );
  assert.equal(fs.readFileSync(path.join(icons, 'sentinel.txt'), 'utf8'), 'keep');
});

test('symlinked ancestors of protected paths are rejected', (t) => {
  const fixture = scratch('symlink-alias');
  t.after(() => cleanup(fixture));
  const vendor = path.join(fixture, 'vendor');
  const icons = path.join(vendor, 'openmaptiles', 'style', 'icons');
  fs.mkdirSync(icons, { recursive: true });
  fs.writeFileSync(path.join(icons, 'sentinel.txt'), 'keep');
  const link = path.join(fixture, 'vendor-link');

  try {
    fs.symlinkSync(vendor, link, 'dir');
  } catch (error) {
    t.skip(`symlinks unavailable: ${error.code}`);
    return;
  }

  assert.throws(
    () => assertSafeOutputPath({
      root: fixture,
      outDir: path.join(link, 'openmaptiles', 'style', 'icons')
    }),
    /Refusing to write palette icons/
  );
  assert.equal(fs.readFileSync(path.join(icons, 'sentinel.txt'), 'utf8'), 'keep');
});

test('dangling symlink components under build are rejected', (t) => {
  const sandbox = scratch('dangling-link');
  t.after(() => cleanup(sandbox));
  const fixture = path.join(sandbox, 'repo');
  const build = path.join(fixture, 'build');
  const outside = path.join(sandbox, 'outside');
  fs.mkdirSync(build, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'keep');
  const link = path.join(build, 'link');

  try {
    fs.symlinkSync(path.join(outside, 'missing-target'), link, 'dir');
  } catch (error) {
    t.skip(`symlinks unavailable: ${error.code}`);
    return;
  }

  assert.throws(
    () => prepareOutputDir({ root: fixture, outDir: path.join(link, 'out') }),
    /symlink/
  );
  assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'keep');
});

test('an existing symlink output directory is rejected', (t) => {
  const sandbox = scratch('output-link');
  t.after(() => cleanup(sandbox));
  const fixture = path.join(sandbox, 'repo');
  const build = path.join(fixture, 'build');
  const outside = path.join(sandbox, 'outside');
  fs.mkdirSync(build, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'keep');
  const link = path.join(build, 'out');

  try {
    fs.symlinkSync(outside, link, 'dir');
  } catch (error) {
    t.skip(`symlinks unavailable: ${error.code}`);
    return;
  }

  assert.throws(
    () => prepareOutputDir({ root: fixture, outDir: link }),
    /Refusing to write palette icons/
  );
  assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'keep');
});

test('SVG symlink entries are unlinked without touching their targets', (t) => {
  const sandbox = scratch('svg-link');
  t.after(() => cleanup(sandbox));
  const fixture = path.join(sandbox, 'repo');
  const outDir = path.join(fixture, 'build', 'out');
  const outside = path.join(sandbox, 'outside');
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const target = path.join(outside, 'target.svg');
  fs.writeFileSync(target, 'target-content');
  const link = path.join(outDir, 'linked.svg');

  try {
    fs.symlinkSync(target, link, 'file');
  } catch (error) {
    t.skip(`symlinks unavailable: ${error.code}`);
    return;
  }

  prepareOutputDir({ root: fixture, outDir });

  assert.equal(fs.existsSync(link), false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'target-content');
});

test('subdirectories and non-SVG files block output cleanup', (t) => {
  const sandbox = scratch('output-contents');
  t.after(() => cleanup(sandbox));
  const fixture = path.join(sandbox, 'repo');
  const withDirectory = path.join(fixture, 'build', 'with-directory');
  const withFile = path.join(fixture, 'build', 'with-file');
  fs.mkdirSync(path.join(withDirectory, 'nested'), { recursive: true });
  fs.mkdirSync(withFile, { recursive: true });
  fs.writeFileSync(path.join(withDirectory, 'keep.svg'), 'keep-svg');
  fs.writeFileSync(path.join(withDirectory, 'nested', 'sentinel.txt'), 'keep');
  fs.writeFileSync(path.join(withFile, 'keep.svg'), 'keep-svg');
  fs.writeFileSync(path.join(withFile, 'notes.txt'), 'keep');

  assert.throws(
    () => prepareOutputDir({ root: fixture, outDir: withDirectory }),
    /subdirectory nested is present/
  );
  assert.equal(fs.readFileSync(path.join(withDirectory, 'keep.svg'), 'utf8'), 'keep-svg');
  assert.equal(
    fs.readFileSync(path.join(withDirectory, 'nested', 'sentinel.txt'), 'utf8'),
    'keep'
  );

  assert.throws(
    () => prepareOutputDir({ root: fixture, outDir: withFile }),
    /non-SVG file notes.txt is present/
  );
  assert.equal(fs.readFileSync(path.join(withFile, 'keep.svg'), 'utf8'), 'keep-svg');
  assert.equal(fs.readFileSync(path.join(withFile, 'notes.txt'), 'utf8'), 'keep');
});

test('empty --out values are rejected before writing', () => {
  assert.throws(() => parseArguments(['--out', '']), /non-empty directory/);

  const result = spawnSync(
    process.execPath,
    [cliPath, '--apply', '--out', ''],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /non-empty directory/);
  assert.ok(!result.stdout.includes('Wrote'));
});

test('consecutive runs into the same directory produce identical output', (t) => {
  const outDir = scratch('repeat');
  t.after(() => cleanup(outDir));
  const palette = paletteCopy();

  const first = recolourIcons({ root, palette, outDir });
  const firstOutput = new Map(
    fs.readdirSync(outDir).sort().map((file) => [file, fs.readFileSync(path.join(outDir, file))])
  );
  fs.writeFileSync(path.join(outDir, 'stale.svg'), '<svg/>');

  const second = recolourIcons({ root, palette, outDir });

  assert.equal(first.files, 306);
  assert.equal(second.files, 306);
  assert.equal(fs.existsSync(path.join(outDir, 'stale.svg')), false);
  const secondFiles = fs.readdirSync(outDir).sort();
  assert.deepEqual(secondFiles, Array.from(firstOutput.keys()).sort());
  for (const file of secondFiles) {
    assert.equal(Buffer.compare(fs.readFileSync(path.join(outDir, file)), firstOutput.get(file)), 0);
  }
});

test('model hard errors abort apply before writing anything', (t) => {
  const directory = scratch('hard-error');
  t.after(() => cleanup(directory));
  const outDir = path.join(directory, 'icons');
  const palette = paletteCopy();
  palette.roles.find((role) => role.id === 'food').color = '#0092DA';

  assert.throws(
    () => recolourIcons({ root, palette, outDir }),
    /hard error\(s\).*duplicate-role-hex/
  );
  assert.equal(fs.existsSync(outDir), false);

  const palettePath = path.join(directory, 'palette.json');
  const cliOut = path.join(directory, 'cli-icons');
  fs.writeFileSync(palettePath, JSON.stringify(palette, null, 2));
  const failed = spawnSync(
    process.execPath,
    [cliPath, '--apply', '--out', cliOut, '--palette', palettePath],
    { encoding: 'utf8' }
  );
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /duplicate-role-hex/);
  assert.equal(fs.existsSync(cliOut), false);
});

test('selected icons with source SVGs are recoloured even when absent from sprite.json', (t) => {
  const fixture = createModelFixture('stale-sprite');
  t.after(() => cleanup(fixture));
  const sprite = JSON.parse(fs.readFileSync(path.join(root, 'sprite.json'), 'utf8'));
  delete sprite.camping;
  fs.writeFileSync(path.join(fixture, 'sprite.json'), JSON.stringify(sprite));

  const outDir = path.join(fixture, 'build', 'out');
  const palette = paletteCopy();
  palette.roles.find((role) => role.id === 'transport').color = '#123456';

  const result = recolourIcons({ root: fixture, palette, outDir });
  const camping = result.model.selectedIcons.find((icon) => icon.name === 'camping');

  assert.ok(result.recoloured.includes('camping'));
  assert.equal(camping.exists, true);
  assert.equal(camping.inSprite, false);
  assert.equal(result.model.poiIcons.some((icon) => icon.name === 'camping'), false);
  assert.ok(readOutput(outDir, 'camping').includes('#123456'));
});

test('selected icons without a usable primary fill are rejected', () => {
  const fakeModel = {
    roles: model.roles,
    selectedIcons: [
      {
        name: 'stroke-icon',
        exists: true,
        primaryFill: null,
        pattern: false,
        strokeOnly: true,
        roleId: 'transport'
      }
    ]
  };

  assert.throws(
    () => validateRecolourInputs(fakeModel, model.palette),
    /no usable primary fill/
  );
});

test('non-POI files are copied and output is deterministic', (t) => {
  const first = scratch('deterministic-a');
  const second = scratch('deterministic-b');
  t.after(() => cleanup(first));
  t.after(() => cleanup(second));
  const palette = paletteCopy();
  palette.roles.find((role) => role.id === 'shops').color = '#112233';

  recolourIcons({ root, palette, outDir: first });
  recolourIcons({ root, palette, outDir: second });

  compareDirectories(first, second);
  assert.equal(
    Buffer.compare(
      fs.readFileSync(path.join(first, 'road_motorway.svg')),
      sourceSnapshot.get('road_motorway.svg')
    ),
    0
  );

  for (const file of sourceFiles) {
    assert.equal(
      Buffer.compare(fs.readFileSync(path.join(sourceDir, file)), sourceSnapshot.get(file)),
      0,
      `${file} should not be modified in the vendor tree`
    );
  }
});

test('CLI parses apply, out, palette and unknown options', (t) => {
  assert.deepEqual(parseArguments(['--apply', '--out', 'out', '--palette', 'palette.json']), {
    summary: true,
    apply: true,
    help: false,
    out: 'out',
    palette: 'palette.json'
  });
  assert.equal(parseArguments([]).summary, true);
  assert.throws(() => parseArguments(['--unknown']), /Unknown option/);
  assert.throws(() => parseArguments(['--out']), /--out requires/);
  assert.throws(() => parseArguments(['--palette']), /--palette requires/);

  const result = spawnSync(process.execPath, [cliPath, '--unknown'], { encoding: 'utf8' });
  assert.equal(result.status, 2);

  const cliDir = scratch('cli');
  t.after(() => cleanup(cliDir));
  const outDir = path.join(cliDir, 'icons');
  const palettePath = path.join(cliDir, 'palette.json');
  const palette = paletteCopy();
  palette.roles.find((role) => role.id === 'transport').color = '#123456';
  fs.writeFileSync(palettePath, JSON.stringify(palette, null, 2));

  const applied = spawnSync(
    process.execPath,
    [cliPath, '--apply', '--out', outDir, '--palette', palettePath],
    { encoding: 'utf8' }
  );
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(fs.readdirSync(outDir).filter((file) => file.endsWith('.svg')).length, 306);
  assert.ok(readOutput(outDir, 'camping').includes('#123456'));

  const invalidPalette = paletteCopy();
  invalidPalette.overrides = { camping: 'missing-role' };
  const invalidPalettePath = path.join(cliDir, 'invalid-palette.json');
  fs.writeFileSync(invalidPalettePath, JSON.stringify(invalidPalette, null, 2));
  const failed = spawnSync(
    process.execPath,
    [cliPath, '--apply', '--out', path.join(cliDir, 'invalid-icons'), '--palette', invalidPalettePath],
    { encoding: 'utf8' }
  );
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /unknown role missing-role/);
});
