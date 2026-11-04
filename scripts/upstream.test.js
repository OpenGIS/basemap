'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MIRROR_PATHS,
  buildLock,
  computeManifest,
  listFiles,
  replaceMirror,
  stageMirror,
  verifyMirror,
  writeLock
} = require('./lib/upstream');
const { parseArguments } = require('./sync-upstream');

const root = path.resolve(__dirname, '..');
const scratchBase = path.join(root, '.opencode', 'tmp');

fs.mkdirSync(scratchBase, { recursive: true });

function scratch(name) {
  return fs.mkdtempSync(path.join(scratchBase, `upstream-${name}-`));
}

function cleanup(t, directory) {
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
}

function write(directory, relativePath, content) {
  const filePath = path.join(directory, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createSource(name, { extras = true } = {}) {
  const directory = scratch(name);
  write(directory, 'LICENSE.md', 'licence\n');
  write(directory, 'openmaptiles.yaml', 'tileset:\n');
  write(directory, 'layers/water/style.json', '{"water":true}\n');
  write(directory, 'style/style-header.json', '{"name":"OpenMapTiles"}\n');
  write(directory, 'style/icons/water.svg', '<svg>water</svg>\n');

  if (extras) {
    write(directory, 'README.md', 'not mirrored\n');
    write(directory, 'VENDOR.md', 'not mirrored\n');
    write(directory, 'docker/Dockerfile', 'not mirrored\n');
  }

  return directory;
}

function createLockedMirror(t, name) {
  const work = scratch(name);
  cleanup(t, work);
  const source = createSource(`${name}-source`);
  cleanup(t, source);
  const mirror = path.join(work, 'mirror');
  const lockPath = path.join(work, 'openmaptiles.lock.json');
  const manifest = stageMirror(source, mirror);
  const lock = buildLock({
    commit: 'a'.repeat(40),
    ref: 'master',
    manifestHash: manifest.manifestHash,
    fileCount: manifest.fileCount,
    syncedAt: '2026-11-03T00:00:00.000Z'
  });
  writeLock(lockPath, lock);
  return { work, source, mirror, lockPath, lock, manifest };
}

test('manifest hashing is deterministic and independent of creation order', (t) => {
  const first = scratch('manifest-first');
  const second = scratch('manifest-second');
  cleanup(t, first);
  cleanup(t, second);

  write(first, 'layers/water/style.json', '{"water":true}\n');
  write(first, 'LICENSE.md', 'licence\n');
  write(first, 'style/icons/water.svg', '<svg>water</svg>\n');
  write(first, 'openmaptiles.yaml', 'tileset:\n');

  write(second, 'openmaptiles.yaml', 'tileset:\n');
  write(second, 'style/icons/water.svg', '<svg>water</svg>\n');
  write(second, 'LICENSE.md', 'licence\n');
  write(second, 'layers/water/style.json', '{"water":true}\n');

  const firstManifest = computeManifest(first);
  const secondManifest = computeManifest(second);

  assert.equal(firstManifest.manifestHash, secondManifest.manifestHash);
  assert.equal(firstManifest.fileCount, secondManifest.fileCount);
  assert.deepEqual(firstManifest.files, secondManifest.files);

  write(second, 'layers/water/style.json', '{"water":false}\n');
  assert.notEqual(
    computeManifest(second).manifestHash,
    firstManifest.manifestHash
  );
});

test('staging copies only the allowed paths and ignores tarball extras', (t) => {
  const source = createSource('stage');
  const staging = scratch('stage-output');
  cleanup(t, source);
  cleanup(t, staging);

  const manifest = stageMirror(source, staging);

  assert.deepEqual(listFiles(staging), [
    'LICENSE.md',
    'layers/water/style.json',
    'openmaptiles.yaml',
    'style/icons/water.svg',
    'style/style-header.json'
  ]);
  assert.equal(manifest.fileCount, 5);
  assert.equal(fs.existsSync(path.join(staging, 'README.md')), false);
  assert.equal(fs.existsSync(path.join(staging, 'VENDOR.md')), false);
  assert.equal(fs.existsSync(path.join(staging, 'docker')), false);
  assert.deepEqual(MIRROR_PATHS, ['LICENSE.md', 'layers', 'openmaptiles.yaml', 'style']);
});

test('verify rejects extra files in the mirror', (t) => {
  const { mirror, lockPath } = createLockedMirror(t, 'verify-extra');

  assert.equal(verifyMirror({ mirrorDir: mirror, lockPath }).ok, true);

  write(mirror, 'VENDOR.md', 'stale provenance\n');
  const topLevel = verifyMirror({ mirrorDir: mirror, lockPath });
  assert.equal(topLevel.ok, false);
  assert.match(topLevel.message, /unexpected entries: VENDOR\.md/);

  fs.rmSync(path.join(mirror, 'VENDOR.md'));
  write(mirror, '.DS_Store', 'finder junk\n');
  const finder = verifyMirror({ mirrorDir: mirror, lockPath });
  assert.equal(finder.ok, false);
  assert.match(finder.message, /unexpected entries: \.DS_Store/);

  fs.rmSync(path.join(mirror, '.DS_Store'));
  write(mirror, 'style/icons/extra.svg', '<svg>extra</svg>\n');
  const nested = verifyMirror({ mirrorDir: mirror, lockPath });
  assert.equal(nested.ok, false);
  assert.match(nested.message, /lock expects/);
});

test('verify rejects missing files and missing mirrors', (t) => {
  const { mirror, lockPath } = createLockedMirror(t, 'verify-missing');

  fs.rmSync(path.join(mirror, 'LICENSE.md'));
  const missingFile = verifyMirror({ mirrorDir: mirror, lockPath });
  assert.equal(missingFile.ok, false);
  assert.match(missingFile.message, /missing: LICENSE\.md/);

  fs.rmSync(mirror, { recursive: true, force: true });
  const missingMirror = verifyMirror({ mirrorDir: mirror, lockPath });
  assert.equal(missingMirror.ok, false);
  assert.match(missingMirror.message, /Mirror directory is missing/);
});

test('atomic replace installs the new tree and removes stale files', (t) => {
  const work = scratch('replace');
  cleanup(t, work);

  const mirror = path.join(work, 'mirror');
  const staging = path.join(work, 'staging');
  const backup = path.join(work, 'backup');

  write(mirror, 'LICENSE.md', 'old licence\n');
  write(mirror, 'VENDOR.md', 'stale provenance\n');
  write(mirror, 'layers/old/style.json', '{"old":true}\n');

  write(staging, 'LICENSE.md', 'new licence\n');
  write(staging, 'layers/new/style.json', '{"new":true}\n');

  replaceMirror({ stagingDir: staging, mirrorDir: mirror, backupDir: backup });

  assert.equal(fs.existsSync(path.join(mirror, 'VENDOR.md')), false);
  assert.equal(fs.existsSync(path.join(mirror, 'layers/old')), false);
  assert.equal(fs.existsSync(path.join(mirror, 'layers/new/style.json')), true);
  assert.equal(fs.readFileSync(path.join(mirror, 'LICENSE.md'), 'utf8'), 'new licence\n');
  assert.equal(fs.existsSync(backup), false);
});

test('atomic replace restores the old tree when the swap fails', (t) => {
  const work = scratch('replace-failure');
  cleanup(t, work);

  const mirror = path.join(work, 'mirror');
  const missingStaging = path.join(work, 'missing-staging');
  const backup = path.join(work, 'backup');

  write(mirror, 'LICENSE.md', 'old licence\n');
  write(mirror, 'VENDOR.md', 'stale provenance\n');

  assert.throws(() =>
    replaceMirror({
      stagingDir: missingStaging,
      mirrorDir: mirror,
      backupDir: backup
    })
  );

  assert.equal(fs.readFileSync(path.join(mirror, 'LICENSE.md'), 'utf8'), 'old licence\n');
  assert.equal(fs.existsSync(path.join(mirror, 'VENDOR.md')), true);
});

test('lock round-trip verifies and rejects tampering', (t) => {
  const { mirror, lockPath, lock } = createLockedMirror(t, 'lock');

  const verified = verifyMirror({ mirrorDir: mirror, lockPath });
  assert.equal(verified.ok, true);
  assert.equal(verified.lock.commit, lock.commit);

  writeLock(lockPath, { ...lock, manifestHash: `sha256:${'0'.repeat(64)}` });
  const tamperedLock = verifyMirror({ mirrorDir: mirror, lockPath });
  assert.equal(tamperedLock.ok, false);
  assert.match(tamperedLock.message, /does not match the lock/);

  writeLock(lockPath, lock);
  assert.equal(verifyMirror({ mirrorDir: mirror, lockPath }).ok, true);

  write(mirror, 'layers/water/style.json', '{"water":false}\n');
  const tamperedMirror = verifyMirror({ mirrorDir: mirror, lockPath });
  assert.equal(tamperedMirror.ok, false);
  assert.match(tamperedMirror.message, /does not match the lock/);
});

test('CLI arguments select one mode and validate --ref', () => {
  assert.deepEqual(parseArguments([]), { mode: 'sync', ref: null, help: false });
  assert.deepEqual(parseArguments(['--verify']), {
    mode: 'verify',
    ref: null,
    help: false
  });
  assert.deepEqual(parseArguments(['--sync', '--ref', 'a'.repeat(40)]), {
    mode: 'sync',
    ref: 'a'.repeat(40),
    help: false
  });

  assert.throws(() => parseArguments(['--sync', '--verify']), /only one/);
  assert.throws(() => parseArguments(['--verify', '--ref', 'a'.repeat(40)]), /only valid/);
  assert.throws(() => parseArguments(['--ref']), /requires a commit SHA/);
});
