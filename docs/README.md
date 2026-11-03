---
git_hash: "c17627d5b841d896f1cb3592074b8b69a4e37939"
modified: "2026-11-02"
---

# Basemap Documentation

Developer-focused documentation for the [Basemap](../README.md) codebase — a self-hosted MapLibre GL style built from the OpenMapTiles "OSM" vector style and OpenFreeMap tiles, served by a single root Nuxt site with a map demo and palette editor.

## Reading Order

1. [Getting started](1.start.md) — what this is, the published URLs, and the repository layout
2. [Build pipeline](2.build.md) — how `scripts/build.sh` produces the map artefacts and the deployable site
3. [Remixing the style](3.remixing.md) — modifying layers, rebuilding and republishing
4. [Screenshot pipeline](4.screenshots.md) — the state-driven demo page and Playwright capture tools
5. [Icon palette](5.palette.md) — how icon colours are defined, mapped to POI classes, and changed
6. [Site and palette editor](6.site.md) — the single Nuxt site, generated palette data, site build and Pages deployment

## Quick Links

- [Main README](../README.md)
- [Root Nuxt app](../app/)
- [Map demo page](../app/pages/index.vue)
- [Palette editor page](../app/pages/palette.vue)
- [Published style](../style.json)
- [Palette source](../palette.json)
- [Generated palette data](../app/assets/data/)
- [Palette data script](../scripts/palette-data.js)
- [Site build script](../scripts/site-build.js)
- [Pages workflow](../.github/workflows/pages.yml)
- [CI workflow](../.github/workflows/ci.yml)
- [Build script](../scripts/build.sh)
- [Font merge script](../scripts/merge-fonts.js)
- [Screenshot script](../scripts/screenshot.js)
- [Random map script](../scripts/random-map.js)
- [Vendored upstream source](../vendor/openmaptiles/)
- [Third-party notices](../THIRD_PARTY_NOTICES.md)

## Documentation Coverage

This documentation covers:

- Project purpose, published endpoints and repository layout
- The full map build pipeline (palette staging, docker recompose, sprite generation, URL rewrite, font merging, site build, random screenshot)
- The palette model, role mapping and SVG recolour pipeline
- The single Nuxt site, its routes, generated palette data and Pages deployment
- How to customise the style and republish
- The demo page state URL API and the Playwright screenshot tools
- Icon palette groups, POI class/subclass mapping, and the palette editing workflow

For API references and inline documentation, see source code comments.
