#!/usr/bin/env node
//
// Captures a PNG screenshot of the basemap harness (index.html) for a given
// map state, using Playwright.
//
// Chromium blocks file:// fetches of style.json, so this script serves the
// repo root over a tiny throwaway static server (Node http + fs) on an
// ephemeral 127.0.0.1 port, then loads the harness with the state encoded in
// the query string and waits for the map's ready signal before shooting.
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
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DEFAULTS = {
  lat: 0,
  lng: 20,
  zoom: 2,
  pitch: 0,
  rotation: 0,
  width: 1200,
  height: 630,
  style: './style.json',
  out: 'screenshot.png',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.pbf': 'application/x-protobuf',
};

// --- throwaway static server ----------------------------------------------

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch (err) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const type = MIME[path.extname(filePath)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// --- screenshot flow ------------------------------------------------------

async function capture(opts) {
  const state = { ...DEFAULTS, ...opts };
  const qualityMode = Boolean(state.quality);

  const server = await startServer();
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
  const url = `http://127.0.0.1:${port}/index.html?${query}`;

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
    await page.screenshot({ path: state.out });
  } finally {
    await browser.close();
    server.close();
  }

  return { url, out: state.out, quality };
}

// --- CLI ------------------------------------------------------------------

function printUsage() {
  console.log(`Usage: node scripts/screenshot.js [options]

Options:
  --lat <n>       latitude in degrees (default ${DEFAULTS.lat})
  --lng <n>       longitude in degrees (default ${DEFAULTS.lng})
  --zoom <n>      zoom level (default ${DEFAULTS.zoom})
  --pitch <n>     pitch in degrees (default ${DEFAULTS.pitch})
  --rotation <n>  bearing in degrees (default ${DEFAULTS.rotation})
  --width <n>     viewport width in px (default ${DEFAULTS.width})
  --height <n>    viewport height in px (default ${DEFAULTS.height})
  --style <url>   style JSON URL (default ${DEFAULTS.style})
  --out <path>    output PNG path (default ${DEFAULTS.out})
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