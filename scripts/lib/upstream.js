'use strict';

//
// Deterministic mirror and provenance helpers for the vendored OpenMapTiles
// sources. The CLI in scripts/sync-upstream.js is a thin wrapper around these
// functions so they can be tested offline.
//

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');
const UPSTREAM_REPO = 'https://github.com/openmaptiles/openmaptiles';
const UPSTREAM_BRANCH = 'master';
const UPSTREAM_ARCHIVE_HOST = 'https://codeload.github.com';
const UPSTREAM_API_HOST = 'https://api.github.com';
const TOOLS_VERSION = '7.2';
const MIRROR_PATHS = ['LICENSE.md', 'layers', 'openmaptiles.yaml', 'style'];
const LOCK_FILENAME = 'openmaptiles.lock.json';
const USER_AGENT = 'basemap-upstream-sync';
const NULL = Buffer.from([0]);

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function resolvePaths({ root = DEFAULT_ROOT } = {}) {
  const vendorDir = path.join(root, 'vendor');
  return {
    root,
    vendorDir,
    mirrorDir: path.join(vendorDir, 'openmaptiles'),
    lockPath: path.join(vendorDir, LOCK_FILENAME),
    workRoot: path.join(root, '.opencode', 'tmp')
  };
}

function listFiles(directory) {
  const files = [];

  function walk(current, prefix) {
    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((left, right) => compareStrings(left.name, right.name));

    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath, relative);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(relative);
      }
    }
  }

  walk(directory, '');
  return files.sort(compareStrings);
}

function computeManifest(directory) {
  const files = listFiles(directory);
  const hash = crypto.createHash('sha256');

  for (const relativePath of files) {
    hash.update(relativePath);
    hash.update(NULL);
    hash.update(fs.readFileSync(path.join(directory, relativePath)));
    hash.update(NULL);
  }

  return {
    manifestHash: `sha256:${hash.digest('hex')}`,
    fileCount: files.length,
    files
  };
}

function stageMirror(sourceRoot, stagingRoot, mirrorPaths = MIRROR_PATHS) {
  fs.mkdirSync(stagingRoot, { recursive: true });

  for (const relativePath of mirrorPaths) {
    const sourcePath = path.join(sourceRoot, relativePath);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Upstream archive is missing ${relativePath}`);
    }

    const destinationPath = path.join(stagingRoot, relativePath);
    const stat = fs.statSync(sourcePath);

    if (stat.isDirectory()) {
      fs.cpSync(sourcePath, destinationPath, {
        recursive: true,
        dereference: false,
        preserveTimestamps: true
      });
    } else {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }

  return computeManifest(stagingRoot);
}

function replaceMirror({
  stagingDir,
  mirrorDir,
  lockTempPath,
  lockPath,
  backupDir
}) {
  fs.mkdirSync(path.dirname(mirrorDir), { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });

  const backupMirror = path.join(backupDir, 'mirror');
  const backupLock = path.join(backupDir, 'lock');
  const hadMirror = fs.existsSync(mirrorDir);
  const hadLock = Boolean(lockPath) && fs.existsSync(lockPath);

  if (hadMirror) fs.renameSync(mirrorDir, backupMirror);
  if (hadLock) fs.renameSync(lockPath, backupLock);

  try {
    fs.renameSync(stagingDir, mirrorDir);

    if (lockTempPath && lockPath) {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.renameSync(lockTempPath, lockPath);
    }
  } catch (error) {
    if (fs.existsSync(mirrorDir)) {
      fs.rmSync(mirrorDir, { recursive: true, force: true });
    }
    if (lockPath && fs.existsSync(lockPath)) {
      fs.rmSync(lockPath, { force: true });
    }
    if (hadMirror) fs.renameSync(backupMirror, mirrorDir);
    if (hadLock) fs.renameSync(backupLock, lockPath);
    throw error;
  }

  fs.rmSync(backupDir, { recursive: true, force: true });
}

function readLock(lockPath) {
  const text = fs.readFileSync(lockPath, 'utf8');
  const lock = JSON.parse(text);

  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) {
    throw new Error(`Lock file is not an object: ${lockPath}`);
  }

  return lock;
}

function writeLock(lockPath, lock) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const temporaryPath = `${lockPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(lock, null, 2)}\n`);
  fs.renameSync(temporaryPath, lockPath);
}

function buildLock({ commit, ref = UPSTREAM_BRANCH, manifestHash, fileCount, syncedAt }) {
  return {
    upstream: UPSTREAM_REPO,
    ref,
    commit,
    syncedAt,
    toolsVersion: TOOLS_VERSION,
    paths: [...MIRROR_PATHS],
    fileCount,
    manifestHash
  };
}

function verifyMirror({ mirrorDir, lockPath }) {
  if (!fs.existsSync(mirrorDir)) {
    return {
      ok: false,
      message: `Mirror directory is missing: ${mirrorDir}`
    };
  }

  if (!fs.existsSync(lockPath)) {
    return {
      ok: false,
      message: `Lock file is missing: ${lockPath}`
    };
  }

  const lock = readLock(lockPath);
  const expected = [...MIRROR_PATHS].sort(compareStrings);
  const entries = fs
    .readdirSync(mirrorDir)
    .sort(compareStrings);
  const missing = expected.filter((entry) => !entries.includes(entry));
  const extra = entries.filter((entry) => !expected.includes(entry));

  if (missing.length) {
    return {
      ok: false,
      message: `Mirror is missing: ${missing.join(', ')}`
    };
  }

  if (extra.length) {
    return {
      ok: false,
      message: `Mirror contains unexpected entries: ${extra.join(', ')}`
    };
  }

  const manifest = computeManifest(mirrorDir);

  if (manifest.fileCount !== lock.fileCount) {
    return {
      ok: false,
      message: `Mirror has ${manifest.fileCount} files; lock expects ${lock.fileCount}`
    };
  }

  if (manifest.manifestHash !== lock.manifestHash) {
    return {
      ok: false,
      message: `Mirror manifest does not match the lock: ${manifest.manifestHash} != ${lock.manifestHash}`
    };
  }

  return {
    ok: true,
    message: `Mirror matches the lock at ${lock.commit} (${manifest.fileCount} files, ${manifest.manifestHash})`,
    lock,
    manifest
  };
}

async function resolveMasterCommit({ fetchImpl = fetch, branch = UPSTREAM_BRANCH } = {}) {
  const url = `${UPSTREAM_API_HOST}/repos/openmaptiles/openmaptiles/commits/${branch}`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API returned ${response.status} ${response.statusText} for ${url}`
    );
  }

  const data = await response.json();

  if (!data || typeof data.sha !== 'string' || !data.sha) {
    throw new Error(`GitHub API did not return a commit SHA for ${branch}`);
  }

  return data.sha;
}

