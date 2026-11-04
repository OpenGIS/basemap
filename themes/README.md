# Themes

The project distributes two styles built from one OpenMapTiles recompose: **Basemap Light**, a cartographic no-op of the raw upstream style, and **Basemap Dark**, a strict ordered theme derived from the Open GIS branding palette. Dark is the default at the root `style.json`; light is published as `style-light.json`. This directory contains the dark map theme and the dark icon palette; the engine lives in `scripts/lib/` and is wired into the build by `scripts/style.js`.

> [!NOTE]
> The theme engine only transforms a style object. `scripts/style.js` applies it during the build; `scripts/build.sh` stages both icon palettes, builds both sprite sets, publishes both styles and icon trees, merges fonts and assembles the site. A theme file alone does not change published assets.

## Layout

| Path                       | Purpose                                                |
| -------------------------- | ------------------------------------------------------ |
| `scripts/lib/colour.js`    | Colour parsing, canonicalisation, formatting, contrast |
| `scripts/lib/theme.js`     | Theme loading, validation, rule compilation, applying  |
| `scripts/style.js`         | Composes the light no-op and strict dark published styles |
| `scripts/build.sh`         | Stages palettes, builds sprites and styles, publishes  |
| `themes/dark/theme.json`   | Dark map theme definition (style layer colours)        |
| `themes/dark/palette.json` | Dark icon palette (POI icon role colours)              |
| `scripts/theme.test.js`    | Unit, integration and dark-completeness tests          |

All paths in this document are relative to the repository root. The modules are plain Node CommonJS with no browser or application imports. They use Node built-ins only.

## Theme schema

A theme is a JSON object with four top-level keys:

| Key       | Type   | Description                                      |
| --------- | ------ | ------------------------------------------------ |
| `version` | number | Must be `1`                                      |
| `name`    | string | Non-empty theme name used in errors              |
| `tokens`  | object | Named colour values, referenced as `@name`       |
| `rules`   | array  | Ordered colour replacement rules                 |

Each rule supports:

| Key            | Required | Description                                                                 |
| -------------- | -------- | --------------------------------------------------------------------------- |
| `layer`        | yes      | Exact style-layer id or glob using `*` only                                 |
| `property`     | yes      | One allowlisted colour paint property                                       |
| `from`         | no       | Only match this colour; accepts bare hex or any other colour form            |
| `to`           | yes      | Replacement colour value or `@token` reference                              |
| `preserveAlpha`| no       | Keep the original alpha when `true`; defaults to `true`                     |

The allowlisted properties are `background-color`, `fill-color`, `fill-outline-color`, `line-color`, `icon-color`, `icon-halo-color`, `text-color` and `text-halo-color`. Layout, filters, ids, sources, metadata and other paint properties are never changed.

### Tokens

Tokens keep repeated colours readable and make palette changes local. Token values must be colour strings; a token cannot reference another token. Unknown references fail during compilation. Tokens and `to` accept any colour form that the engine can parse: hex with or without `#`, `rgb()`, `rgba()`, `hsl()`, `hsla()` or `transparent`.

### Rule order and matching

Rules are evaluated in array order and the first match wins. For every colour literal, the engine checks that the layer matches the rule's glob, the property is exactly the rule's property, and, when present, `from` matches the canonical colour. A rule without `from` matches every colour literal in that layer and property. Put specific rules before broad ones.

The layer glob supports `*` as a wildcard for any sequence of characters. All other characters are matched literally, including dots and other regular-expression characters. A pattern is anchored to the whole layer id.

### Alpha behaviour

With `preserveAlpha: true`, the original literal's alpha is retained. If `to` is opaque, the result keeps the original alpha. If `to` is translucent, the result uses the target's RGB and multiplies the original alpha by the target alpha; for example, an original `0.4` replaced by a `0.5` token becomes `0.2`. This keeps translucent halos and hatching translucent instead of silently making them solid.

With `preserveAlpha: false`, the target's alpha is used exactly.

### Expressions

Colour properties are walked recursively through arrays and objects. A string in a style expression is a colour literal only when, after trimming, it uses explicit syntax: a hex value starting with `#`, `rgb()`, `rgba()`, `hsl()`, `hsla()` or `transparent`, matched case-insensitively. Bare hex is not recognised in style expressions, so an operand such as the class value `cafe` is left untouched. Expression keywords and other non-colour strings are left alone, so `interpolate`, `match`, `case`, `get` and `zoom` keep their structure. Both array expressions and object stop forms are supported.

