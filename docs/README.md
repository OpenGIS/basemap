---
git_hash: "688378719ef7bb47197627e189ac6fcd570ea909"
modified: "2026-11-04"
---

# Basemap Documentation

Developer-focused documentation for the [Basemap](../README.md) codebase — a dark-first, self-hosted MapLibre GL basemap built from the OpenMapTiles "OSM" vector style and OpenFreeMap tiles. The live distribution serves Basemap Dark as the default at `/basemap/style.json` and Basemap Light at `/basemap/style-light.json`, each with its own sprite and icon set, and serves a single root Nuxt site whose homepage is a full-screen basemap with a live, theme-aware palette inspector.

## Reading Order

1. [Getting started](1.start.md) — what this is, the published URLs, the repository layout and both styles
2. [Build pipeline](2.build.md) — vendored upstream sync and provenance, then how `scripts/build.sh` stages both palettes, builds both styles and produces the deployable site
3. [Remixing the style](3.remixing.md) — modifying the map theme, icon palettes and upstream cartography, rebuilding and republishing both styles
4. [Screenshot pipeline](4.screenshots.md) — the state-driven homepage, dark/light capture tools, Playwright harness and end-to-end tests
5. [Icon palette](5.palette.md) — light and dark icon roles, contrast, POI mapping, staging and publication
6. [Site and palette inspector](6.site.md) — the single Nuxt site, dark-first tokens, theme toggle, inspector internals, site build, testing and Pages deployment
7. [Theme system](7.themes.md) — the light no-op contract, the dark branding-derived theme, icon palettes and how the pieces are wired together

## Quick Links

- [Main README](../README.md)
- [Root Nuxt app](../app/)
- [Homepage app page](../app/pages/index.vue)
- [Map state helper](../app/utils/mapState.js)
- [Map feature helper](../app/utils/mapFeatures.js)
- [SVG image helper](../app/utils/svgImage.js)
- [Colour helper](../app/utils/colour.js)
- [Published dark style (default)](../style.json)
- [Published light style](../style-light.json)
- [Dark icons](../icons/)
- [Light icons](../icons-light/)
- [Shared fonts](../fonts/)
- [Light palette source](../palette.json)
- [Dark icon palette](../themes/dark/palette.json)
- [Dark map theme](../themes/dark/theme.json)
- [Theme and palette reference](../themes/README.md)
- [Theme system](7.themes.md)
- [Generated palette data](../app/assets/data/)
- [Palette data script](../scripts/palette-data.js)
- [Style generation script](../scripts/style.js)
- [Site build script](../scripts/site-build.js)
- [Playwright config](../playwright.config.js)
- [End-to-end smoke tests](../tests/e2e/smoke.spec.js)
- [Test server](../scripts/test-server.js)
- [Pages workflow](../.github/workflows/pages.yml)
- [CI workflow](../.github/workflows/ci.yml)
- [Build script](../scripts/build.sh)
- [Font merge script](../scripts/merge-fonts.js)
- [Screenshot script](../scripts/screenshot.js)
- [Vendored upstream sources and sync](../vendor/README.md)
- [Upstream lock file](../vendor/openmaptiles.lock.json)
- [Upstream sync CLI](../scripts/sync-upstream.js)

## Documentation Coverage

This documentation covers:

- Project purpose, published endpoints, both styles and the repository layout
- Vendored upstream source sync, mirrored paths, lock-file provenance and offline verification in CI
- The full map build pipeline (dual palette staging, one Docker recompose, four sprites, style generation and validation, publication, font merging and site build)
- The light no-op contract and the dark strict ordered theme, including token groups and strict-mode maintenance
- The light and dark icon palettes, palette model, role mapping, contrast targets and SVG recolour pipeline
- The dark-first Nuxt site, its theme toggle, `?theme` and `?style` behaviour, live palette inspector, generated palette data, tests and Pages deployment
- How to customise the styles and republish both sets of assets together
- The homepage camera hash and query API, the Playwright screenshot tools across both themes and the end-to-end smoke suite

For API references and inline documentation, see source code comments.
