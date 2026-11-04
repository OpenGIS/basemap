#!/usr/bin/env node
'use strict';

const {
  DEFAULT_ROOT,
  MIRROR_PATHS,
  TOOLS_VERSION,
  UPSTREAM_REPO,
  checkUpstream,
  resolvePaths,
  syncUpstream,
  verifyMirror
} = require('./lib/upstream');

function usage() {
  return [
    'Usage: node scripts/sync-upstream.js [mode] [options]',
    '',
    'Modes:',
    '  --sync      Resolve master, download and mirror the allowed paths (default)',
    '  --verify    Recompute the manifest and compare it to the lock (offline)',
    '  --check     Fetch the latest master SHA and compare it to the lock (network)',
    '',
    'Options:',
    '  --ref <sha> Sync a specific commit SHA instead of resolving master',
    '  --help      Show this message',
    '',
    `Upstream: ${UPSTREAM_REPO} (master)`,
    `Mirrored paths: ${MIRROR_PATHS.join(', ')}`,
    `OpenMapTiles tools version: ${TOOLS_VERSION}`
  ].join('\n');
}

function parseArguments(argv) {
  const options = { mode: 'sync', ref: null, help: false };
  const modes = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--sync') {
      modes.push('sync');
    } else if (argument === '--verify') {
      modes.push('verify');
    } else if (argument === '--check') {
      modes.push('check');
    } else if (argument === '--ref') {
      const value = argv[index + 1];
      if (value === undefined || value === '' || value.startsWith('--')) {
        throw new Error('--ref requires a commit SHA');
      }
      options.ref = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (modes.length > 1) {
    throw new Error('Choose only one of --sync, --verify or --check');
  }

  if (modes.length === 1) options.mode = modes[0];

  if (options.ref && options.mode !== 'sync') {
    throw new Error('--ref is only valid with --sync');
  }

  return options;
}

async function main(argv = process.argv.slice(2)) {
  let options;

  try {
    options = parseArguments(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  try {
    if (options.mode === 'verify') {
      const result = verifyMirror(resolvePaths({ root: DEFAULT_ROOT }));
      if (!result.ok) {
        console.error(result.message);
        process.exitCode = 1;
        return;
      }
      console.log(result.message);
      return;
    }

    if (options.mode === 'check') {
      const result = await checkUpstream({ root: DEFAULT_ROOT });
      console.log(result.message);
      if (!result.upToDate) process.exitCode = 1;
      return;
    }

    const result = await syncUpstream({
      root: DEFAULT_ROOT,
      ref: options.ref,
      log: (message) => console.log(message)
    });

    console.log(
      `Synced ${result.lock.paths.join(', ')} to ${result.mirrorDir}`
    );
    console.log(
      `  ${result.lock.fileCount} files, ${result.lock.manifestHash}`
    );
    console.log(`  lock ${result.lockPath}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  parseArguments,
  usage
};
