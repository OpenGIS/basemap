'use strict';

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: 'http://127.0.0.1:11101/basemap/',
    viewport: { width: 1200, height: 630 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/test-server.js',
    url: 'http://127.0.0.1:11101/basemap/',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
