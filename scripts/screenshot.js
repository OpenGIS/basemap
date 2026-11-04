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
// Zero-dependency aside from Playwright. Exports capture() for programmatic
// screenshots.
//
// Map state (lat, lng, zoom, pitch, rotation) is written to the URL hash;
// width, height, theme, style and quality are the only query parameters.
// Without an explicit --style, --theme selects the matching native style.
//
// Usage:
//   node scripts/screenshot.js [--lat <n>] [--lng <n>] [--zoom <n>]
//     [--pitch <n>] [--rotation <n>] [--width <n>] [--height <n>]
//     [--theme dark|light] [--style <url>] [--out <path>] [--help]

'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const {
  SITE_PREFIX,
  assertSiteRoot,
  startSiteServer,
} = require('./lib/site-server.js');

const ROOT = path.join(__dirname, '..');
const SITE_ROOT = path.join(ROOT, '.output', 'public');
const LOCAL_STYLES = Object.freeze([
  {
    source: 'style.json',
    sprite: 'sprite',
    name: 'screenshot-style.json',
  },
  {
    source: 'style-light.json',
    sprite: 'sprite-light',
    name: 'screenshot-light-style.json',
  },
]);
const DEFAULTS = {
  lat: 51.5154,
  lng: -0.1755,
  zoom: 17,
  pitch: 0,
  rotation: 0,
  width: 1200,
  height: 630,
  theme: 'dark',
  style: null,
  out: 'screenshots/home.png',
};

// --- screenshot flow ------------------------------------------------------

function imageFormat(out) {
  const extension = path.extname(out).toLowerCase();
  return extension === '.jpg' || extension === '.jpeg' ? 'jpeg' : 'png';
}

function resolveTheme(value) {
  return value === 'light' ? 'light' : 'dark';
}

function themeStyle(theme) {
  return theme === 'light' ? './style-light.json' : './style.json';
}

function localStyleMapping(style) {
  const normalised = String(style || '').replace(/^\.\//, '');
  return LOCAL_STYLES.find((entry) => entry.source === normalised) || null;
}

function buildLocalStyle(style, port, { siteRoot = SITE_ROOT } = {}) {
  const mapping = localStyleMapping(style);
  if (!mapping) return null;

  const source = path.join(siteRoot, mapping.source);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing ${source}; run npm run site:build first`);
  }

  const local = JSON.parse(fs.readFileSync(source, 'utf8'));
  local.sprite = `http://127.0.0.1:${port}${SITE_PREFIX}${mapping.sprite}`;
  local.glyphs = `http://127.0.0.1:${port}${SITE_PREFIX}fonts/{fontstack}/{range}.pbf`;

  return { name: mapping.name, document: local };
}

function prepareLocalStyle(style, port, { siteRoot = SITE_ROOT } = {}) {
  const prepared = buildLocalStyle(style, port, { siteRoot });
  if (!prepared) return style;

  fs.writeFileSync(
    path.join(siteRoot, prepared.name),
    `${JSON.stringify(prepared.document)}\n`
  );
  return `./${prepared.name}`;
}

function removeLocalStyles({ siteRoot = SITE_ROOT } = {}) {
  for (const mapping of LOCAL_STYLES) {
    fs.rmSync(path.join(siteRoot, mapping.name), { force: true });
  }
}

async function capture(opts) {
  const state = { ...DEFAULTS, ...opts };
  state.theme = resolveTheme(state.theme);
  const qualityMode = Boolean(state.quality);
  const format = imageFormat(state.out);

  const mapStateUrl = pathToFileURL(
    path.join(ROOT, 'app', 'utils', 'mapState.js')
  ).href;
  const { formatMapHash } = await import(mapStateUrl);

  assertSiteRoot(SITE_ROOT);
  fs.mkdirSync(path.dirname(path.resolve(state.out)), { recursive: true });

  const server = await startSiteServer({ siteRoot: SITE_ROOT });
  let browser = null;
  let url = '';
  let quality = null;

  try {
    const port = server.address().port;
    state.style = prepareLocalStyle(
      state.style || themeStyle(state.theme),
      port
    );

    const query = new URLSearchParams({
      width: state.width,
      height: state.height,
      theme: state.theme,
      style: state.style,
    });
    if (qualityMode) query.set('quality', '1');
    const hash = formatMapHash({
      zoom: state.zoom,
      lat: state.lat,
      lng: state.lng,
      pitch: state.pitch,
      rotation: state.rotation,
    });
    url = `http://127.0.0.1:${port}${SITE_PREFIX}index.html?${query}${hash}`;

    browser = await chromium.launch();
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
    if (browser) {
      await browser.close().catch(() => {});
    }
    await new Promise((resolve) => server.close(resolve));
    removeLocalStyles();
  }

  return { url, out: state.out, format, quality, theme: state.theme };
}

// --- CLI ------------------------------------------------------------------

function printUsage() {
  console.log(`Usage: node scripts/screenshot.js [options]

Serves .output/public under /basemap/; run npm run site:build first.

Map state (lat, lng, zoom, pitch, rotation) is written to the URL hash.
Only rendering options — width, height, theme, style and quality — are query
parameters. Without --style, --theme selects ./style.json (dark) or
./style-light.json (light).

Options:
  --lat <n>       latitude in degrees (default ${DEFAULTS.lat})
  --lng <n>       longitude in degrees (default ${DEFAULTS.lng})
  --zoom <n>      zoom level (default ${DEFAULTS.zoom})
  --pitch <n>     pitch in degrees (default ${DEFAULTS.pitch})
  --rotation <n>  bearing in degrees (default ${DEFAULTS.rotation})
  --width <n>     viewport width in px (default ${DEFAULTS.width})
  --height <n>    viewport height in px (default ${DEFAULTS.height})
  --theme <name>  dark or light (default ${DEFAULTS.theme})
  --style <url>   style JSON URL; overrides the theme's style
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
    if (key !== 'style' && key !== 'out' && key !== 'theme') {
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

  const theme = resolveTheme(opts.theme);
  if (opts.theme !== undefined && opts.theme !== 'dark' && opts.theme !== 'light') {
    throw new Error(`--theme expects dark or light, got "${opts.theme}"`);
  }
  const style = opts.style || themeStyle(theme);
  const state = { ...DEFAULTS, ...opts, theme, style };

  const cleanup = () => removeLocalStyles();
  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  const { url, out } = await capture(state);
  console.log(
    `Captured ${out} (${state.width}x${state.height}) — lat ${state.lat}, lng ${state.lng}, ` +
    `zoom ${state.zoom}, pitch ${state.pitch}, rotation ${state.rotation}, ` +
    `theme ${state.theme}, style ${state.style}`
  );
  console.log(url);
}

if (require.main === module) {
  main().catch((err) => {
    removeLocalStyles();
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  capture,
  LOCAL_STYLES,
  buildLocalStyle,
  localStyleMapping,
  prepareLocalStyle,
  removeLocalStyles,
};