This explicit-syntax rule applies to style expressions only. Bare hex remains accepted in the theme file's `from`, `tokens` and `to` values.

### Strict mode

Strict mode is on by default for every non-null theme. At compile time it rejects unknown tokens, invalid colours, unknown rule keys, invalid properties and malformed rule values. At apply time it collects every style colour literal that no rule matched across all layers and throws a `ThemeError` listing all of them, deduplicated by layer, property and canonical colour.

`applyTheme(style, null)` is identity mode and returns a deep clone. A valid theme with no rules also returns a deep clone when strict mode is disabled with `{ strict: false }`. The input style is never mutated.

## API

```js
const {
  loadTheme,
  compileTheme,
  applyTheme,
  applyThemeFile,
  ThemeError
} = require("./scripts/lib/theme.js");

const theme = loadTheme("themes/dark/theme.json");
const dark = applyTheme(style, theme);
const same = applyTheme(style, null);
```

`loadTheme(filePath)` reads and validates a theme file. `compileTheme(theme, options)` validates and compiles rules. `applyTheme(style, theme, options)` accepts a theme object, a compiled theme or `null`; `options.strict` defaults to `true`. `applyThemeFile(style, filePath, options)` loads and applies in one call. `ThemeError` carries an `unmatched` array in strict failures.

The colour helpers are also available from `scripts/lib/colour.js`: `parseColour`, `tryParseColour`, `canonicalColour`, `formatColour`, `compositeColour`, `relativeLuminance` and `contrastRatio`.

## Dark map theme

The dark map theme (`themes/dark/theme.json`) uses the Open GIS brand colours as its base:

| Token          | Value     | Role                                  |
| -------------- | --------- | ------------------------------------- |
| `void`         | `#000b00` | Page background and icon halos        |
| `land`         | `#001800` | Base land tint                        |
| `landAlt`      | `#001c00` | Alternate land surface                |
| `border`       | `#0e3111` | Subtle boundaries and pattern edges   |
| `ink`          | `#eeeeee` | Primary label text                    |
| `heading`      | `#e8f5ea` | Large place and country labels        |
| `muted`        | `#9bb0a3` | Secondary and minor labels            |
| `housenumber`  | `#7f8f84` | House-number labels                   |
| `accent`       | `#0dd70d` | Capital labels and emphasis           |
| `accentHover`  | `#5cf05c` | Park and outdoor emphasis             |
| `orange`       | `#dc8f4e` | Major roads, food and attractions     |
| `deepOrange`   | `#b3571f` | Major road casings and disputed edges |
| `noteBlue`     | `#79c0ff` | Water and transport labels            |
| `cream`        | `#fcfaf5` | Icon glyphs                           |

`land` and `landAlt` are the palette's base land references, filling `Residential` and `Aeroway` respectively. A small set of map-specific tints is derived from the same greens, blacks and mineral tones so the map reads as a coherent dark surface rather than an inverted light map:

| Token group      | Tokens                                                        | Purpose                                                        |
| ---------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| Water            | `water`, `waterLine`                                          | Deep teal water and slightly brighter waterway lines           |
| Vegetation       | `park`, `woodland`, `grass`, `farmland`                       | Distinct but low-luminance greens for parks, woodland and fields |
| Ground           | `sand`, `rock`, `ice`                                         | Warm sand, neutral rock and pale ice                           |
| Built-up areas   | `urban`, `urbanAlt`, `industrial`, `building`, `buildingOutline` | Layered settlement, industrial and building surfaces         |
| Roads            | `roadMajor`, `roadPrimary`, `roadSecondary`, `roadMinor`, `roadMinorCasing`, `roadService`, `roadPath`, `roadPathCasing` | Orange major routes, muted minor routes and dark casings |
| Rail             | `rail`, `railHatch`                                           | Muted rail lines; `railHatch` fills minor rail hatching        |
| Boundaries       | `countryBorder`, `disputedBorder`                             | Green administrative edges and orange disputed edges           |
| Labels           | `labelHalo`                                                   | Dark land-coloured text halos                                  |

The accent greens are used sparingly: capital city labels and national park emphasis. Orange carries major roads and disputed boundaries. Water and transport labels use the note blue. Labels sit on dark halos so they stay readable over dark land without glowing.

