'use strict';

//
// Shared static server for the generated basemap artifact.
//
// Serves .output/public under /basemap/ so the screenshot harness and the
// Playwright end-to-end suite exercise the same URL layout as GitHub Pages.
// Request-to-file mapping lives in scripts/site-build.js; this module only
// adds HTTP handling and MIME types.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { mapRequestToFile, SITE_PREFIX } = require('../site-build.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pbf': 'application/x-protobuf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

function contentTypeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function createRequestHandler(siteRoot, { overrides = {} } = {}) {
  return (req, res) => {
    let requestPath;
    try {
      requestPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch (error) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }

    const override = overrides[requestPath];
    if (override !== undefined) {
      const body = override && typeof override === 'object' && !Buffer.isBuffer(override)
        ? override.body
        : override;
      const contentType =
        override && typeof override === 'object' && !Buffer.isBuffer(override)
          ? override.contentType
          : null;
      res.writeHead(200, {
        'Content-Type': contentType || contentTypeFor(requestPath),
      });
      res.end(body);
      return;
    }

    const mapped = mapRequestToFile(requestPath, siteRoot);
    if (mapped.status !== 200) {
      res.writeHead(mapped.status);
      res.end(mapped.status === 404 ? 'Not found' : 'Forbidden');
      return;
    }

    fs.readFile(mapped.filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentTypeFor(mapped.filePath) });
      res.end(data);
    });
  };
}

function startSiteServer({ siteRoot, port = 0, host = '127.0.0.1', overrides = {} } = {}) {
  const server = http.createServer(createRequestHandler(siteRoot, { overrides }));
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve(server);
    });
  });
}

function assertSiteRoot(siteRoot) {
  const index = path.join(siteRoot, 'index.html');
  if (!fs.existsSync(index)) {
    throw new Error(
      `Missing site build at ${index} — run npm run site:build first`
    );
  }
}

module.exports = {
  MIME,
  SITE_PREFIX,
  assertSiteRoot,
  contentTypeFor,
  createRequestHandler,
  startSiteServer,
};
