---
git_hash: "52e0ea07aa5891cc06fb2478f778ffa1e00cffd7"
modified: "2026-11-03"
---

# Basemap Documentation

Developer-focused documentation for the [Basemap](../README.md) codebase — a self-hosted MapLibre GL style built from the OpenMapTiles "OSM" vector style and OpenFreeMap tiles, served by a single root Nuxt site whose homepage is a full-screen basemap with a live palette inspector.

## Reading Order

1. [Getting started](1.start.md) — what this is, the published URLs, and the repository layout
2. [Build pipeline](2.build.md) — how `scripts/build.sh` produces the map artefacts and the deployable site
3. [Remixing the style](3.remixing.md) — modifying layers, rebuilding and republishing
4. [Screenshot pipeline](4.screenshots.md) — the state-driven homepage, Playwright capture tools and end-to-end smoke tests
5. [Icon palette](5.palette.md) — how icon colours are defined, mapped to POI classes, and changed
6. [Site and palette inspector](6.site.md) — the single Nuxt site, inspector internals, generated palette data, site build, testing and Pages deployment

## Quick Links

- [Main README](../README.md)
- [Root Nuxt app](../app/)
- [Homepage app page](../app/pages/index.vue)
- [Map state helper](../app/utils/mapState.js)
- [Map feature helper](../app/utils/mapFeatures.js)
- [SVG image helper](../app/utils/svgImage.js)
- [Colour helper](../app/utils/colour.js)
- [Published style](../style.json)
- [Palette source](../palette.json)
- [Generated palette data](../app/assets/data/)
- [Palette data script](../scripts/palette-data.js)
- [Site build script](../scripts/site-build.js)
- [Playwright config](../playwright.config.js)
- [End-to-end smoke tests](../tests/e2e/smoke.spec.js)
- [Test server](../scripts/test-server.js)
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
- The single Nuxt site, its homepage route and inspector, generated palette data, tests and Pages deployment
- How to customise the style and republish
- The homepage camera hash and query API, the Playwright screenshot tools and the end-to-end smoke suite
- Icon palette groups, POI class/subclass mapping, and the palette editing workflow

For API references and inline documentation, see source code comments.
