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
  SITE_PREFIX,
  assertSiteRoot,
  startSiteServer,
} = require('./lib/site-server.js');
const {
  buildLocalStyle,
  removeLocalStyles,
} = require('./screenshot.js');

const ROOT = path.join(__dirname, '..');
const SITE_ROOT = path.join(ROOT, '.output', 'public');
const HOST = '127.0.0.1';
const PORT = 11101;

function localStyleOverride(style, port, siteRoot) {
  const prepared = buildLocalStyle(style, port, { siteRoot });
  if (!prepared) {
    throw new Error(`No local style mapping for ${style}`);
  }
  return {
    name: prepared.name,
    body: `${JSON.stringify(prepared.document)}\n`,
    contentType: 'application/json',
  };
}

async function main() {
  assertSiteRoot(SITE_ROOT);
  removeLocalStyles({ siteRoot: SITE_ROOT });

  const dark = localStyleOverride('./style.json', PORT, SITE_ROOT);
  const light = localStyleOverride('./style-light.json', PORT, SITE_ROOT);
  const overrides = {
    [`${SITE_PREFIX}style.json`]: dark,
    [`${SITE_PREFIX}style-light.json`]: light,
    [`${SITE_PREFIX}${dark.name}`]: dark,
    [`${SITE_PREFIX}${light.name}`]: light,
  };

  const server = await startSiteServer({
    siteRoot: SITE_ROOT,
    port: PORT,
    host: HOST,
    overrides,
  });

  const address = server.address();
  console.log(
    `Serving ${SITE_ROOT} at http://${address.address}:${address.port}/basemap/`
  );

  const shutdown = () => {
    removeLocalStyles({ siteRoot: SITE_ROOT });
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
