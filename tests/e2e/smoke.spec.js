'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'screenshots');

const SUMMARY_COUNTS = [
  ['Roles', 11],
  ['Icons', 129],
  ['Classes', 68],
  ['Missing', 91],
  ['Phantoms', 3],
];

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

async function waitForLazyImages(page, selector) {
  await page.evaluate(async (imageSelector) => {
    const step = Math.max(200, Math.round(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
  }, selector);

  await page.waitForFunction(
    (imageSelector) => {
      const images = Array.from(document.querySelectorAll(imageSelector));
      return (
        images.length > 0 &&
        images.every((image) => image.complete && image.naturalWidth > 0)
      );
    },
    selector,
    { timeout: 60000 }
  );
}

test.beforeAll(() => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

test('homepage renders the map with a readable state readout', async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto('./');
  await expect(page).toHaveTitle('Basemap — demo');
  await page.waitForSelector('body[data-map-ready="1"]', { timeout: 60000 });

  await expect(page.locator('#map canvas')).toBeVisible();

  const state = page.locator('#state');
  await expect(state).toContainText('0.0000, 20.0000');
  await expect(state).toHaveCSS('color', 'rgb(24, 40, 26)');

  expect(await page.getAttribute('body', 'data-map-error')).toBeNull();

  await page.waitForTimeout(750);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'home.png'),
    type: 'png',
  });

  expect(errors, errors.join('\n')).toEqual([]);
});

test('palette page lists the full icon set without errors', async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto('./palette/');
  await expect(page).toHaveTitle('Basemap palette');
  await expect(
    page.getByRole('heading', { name: 'Basemap palette', level: 1 })
  ).toBeVisible();

  for (const [label, value] of SUMMARY_COUNTS) {
    const count = page
      .locator('.palette-summary__counts div')
      .filter({ has: page.locator('dt', { hasText: label }) })
      .locator('dd');
    await expect(count).toHaveText(String(value));
  }

  await expect(page.locator('.palette-role-row')).toHaveCount(11);
  await expect(page.locator('.palette-icon')).toHaveCount(130);

  await waitForLazyImages(page, '.palette-icon__image');

  await page.evaluate(() => document.fonts.ready.then(() => true));

  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'palette.png'),
    type: 'png',
  });

  expect(errors, errors.join('\n')).toEqual([]);
});
