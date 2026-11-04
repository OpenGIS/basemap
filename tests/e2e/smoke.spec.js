'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
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
} = require('./helpers');

const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'screenshots');
const TMP_DIR = path.join(__dirname, '..', '..', '.opencode', 'tmp');
const paletteData = require('../../app/assets/data/palette.json');

function paths(urls) {
  return urls.map(urlPath);
}

test.beforeAll(() => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
});

test('homepage defaults to the dark theme and native dark style', async ({ page }) => {
  const errors = collectErrors(page);
  const requests = trackRequests(page);

  await goto(page);
  await expect(page).toHaveTitle('Basemap — Open GIS');
  await waitForMap(page);
  await expect(page.locator('#map canvas')).toBeVisible();

  const state = await themeState(page);
  expect(state.theme).toBe('dark');
  expect(state.mapTheme).toBe('dark');
  expect(state.background).toBe(TOKENS.dark.background);
  expect(state.surface).toBe(TOKENS.dark.surface);

  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByRole('button', { name: 'Light' })).toHaveAttribute(
    'aria-pressed',
    'false'
  );

  await expect(page.locator('.maplibregl-ctrl-group')).toBeVisible();
  await expect(page.locator('.maplibregl-ctrl-attrib')).toBeVisible();

  const controls = await controlStyles(page);
  expect(controls.group['background-color']).toBe(
    hexToRgb(TOKENS.dark.surface)
  );
  expect(controls.attribution['background-color']).toBe(
    hexToRgb(TOKENS.dark.surface)
  );
  expect(controls.attribution.color).toBe(hexToRgb(TOKENS.dark.fg));
  expect(controls.attributionLink.color).toBe(hexToRgb(TOKENS.dark.accent));
  expect(controls.button.color).toBe(hexToRgb(TOKENS.dark.fg));
  expect(controls.separator['border-top-color']).toBe(
    hexToRgb(TOKENS.dark.border)
  );
  expect(controls.icon.filter).not.toBe('none');

  const styles = paths(nativeStyles(requests));
  expect(styles.length).toBeGreaterThan(0);
  expect(styles.every((stylePath) => stylePath === '/basemap/style.json')).toBe(true);
  expect(paths(overrideStyles(requests))).toEqual([]);
  expect(await page.getAttribute('body', 'data-map-error')).toBeNull();

  await page.waitForTimeout(750);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'home.png'),
    type: 'png',
  });

  expect(errors, errors.join('\n')).toEqual([]);
});

test('explicit light theme loads the native light style and palette', async ({ page }) => {
  const errors = collectErrors(page);
  const requests = trackRequests(page);

  await goto(page, { theme: 'light' });
  await waitForMap(page);

  const state = await themeState(page);
  expect(state.theme).toBe('light');
  expect(state.mapTheme).toBe('light');
  expect(state.background).toBe(TOKENS.light.background);
  expect(state.surface).toBe(TOKENS.light.surface);

  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await expect(page.getByRole('button', { name: 'Light' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  await expect(page.locator('.maplibregl-ctrl-group')).toBeVisible();
  await expect(page.locator('.maplibregl-ctrl-attrib')).toBeVisible();

  const controls = await controlStyles(page);
  expect(controls.group['background-color']).toBe(
    hexToRgb(TOKENS.light.surface)
  );
  expect(controls.attribution['background-color']).toBe(
    hexToRgb(TOKENS.light.surface)
  );
  expect(controls.attribution.color).toBe(hexToRgb(TOKENS.light.fg));
  expect(controls.attributionLink.color).toBe(hexToRgb(TOKENS.light.accent));
  expect(controls.button.color).toBe(hexToRgb(TOKENS.light.fg));
  expect(controls.separator['border-top-color']).toBe(
    hexToRgb(TOKENS.light.border)
  );
  expect(controls.icon.filter).toBe('none');

  const styles = paths(nativeStyles(requests));
  expect(styles.length).toBeGreaterThan(0);
  expect(styles.every((stylePath) => stylePath === '/basemap/style-light.json')).toBe(
    true
  );
  expect(paths(overrideStyles(requests))).toEqual([]);
  expect(await page.getAttribute('body', 'data-map-error')).toBeNull();

  await page.waitForTimeout(750);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'home-light.png'),
    type: 'png',
  });

  expect(errors, errors.join('\n')).toEqual([]);
});