async function downloadTarball({ commit, destination, fetchImpl = fetch }) {
  const url = `${UPSTREAM_ARCHIVE_HOST}/openmaptiles/openmaptiles/tar.gz/${commit}`;
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT }
  });

  if (!response.ok) {
    throw new Error(
      `Archive download returned ${response.status} ${response.statusText} for ${url}`
    );
  }

  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

function extractTarball({ archivePath, destination }) {
  fs.mkdirSync(destination, { recursive: true });
  const result = spawnSync('tar', ['-xzf', archivePath, '-C', destination], {
    encoding: 'utf8'
  });

  if (result.error) throw result.error;

  if (result.status !== 0) {
    throw new Error(
      `tar failed with status ${result.status}: ${result.stderr || result.stdout || ''}`.trim()
    );
  }
}

function findExtractedRoot(directory) {
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());

  if (entries.length !== 1) {
    throw new Error(
      `Expected one top-level directory in the archive, found ${entries.length}`
    );
  }

  return path.join(directory, entries[0].name);
}

async function syncUpstream({
  root = DEFAULT_ROOT,
  ref,
  fetchImpl = fetch,
  now = new Date(),
  log = () => {}
} = {}) {
  if (ref && !/^[0-9a-f]{7,40}$/i.test(ref)) {
    throw new Error('--ref must be a hexadecimal commit SHA');
  }

  const paths = resolvePaths({ root });
  fs.mkdirSync(paths.workRoot, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(paths.workRoot, 'upstream-sync-'));

  try {
    const commit = ref || (await resolveMasterCommit({ fetchImpl }));
    const lockRef = ref ? commit : UPSTREAM_BRANCH;

    log(`Resolved ${lockRef} to ${commit}`);

    const archivePath = path.join(workDir, 'source.tar.gz');
    const extractDir = path.join(workDir, 'extract');
    const stagingDir = path.join(workDir, 'staging');
    const lockTempPath = path.join(workDir, LOCK_FILENAME);
    const backupDir = path.join(workDir, 'backup');

    await downloadTarball({ commit, destination: archivePath, fetchImpl });
    extractTarball({ archivePath, destination: extractDir });
    const sourceRoot = findExtractedRoot(extractDir);
    const manifest = stageMirror(sourceRoot, stagingDir);

    const lock = buildLock({
      commit,
      ref: lockRef,
      manifestHash: manifest.manifestHash,
      fileCount: manifest.fileCount,
      syncedAt: now.toISOString()
    });
    writeLock(lockTempPath, lock);

    replaceMirror({
      stagingDir,
      mirrorDir: paths.mirrorDir,
      lockTempPath,
      lockPath: paths.lockPath,
      backupDir
    });

    return { commit, lock, mirrorDir: paths.mirrorDir, lockPath: paths.lockPath };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function checkUpstream({ root = DEFAULT_ROOT, fetchImpl = fetch } = {}) {
  const paths = resolvePaths({ root });
  const lock = readLock(paths.lockPath);
  const latest = await resolveMasterCommit({ fetchImpl });

  if (latest === lock.commit) {
    return {
      ok: true,
      upToDate: true,
      latest,
      message: `Upstream master is up to date at ${latest}.`
    };
  }

  return {
    ok: true,
    upToDate: false,
    latest,
    message: `Upstream master has moved: the mirror is behind by ${latest}. Run npm run upstream:sync.`
  };
}

module.exports = {
  DEFAULT_ROOT,
  LOCK_FILENAME,
  MIRROR_PATHS,
  TOOLS_VERSION,
  UPSTREAM_BRANCH,
  UPSTREAM_REPO,
  buildLock,
  checkUpstream,
  compareStrings,
  computeManifest,
  downloadTarball,
  extractTarball,
  findExtractedRoot,
  listFiles,
  readLock,
  replaceMirror,
  resolveMasterCommit,
  resolvePaths,
  stageMirror,
  syncUpstream,
  verifyMirror,
  writeLock
};
