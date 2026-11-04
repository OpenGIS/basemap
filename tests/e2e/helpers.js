'use strict';

const paletteData = require('../../app/assets/data/palette.json');

const DEFAULT_HASH = '#map=17/51.515400/-0.175500/0/0';

const PALETTES = {
  dark: paletteData.themes.dark.palette,
  light: paletteData.palette,
};

const TOKENS = {
  dark: {
    background: '#000b00',
    surface: '#001300',
    border: '#0e3111',
    fg: '#eeeeee',
    accent: '#0dd70d',
  },
  light: {
    background: '#fcfaf5',
    surface: '#fffefb',
    border: '#dddccd',
    fg: '#2b3129',
    accent: '#0a7d0a',
  },
};

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return `rgb(${parseInt(value.slice(0, 2), 16)}, ${parseInt(
    value.slice(2, 4),
    16
  )}, ${parseInt(value.slice(4, 6), 16)})`;
}

function roleColour(theme, roleId) {
  const role = PALETTES[theme].roles.find((candidate) => candidate.id === roleId);
  if (!role) throw new Error(`Unknown ${theme} palette role: ${roleId}`);
  return role.color;
}

function collectErrors(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}

function trackRequests(page) {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  return requests;
}

function nativeStyles(requests) {
  return requests.filter((url) => /\/basemap\/style(?:-light)?\.json$/.test(url));
}

function overrideStyles(requests) {
  return requests.filter((url) =>
    /\/basemap\/screenshot(?:-light)?-style\.json$/.test(url)
  );
}

function urlPath(url) {
  try {
    return new URL(url).pathname;
  } catch (error) {
    return url;
  }
}

async function goto(page, { theme, style, hash = DEFAULT_HASH } = {}) {
  const params = new URLSearchParams();
  if (theme) params.set('theme', theme);
  if (style) params.set('style', style);
  const query = params.toString();
  await page.goto(`./${query ? `?${query}` : ''}${hash}`);
}

async function waitForMap(page) {
  await page.waitForSelector('body[data-map-ready="1"]', { timeout: 60000 });
}

async function themeState(page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      theme: document.documentElement.dataset.theme,
      mapTheme: document.body.dataset.mapTheme,
      background: style.getPropertyValue('--ogis-bg').trim(),
      surface: style.getPropertyValue('--ogis-surface').trim(),
    };
  });
}

async function controlStyles(page) {
  return page.evaluate(() => {
    const read = (selector, properties) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return Object.fromEntries(
        properties.map((property) => [property, style.getPropertyValue(property)])
      );
    };

    return {
      group: read('.maplibregl-ctrl-group', ['background-color']),
      button: read('.maplibregl-ctrl-group button', ['color']),
      separator: read('.maplibregl-ctrl-group button + button', [
        'border-top-color',
      ]),
      icon: read('.maplibregl-ctrl-group .maplibregl-ctrl-icon', ['filter']),
      attribution: read('.maplibregl-ctrl-attrib', [
        'background-color',
        'color',
      ]),
      attributionButton: read('.maplibregl-ctrl-attrib-button', [
        'background-color',
      ]),
      attributionLink: read('.maplibregl-ctrl-attrib a', ['color']),
    };
  });
}

async function selectHealthPoi(page) {
  await page.getByRole('button', { name: 'Inspect POIs' }).click();
  await page.locator('#map canvas').click({ position: { x: 500, y: 120 } });
  const inspector = page.locator('.home-inspector');
  await inspector.waitFor({ state: 'visible' });
  return inspector;
}

async function cameraHash(page) {
  return page.evaluate(() => window.location.hash);
}

async function recordMapReady(page) {
  await page.evaluate(() => {
    window.__mapReadyLog = [document.body.dataset.mapReady];
    window.__mapReadyObserver = new MutationObserver(() => {
      const value = document.body.dataset.mapReady;
      if (window.__mapReadyLog[window.__mapReadyLog.length - 1] !== value) {
        window.__mapReadyLog.push(value);
      }
    });
    window.__mapReadyObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-map-ready'],
    });
  });
}

async function readMapReadyLog(page) {
  return page.evaluate(() => {
    if (window.__mapReadyObserver) window.__mapReadyObserver.disconnect();
    return window.__mapReadyLog || [];
  });
}

module.exports = {
  DEFAULT_HASH,
  TOKENS,
  cameraHash,
  collectErrors,
  controlStyles,
  goto,
  hexToRgb,
  nativeStyles,
  overrideStyles,
  readMapReadyLog,
  recordMapReady,
  roleColour,
  selectHealthPoi,
  themeState,
  trackRequests,
  urlPath,
  waitForMap,
};
