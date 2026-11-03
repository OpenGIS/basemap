'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let mapState;

test.before(async () => {
  mapState = await import(
    pathToFileURL(path.join(__dirname, '..', 'app', 'utils', 'mapState.js')).href
  );
});

test('parseMapHash reads five numeric components with negatives and decimals', () => {
  assert.deepEqual(
    mapState.parseMapHash('#map=17.5/51.5154/-0.1755/-12.25/45.75'),
    { zoom: 17.5, lat: 51.5154, lng: -0.1755, pitch: -12.25, rotation: 45.75 }
  );

  assert.deepEqual(
    mapState.parseMapHash('map=17/51.5154/-0.1755/0/0'),
    { zoom: 17, lat: 51.5154, lng: -0.1755, pitch: 0, rotation: 0 }
  );
});

test('parseMapHash rejects missing and malformed hashes', () => {
  const invalid = [
    undefined,
    null,
    '',
    '   ',
    '#',
    '#map',
    '#map=',
    '#map=17/51.5/-0.17/0',
    '#map=17/51.5/-0.17/0/0/0',
    '#map=a/51.5/-0.17/0/0',
    '#map=17/51.5/-0.17/0/',
    '#other=17/51.5/-0.17/0/0'
  ];

  for (const hash of invalid) {
    assert.equal(mapState.parseMapHash(hash), null, `${String(hash)} should be rejected`);
  }
});

test('formatMapHash rounds zoom, pitch and bearing and fixes lat/lng precision', () => {
  assert.equal(
    mapState.formatMapHash({
      zoom: 17.6,
      lat: 51.5154,
      lng: -0.1755,
      pitch: 12.4,
      rotation: 359.6
    }),
    '#map=18/51.515400/-0.175500/12/360'
  );

  assert.equal(
    mapState.formatMapHash({
      zoom: '17',
      lat: '51',
      lng: '-0.1',
      pitch: '0',
      rotation: '90.5'
    }),
    '#map=17/51.000000/-0.100000/0/91'
  );
});

test('formatMapHash returns an empty string for invalid state', () => {
  const invalid = [
    null,
    undefined,
    {},
    { zoom: 1, lat: 2, lng: 3, pitch: 4 },
    { zoom: NaN, lat: 2, lng: 3, pitch: 4, rotation: 5 }
  ];

  for (const state of invalid) {
    assert.equal(mapState.formatMapHash(state), '');
  }
});

test('readMapState prefers a valid hash over legacy query parameters', () => {
  assert.deepEqual(
    mapState.readMapState(
      '?lat=1&lng=2&zoom=3&pitch=4&rotation=5',
      '#map=10/20.5/30.25/40/50'
    ),
    { zoom: 10, lat: 20.5, lng: 30.25, pitch: 40, rotation: 50 }
  );

  assert.deepEqual(
    mapState.readMapState(
      new URLSearchParams('lat=1&lng=2'),
      '#map=10/20/30/40/50'
    ),
    { zoom: 10, lat: 20, lng: 30, pitch: 40, rotation: 50 }
  );
});

test('readMapState falls back to legacy query parameters per field', () => {
  assert.deepEqual(
    mapState.readMapState('?lat=12.5&lng=nope&zoom=9&pitch=&rotation=45'),
    { lat: 12.5, lng: -0.1755, zoom: 9, pitch: 0, rotation: 45 }
  );

  assert.deepEqual(
    mapState.readMapState(
      new URLSearchParams('lat=1&lng=2&zoom=3&pitch=4&rotation=5')
    ),
    { lat: 1, lng: 2, zoom: 3, pitch: 4, rotation: 5 }
  );
});

test('readMapState returns the defaults when neither hash nor query is present', () => {
  assert.deepEqual(mapState.readMapState('', ''), mapState.MAP_DEFAULTS);
  assert.deepEqual(mapState.readMapState(undefined, undefined), mapState.MAP_DEFAULTS);
  assert.deepEqual(mapState.readMapState('?lat=nope', '#bad'), mapState.MAP_DEFAULTS);
});
