# Vendored source: OpenMapTiles style

Static vendoring of a minimal subset of the upstream OpenMapTiles repository, used to build a basemap style.

- Upstream repo: https://github.com/openmaptiles/openmaptiles
- Pinned tag: `v3.16`
- Commit SHA: `c33503af14926d68ea47f1ab7ca4d783ab544f37`
- Vendored on: 2026-08-23

## Contents included

- `openmaptiles.yaml`
- `style/style-header.json`
- `layers/` (all 16 layer subdirectories, each containing a `style.json`):
  - `aerodrome_label`, `aeroway`, `boundary`, `building`, `housenumber`, `landcover`, `landuse`, `mountain_peak`, `park`, `place`, `poi`, `transportation`, `transportation_name`, `water`, `water_name`, `waterway`
- `style/icons/` (306 `.svg` files)
- `LICENSE.md`

## License notes

Per upstream `LICENSE.md`:

- Code is licensed under the BSD 3-Clause License.
- Design and cartography are licensed under the Creative Commons Attribution 4.0 International License (CC BY 4.0).
- Attribution requirements: © OpenMapTiles and © OpenStreetMap contributors.

## Build note

No pre-built `style.json` exists upstream — it is generated via `openmaptiles-tools:7.2` (`make build-style`). This vendored source supports that build.