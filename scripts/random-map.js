#!/usr/bin/env node
//
// Renders a random, nice-looking basemap screenshot for the README.
//
// Picks a random land point anywhere on Earth using Natural Earth 110m land
// polygons (fetched once and cached in build/land-110m.geojson), then reuses
// the capture() pipeline from scripts/screenshot.js to produce a 1200x630 PNG.
// Each render is quality-gated — the harness reports a data-map-quality score
// — and re-rolled up to fifteen times if it falls below the threshold. The
// script fails loudly when land data is unavailable or no render clears the
// quality threshold.
//
// Zero-dependency aside from Playwright (via screenshot.js). Fails loudly if
// the capture fails so the build never silently skips this step.
//
// Usage:
//   node scripts/random-map.js [--out <path>] [--help]

'use strict';

const fs = require('fs');
const path = require('path');
const { capture } = require('./screenshot.js');

const ROOT = path.join(__dirname, '..');
const WIDTH = 1200;
const HEIGHT = 630;

const LAND_SOURCE =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson';
const LAND_CACHE = path.join(ROOT, 'build', 'land-110m.geojson');

// Tuned empirically from test renders — boring scenes (Siberia tundra 0.009,
// Sahara 0.011, open ocean 0.015) and marginal ones (arid Kenyan scrub 0.022)
// sit below the threshold while interesting ones (Matterhorn 0.032, London
// 0.035, Brazilian cerrado 0.045, Grand Canyon 0.079) clear it comfortably.
const QUALITY_THRESHOLD = 0.03;

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

// --- land data ------------------------------------------------------------

let landRings = null; // parsed land rings, loaded once on first use

// Loads Natural Earth 110m land polygons from the cache if present, otherwise
// fetches and caches them. Returns the ring list, or an empty list when land
// data is unavailable (the caller then fails loudly).
async function loadLand() {
  if (landRings !== null) return landRings;
  let data = null;
  if (fs.existsSync(LAND_CACHE)) {
    try {
      data = JSON.parse(fs.readFileSync(LAND_CACHE, 'utf8'));
    } catch (err) {
      console.warn(`Warning: could not read cached land data (${err.message}); refetching`);
    }
  }
  if (data === null) {
    try {
      const res = await fetch(LAND_SOURCE);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      try {
        fs.mkdirSync(path.dirname(LAND_CACHE), { recursive: true });
        fs.writeFileSync(LAND_CACHE, JSON.stringify(data));
      } catch (err) {
        console.warn(`Warning: could not cache land data (${err.message}); using in-memory copy`);
      }
    } catch (err) {
      console.warn(`Warning: could not fetch land data (${err.message}); will fail`);
      return (landRings = []);
    }
  }
  landRings = [];
  const features = data.type === 'FeatureCollection' ? data.features : [];
  for (const feature of features) {
    const geometry = feature && feature.geometry;
    if (!geometry) continue;
    if (geometry.type === 'Polygon') {
      collectRing(geometry.coordinates[0]); // exterior ring only (no holes)
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates) collectRing(polygon[0]);
    }
  }
  return landRings;
}

// Collects a ring with a precomputed bounding box for fast rejection.
function collectRing(ring) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  landRings.push({ ring, bbox: [minLng, minLat, maxLng, maxLat] });
}

// --- point-in-polygon -----------------------------------------------------

// Ray-casting even-odd test against a single ring. Returns true when the
// point lies inside the ring.
function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lngI, latI] = ring[i];
    const [lngJ, latJ] = ring[j];
    if (
      latI > lat !== latJ > lat &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI
    ) {
      inside = !inside;
    }
  }
  return inside;
}

// Returns true when the point sits on land (inside any collected ring).
function isOnLand(lat, lng) {
  if (landRings === null) return false; // land data not loaded yet
  for (const { ring, bbox } of landRings) {
    if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    if (pointInRing(lat, lng, ring)) return true;
  }
  return false;
}

// Uniform lat in [-85, 85] (skipping polar ice) and lng in [-180, 180], up to
// 100 tries to land on land. Returns the point, or null (essentially
// impossible).
function pickRandomLandPoint() {
  for (let i = 0; i < 100; i++) {
    const lat = Math.random() * 170 - 85;
    const lng = Math.random() * 360 - 180;
    if (isOnLand(lat, lng)) return { lat, lng };
  }
  return null;
}

// --- state selection ------------------------------------------------------

// Each capture attempt takes ~10-20s (map load + idle), so the worst case —
// fifteen re-rolls, then fails loudly — is roughly 3-5 minutes.
async function pickState(out) {
  const rings = await loadLand();
  if (rings.length === 0) {
    throw new Error('Land data unavailable — no cache and fetch failed; cannot pick a random land point');
  }
  for (let attempt = 0; attempt < 15; attempt++) {
    const point = pickRandomLandPoint();
    if (point === null) break;
    // Bias towards detail: 70% of attempts zoom 12-14, 30% zoom 10-12.
    const zoom = Math.random() < 0.7 ? randFloat(12, 14) : randFloat(10, 12);
    const state = {
      lat: point.lat,
      lng: point.lng,
      zoom: Math.round(zoom * 10) / 10,
      pitch: randInt(0, 60),
      rotation: randInt(0, 359),
      width: WIDTH,
      height: HEIGHT,
    };
    const result = await capture({ ...state, quality: true, out });
    state.url = result.url;
    if (result.quality >= QUALITY_THRESHOLD) {
      return { state, quality: result.quality };
    }
  }
  throw new Error('No random land point reached the quality threshold after 15 attempts');
}

function printUsage() {
  console.log(`Usage: node scripts/random-map.js [options]

Options:
  --out <path>  output PNG path (default screenshot.png)
  --help        show this message`);
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') {
      opts.help = true;
    } else if (arg === '--out') {
      opts.out = argv[++i];
      if (opts.out === undefined) throw new Error('Missing value for --out');
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    return;
  }
  const out = opts.out || 'screenshot.png';
  const { state, quality } = await pickState(out);
  console.log(
    `Captured ${out} (${state.width}x${state.height}) — lat ${state.lat}, ` +
      `lng ${state.lng}, zoom ${state.zoom}, pitch ${state.pitch}, rotation ${state.rotation}, ` +
      `quality ${quality}`
  );
  console.log(state.url);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { pickState, isOnLand };