The rules use family globs for layer groups such as water, vegetation, roads, rail, bridges, tunnels, paths, icons and labels, with exact `from` overrides where upstream reuses black, white or translucent halo colours across properties. Specific rules precede broad ones. The family globs are intended to absorb new upstream rail and bridge layers; strict mode will report any new colour literal that still needs a deliberate rule.

## Dark icon palette

`themes/dark/palette.json` is separate from the map theme in `themes/dark/theme.json`. The theme controls style-layer colours; the palette controls the fills baked into the POI SVG icons. The dark palette uses the same schema as the root [`palette.json`](../palette.json): the same roles in the same order, with the same ids, labels and `sourceColors`, and the same `preserve` and `overrides` values. Only each role's target `color` changes.

The light palette is the upstream identity: every target colour equals its source fill, so staging is byte-identical to the vendored icons. The dark palette is branding-anchored: note blue for transport, orange for food, caution red for health, magenta for shops, warning gold for public, muted green-grey for infrastructure, light grey for barriers, accent green for leisure, success green for sport, violet for terminals and ink for worship.

| Role             | Light     | Dark      | Dark contrast on `#000b00` |
| ---------------- | --------- | --------- | -------------------------- |
| `transport`      | `#0092DA` | `#79C0FF` | 10.30:1                    |
| `food`           | `#C77400` | `#DC8F4E` | 7.71:1                     |
| `health`         | `#BF0000` | `#F85149` | 5.98:1                     |
| `shops`          | `#AC39AC` | `#E879F9` | 8.14:1                     |
| `public`         | `#734A08` | `#D29922` | 7.94:1                     |
| `infrastructure` | `#666666` | `#9BB0A3` | 8.72:1                     |
| `barriers`       | `#3F3F3F` | `#C9D1D9` | 12.98:1                    |
| `leisure`        | `#2F6133` | `#5CF05C` | 13.43:1                    |
| `sport`          | `#008C0D` | `#3FB950` | 7.89:1                     |
| `terminals`      | `#8461C4` | `#A371F7` | 5.98:1                     |
| `worship`        | `#000000` | `#EEEEEE` | 17.27:1                    |

Contrast is the WCAG ratio between each dark role colour and the branding background `#000b00`, measured with [`contrastRatio`](../scripts/lib/colour.js). Every role clears 3:1, the minimum for non-text UI graphics; the values range from 5.98:1 to 17.27:1.

Theme-specific staging writes to separate directories:

```bash
node scripts/palette.js --theme light --apply   # build/light/icons
node scripts/palette.js --theme dark --apply    # build/dark/icons
```

`--theme light` resolves the root `palette.json`; `--theme dark` resolves `themes/dark/palette.json`. Both work with `--summary` (the default) and `--apply`. The light staging is byte-identical to `vendor/openmaptiles/style/icons` and reports 0 recoloured. The dark staging recolours only the selected POI icons whose fills map to the palette; every non-POI icon is copied byte-identically.

The full build stages both trees and publishes them: `build/dark/icons` → `icons/` with `sprite.*`, and `build/light/icons` → `icons-light/` with `sprite-light.*`. By default, all staging directories live under the gitignored `build/` tree.

The unprefixed `node scripts/palette.js --apply` still writes `build/icons` from the root light palette for ad-hoc use; `scripts/build.sh` does not use that directory. `--out <dir>` overrides the output directory and remains restricted to strict subdirectories of `build/` or the gitignored scratch directory. `--theme` and `--palette` cannot be combined.

## Adding a map-theme rule

1. Run the theme tests or apply the theme to the raw style. A strict failure lists each unmatched layer, property and literal.
2. Add a token if the colour is reused, or a literal if it is a one-off.
3. Add the rule before any broader rule that would otherwise catch the same layer and property.
4. Run `npm test`, then `./scripts/build.sh` to republish both styles and their assets.

```bash
npm test
./scripts/build.sh
```

The theme tests apply the dark theme to a representative raw-style fixture in strict mode, check representative layers (including `Residential` and `Aeroway` land fills, and minor rail hatching) and contrast pairs, and confirm the input style is unchanged. They also prove strict failures with a deliberately unmatched fixture. `scripts/style.test.js` covers the light no-op and dark style validation against the raw recompose.
