#!/usr/bin/env node
//
// Serves the generated site artifact for the Playwright end-to-end suite.
//
// Mirrors GitHub Pages: .output/public is available under /basemap/ on
// 127.0.0.1:11101. Fails clearly when the artifact is missing, and shuts down
// cleanly on SIGTERM/SIGINT so Playwright's webServer can stop it.

'use strict';

const path = require('node:path');
const {
  assertSiteRoot,
  startSiteServer,
} = require('./lib/site-server.js');

const ROOT = path.join(__dirname, '..');
const SITE_ROOT = path.join(ROOT, '.output', 'public');
const HOST = '127.0.0.1';
const PORT = 11101;

async function main() {
  assertSiteRoot(SITE_ROOT);

  const server = await startSiteServer({
    siteRoot: SITE_ROOT,
    port: PORT,
    host: HOST,
  });

  const address = server.address();
  console.log(
    `Serving ${SITE_ROOT} at http://${address.address}:${address.port}/basemap/`
  );

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(`Test server failed: ${error.message}`);
  process.exitCode = 1;
});
