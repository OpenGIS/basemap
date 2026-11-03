'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'screenshots');
const TMP_DIR = path.join(__dirname, '..', '..', '.opencode', 'tmp');

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

test.beforeAll(() => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
});

test('homepage renders the map with a readable state readout', async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto('./?style=./screenshot-style.json#map=17/51.515400/-0.175500/0/0');
  await expect(page).toHaveTitle('Basemap — Open GIS');
  await page.waitForSelector('body[data-map-ready="1"]', { timeout: 60000 });

  await expect(page.locator('#map canvas')).toBeVisible();

  const hash = await page.evaluate(() => window.location.hash);
  expect(hash).toMatch(
    /^#map=\d+\/-?\d+\.\d{6}\/-?\d+\.\d{6}\/-?\d+\/-?\d+$/
  );

  const state = page.locator('#state');
  await expect(state).toBeVisible();
  await expect(state).toContainText('51.5154, -0.1755');
  await expect(state).toContainText('z 17.0');
  expect((await state.textContent()).trim().length).toBeGreaterThan(0);

  expect(await page.getAttribute('body', 'data-map-error')).toBeNull();

  await page.waitForTimeout(750);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'home.png'),
    type: 'png',
  });

  expect(errors, errors.join('\n')).toEqual([]);
});

test('homepage inspector recolours a role and exports the palette', async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto('./?style=./screenshot-style.json#map=17/51.515400/-0.175500/0/0');
  await page.waitForSelector('body[data-map-ready="1"]', { timeout: 60000 });

  await page.getByRole('button', { name: 'Inspect POIs' }).click();
  await page.locator('#map canvas').click({ position: { x: 500, y: 120 } });

  const inspector = page.locator('.home-inspector');
  await expect(inspector).toBeVisible();
  await expect(page.locator('.home-selection')).toBeVisible();
  await expect(page.locator('.home-inspector__icon')).toBeVisible();
  await expect(page.locator('.home-inspector__name')).not.toHaveText('');
  await expect(page.locator('.home-inspector__facts')).toContainText('Health');
  await expect(page.locator('.home-note')).toContainText(
    'Editing this role updates 4 icons.'
  );

  const mapClip = { x: 340, y: 0, width: 500, height: 400 };
  const beforeColour = await page.screenshot({ clip: mapClip, type: 'png' });

  const hex = page.locator('.home-hex-input');
  await expect(hex).toHaveValue('#FF004D');
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
  const health = exported.roles.find((role) => role.id === 'health');
  expect(health.color).toBe('#12AB34');
  await expect(page.locator('.home-status')).toContainText('Palette exported.');

  await page.screenshot({
    path: path.join(TMP_DIR, 'home-inspector.png'),
    type: 'png',
  });

  expect(errors, errors.join('\n')).toEqual([]);
});