test('theme toggle preserves the camera, cycles map readiness and clears the inspector', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const requests = trackRequests(page);

  await goto(page, { theme: 'dark' });
  await waitForMap(page);

  const inspector = await selectHealthPoi(page);
  await expect(inspector).toBeVisible();
  await expect(page.locator('.home-selection')).toBeVisible();
  await expect(inspector.locator('.home-inspector__facts')).toContainText('Health');

  const hashBefore = await cameraHash(page);
  await recordMapReady(page);

  await page.getByRole('button', { name: 'Light' }).click();
  await waitForMap(page);

  await expect(page.locator('.home-inspector')).toHaveCount(0);
  await expect(page.locator('.home-selection')).toHaveCount(0);
  expect(await cameraHash(page)).toBe(hashBefore);

  let state = await themeState(page);
  expect(state.theme).toBe('light');
  expect(state.mapTheme).toBe('light');
  expect(state.background).toBe(TOKENS.light.background);
  await expect(page.getByRole('button', { name: 'Light' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute(
    'aria-pressed',
    'false'
  );

  await page.getByRole('button', { name: 'Dark' }).click();
  await waitForMap(page);
  expect(await cameraHash(page)).toBe(hashBefore);

  state = await themeState(page);
  expect(state.theme).toBe('dark');
  expect(state.mapTheme).toBe('dark');
  expect(state.background).toBe(TOKENS.dark.background);
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByRole('button', { name: 'Light' })).toHaveAttribute(
    'aria-pressed',
    'false'
  );

  await page.waitForTimeout(100);
  expect(await readMapReadyLog(page)).toEqual(['1', '0', '1', '0', '1']);

  const styles = paths(nativeStyles(requests));
  expect(styles.filter((stylePath) => stylePath === '/basemap/style.json')).toHaveLength(2);
  expect(
    styles.filter((stylePath) => stylePath === '/basemap/style-light.json')
  ).toHaveLength(1);
  expect(paths(overrideStyles(requests))).toEqual([]);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('an explicit style override stays fixed while the site palette switches', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const requests = trackRequests(page);

  await goto(page, { theme: 'dark', style: './screenshot-style.json' });
  await waitForMap(page);

  expect((await themeState(page)).theme).toBe('dark');

  await page.getByRole('button', { name: 'Light' }).click();
  await waitForMap(page);

  let state = await themeState(page);
  expect(state.theme).toBe('light');
  expect(state.mapTheme).toBe('light');
  expect(state.background).toBe(TOKENS.light.background);

  await page.getByRole('button', { name: 'Dark' }).click();
  await waitForMap(page);

  state = await themeState(page);
  expect(state.theme).toBe('dark');
  expect(state.mapTheme).toBe('dark');
  expect(state.background).toBe(TOKENS.dark.background);

  const overrides = paths(overrideStyles(requests));
  expect(overrides).toEqual(['/basemap/screenshot-style.json']);
  expect(nativeStyles(requests)).toEqual([]);

  expect(errors, errors.join('\n')).toEqual([]);
});

for (const theme of ['dark', 'light']) {
  test(`inspector recolours the ${theme} palette and exports the document shape`, async ({
    page,
  }) => {
    const errors = collectErrors(page);

    await goto(page, { theme });
    await waitForMap(page);

    const inspector = await selectHealthPoi(page);
    await expect(inspector).toBeVisible();
    await expect(page.locator('.home-selection')).toBeVisible();
    await expect(page.locator('.home-inspector__icon')).toBeVisible();
    await expect(page.locator('.home-inspector__name')).not.toHaveText('');
    await expect(inspector.locator('.home-inspector__facts')).toContainText('Health');
    await expect(page.locator('.home-note')).toContainText(
      'Editing this role updates 4 icons.'
    );

    const expected = roleColour(theme, 'health');
    const hex = page.locator('.home-hex-input');
    await expect(hex).toHaveValue(expected);

    const mapClip = { x: 340, y: 0, width: 500, height: 400 };
    const beforeColour = await page.screenshot({ clip: mapClip, type: 'png' });

    await hex.fill('#12AB34');
    await hex.press('Enter');
    await page.waitForTimeout(400);
    const afterColour = await page.screenshot({ clip: mapClip, type: 'png' });
    expect(afterColour.equals(beforeColour)).toBe(false);

    await expect(hex).toHaveValue('#12AB34');
    await expect(page.locator('.home-colour-input')).toHaveValue('#12ab34');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export palette' }).click(),
    ]);

    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(exported.version).toBe(paletteData.palette.version);
    expect(Array.isArray(exported.roles)).toBe(true);
    expect(Array.isArray(exported.preserve)).toBe(true);
    expect(typeof exported.overrides).toBe('object');

    const health = exported.roles.find((role) => role.id === 'health');
    expect(health.color).toBe('#12AB34');
    expect(health.label).toBe('Health');
    await expect(page.locator('.home-status')).toContainText('Palette exported.');

    await page.screenshot({
      path: path.join(TMP_DIR, `home-inspector-${theme}.png`),
      type: 'png',
    });

    expect(errors, errors.join('\n')).toEqual([]);
  });
}
