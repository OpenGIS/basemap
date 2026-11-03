#!/usr/bin/env node
//
// Captures a PNG or JPEG screenshot of the built basemap site for a given map
// state, using Playwright. The format is inferred from the output extension.
//
// Chromium blocks file:// fetches of style.json, so this script serves the
// generated artifact in .output/public over a tiny throwaway static server
// (Node http + fs) on an ephemeral 127.0.0.1 port. Every request must live
// under /basemap/, matching GitHub Pages, and the prefix is stripped to map
// onto the artifact directory. Run `npm run site:build` first.
//
// Zero-dependency aside from Playwright. Exports capture() so that
// scripts/random-map.js can reuse the same flow for a series of states.
//
// Usage:
//   node scripts/screenshot.js [--lat <n>] [--lng <n>] [--zoom <n>]
//     [--pitch <n>] [--rotation <n>] [--width <n>] [--height <n>]
//     [--style <url>] [--out <path>] [--help]

'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const {
  SITE_PREFIX,
  assertSiteRoot,
  startSiteServer,
} = require('./lib/site-server.js');

const ROOT = path.join(__dirname, '..');
const SITE_ROOT = path.join(ROOT, '.output', 'public');
const DEFAULTS = {
  lat: 0,
  lng: 20,
  zoom: 2,
  pitch: 0,
  rotation: 0,
  width: 1200,
  height: 630,
  style: './style.json',
  out: 'screenshots/home.png',
};

// --- screenshot flow ------------------------------------------------------

function imageFormat(out) {
  const extension = path.extname(out).toLowerCase();
  return extension === '.jpg' || extension === '.jpeg' ? 'jpeg' : 'png';
}

async function capture(opts) {
  const state = { ...DEFAULTS, ...opts };
  const qualityMode = Boolean(state.quality);
  const format = imageFormat(state.out);

  assertSiteRoot(SITE_ROOT);
  fs.mkdirSync(path.dirname(path.resolve(state.out)), { recursive: true });

  const server = await startSiteServer({ siteRoot: SITE_ROOT });
  const port = server.address().port;
  const query = new URLSearchParams({
    lat: state.lat,
    lng: state.lng,
    zoom: state.zoom,
    pitch: state.pitch,
    rotation: state.rotation,
    width: state.width,
    height: state.height,
    style: state.style,
  });
  if (qualityMode) query.set('quality', '1');
  const url = `http://127.0.0.1:${port}${SITE_PREFIX}index.html?${query}`;

  let quality = null;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: state.width, height: state.height },
    });
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    try {
      await page.waitForSelector('body[data-map-ready]', { timeout: 60000 });
    } catch (waitErr) {
      if (await page.$('body[data-map-error]')) {
        throw new Error('Map failed to load — check the style URL and network access');
      }
      throw waitErr;
    }

    if (qualityMode) {
      await page.waitForSelector('body[data-map-quality]', { timeout: 10000 });
      const value = await page.getAttribute('body', 'data-map-quality');
      quality = Number(value);
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
    if (format === 'jpeg') {
      await page.screenshot({ path: state.out, type: 'jpeg', quality: 80 });
    } else {
      await page.screenshot({ path: state.out, type: 'png' });
    }
  } finally {
    await browser.close();
    server.close();
  }

  return { url, out: state.out, format, quality };
}

// --- CLI ------------------------------------------------------------------

function printUsage() {
  console.log(`Usage: node scripts/screenshot.js [options]

Serves .output/public under /basemap/; run npm run site:build first.

Options:
  --lat <n>       latitude in degrees (default ${DEFAULTS.lat})
  --lng <n>       longitude in degrees (default ${DEFAULTS.lng})
  --zoom <n>      zoom level (default ${DEFAULTS.zoom})
  --pitch <n>     pitch in degrees (default ${DEFAULTS.pitch})
  --rotation <n>  bearing in degrees (default ${DEFAULTS.rotation})
  --width <n>     viewport width in px (default ${DEFAULTS.width})
  --height <n>    viewport height in px (default ${DEFAULTS.height})
  --style <url>   style JSON URL (default ${DEFAULTS.style})
  --out <path>    output image path; .jpg/.jpeg uses JPEG quality 80
                  (default ${DEFAULTS.out})
  --help          show this message`);
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const match = arg.match(/^--([a-z]+)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    const key = match[1];
    let value = match[2];
    if (key === 'help') {
      opts.help = true;
      continue;
    }
    if (value === undefined) {
      value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for --${key}`);
    }
    if (key !== 'style' && key !== 'out') {
      const num = Number(value);
      if (!Number.isFinite(num)) throw new Error(`--${key} expects a number, got "${value}"`);
      value = num;
    }
    opts[key] = value;
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    return;
  }
  const state = { ...DEFAULTS, ...opts };
  const { url, out } = await capture(state);
  console.log(
    `Captured ${out} (${state.width}x${state.height}) — lat ${state.lat}, lng ${state.lng}, ` +
    `zoom ${state.zoom}, pitch ${state.pitch}, rotation ${state.rotation}, style ${state.style}`
  );
  console.log(url);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { capture };