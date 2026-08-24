---
git_hash: "e8f95412c15b4b2f79d73487802e88db0957e87b"
modified: "2026-08-24"
---

# Basemap Documentation

Developer-focused documentation for the [Basemap](../README.md) codebase — a self-hosted MapLibre GL style built from the OpenMapTiles "OSM" vector style and OpenFreeMap tiles.

## Reading Order

1. [Getting started](1.start.md) — what this is, the published URLs, and the repository layout
2. [Build pipeline](2.build.md) — how `scripts/build.sh` produces the published artifacts
3. [Remixing the style](3.remixing.md) — modifying layers, rebuilding and republishing
4. [Screenshot pipeline](4.screenshots.md) — the state-driven demo harness and Playwright capture tools

## Quick Links

- [Main README](../README.md)
- [Published style](../style.json)
- [Build script](../scripts/build.sh)
- [Font merge script](../scripts/merge-fonts.js)
- [Screenshot script](../scripts/screenshot.js)
- [Random map script](../scripts/random-map.js)
- [Vendored upstream source](../vendor/openmaptiles/)

## Documentation Coverage

This documentation covers:

- Project purpose and published endpoints
- The full build pipeline (docker recompose, sprite generation, URL rewrite, font merging, random screenshot)
- How to customise the style and republish
- The demo harness state URL API and the Playwright screenshot tools

For API references and inline documentation, see source code comments.