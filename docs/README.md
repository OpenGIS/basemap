---
git_hash: "e35c39f2d22517c63b16b59c666e03b82764ce66"
modified: "2026-08-23"
---

# Basemap Documentation

Developer-focused documentation for the [Basemap](../README.md) codebase — a self-hosted MapLibre GL style built from the OpenMapTiles "OSM" vector style and OpenFreeMap tiles.

## Reading Order

1. [Getting started](1.start.md) — what this is, the published URLs, and the repository layout
2. [Build pipeline](2.build.md) — how `scripts/build.sh` produces the published artifacts
3. [Remixing the style](3.remixing.md) — modifying layers, rebuilding and republishing

## Quick Links

- [Main README](../README.md)
- [Published style](../style.json)
- [Build script](../scripts/build.sh)
- [Font merge script](../scripts/merge-fonts.js)
- [Vendored upstream source](../vendor/openmaptiles/)

## Documentation Coverage

This documentation covers:

- Project purpose and published endpoints
- The full build pipeline (docker recompose, sprite generation, URL rewrite, font merging)
- How to customise the style and republish

For API references and inline documentation, see source code comments.