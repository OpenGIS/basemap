#!/usr/bin/env bash
#
# Reproduces `make build-style` from openmaptiles v3.16 against the vendored
# sources under vendor/openmaptiles/, using the same docker tooling.
#
# Upstream Makefile mechanics (v3.16):
#   docker compose run --rm --user=$(id -u):$(id -g) openmaptiles-tools \
#     bash -c 'style-tools recompose openmaptiles.yaml build/style/style.json style/style-header.json \
#       && spreet /style/icons build/style/sprite \
#       && spreet --retina /style/icons build/style/sprite@2x'
#
# with image openmaptiles/openmaptiles-tools:${TOOLS_VERSION} (7.2 from .env),
# workdir /tileset, project root mounted at /tileset, and ./style mounted at /style.
#
# The build also renders a fresh random basemap screenshot for the README (via
# scripts/random-map.js), so that one artifact is intentionally non-deterministic.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="openmaptiles/openmaptiles-tools:7.2"

mkdir -p "$ROOT/build/style"

docker run --rm --user="$(id -u):$(id -g)" \
  -v "$ROOT":/tileset \
  -v "$ROOT/vendor/openmaptiles/style":/style \
  -w /tileset \
  "$IMAGE" \
  bash -c 'style-tools recompose vendor/openmaptiles/openmaptiles.yaml build/style/style.json vendor/openmaptiles/style/style-header.json \
    && spreet /style/icons build/style/sprite \
    && spreet --retina /style/icons build/style/sprite@2x'

# Rewrite the built style to point at the published URLs, then publish the
# final artifacts to the repo root. URLs use www.ogis.org (the org's Pages
# custom domain) directly — opengis.github.io 301-redirects to it, and Chrome
# blocks cross-origin fetches that hit a redirect hop without a CORS header.
jq '
  .name = "Basemap"
  | .glyphs = "https://www.ogis.org/basemap/fonts/{fontstack}/{range}.pbf"
  | .sprite = "https://www.ogis.org/basemap/sprite"
  | .sources.openmaptiles.url = "https://tiles.openfreemap.org/planet"
  | .sources.attribution.attribution = "<a href=\"https://openfreemap.org\" target=\"_blank\">OpenFreeMap</a> <a href=\"https://www.openmaptiles.org/\" target=\"_blank\">&copy; OpenMapTiles</a> Data from <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\">OpenStreetMap</a>"
' "$ROOT/build/style/style.json" > "$ROOT/build/style/style.json.tmp"
mv "$ROOT/build/style/style.json.tmp" "$ROOT/build/style/style.json"

mkdir -p "$ROOT/icons"
cp "$ROOT/build/style/style.json" "$ROOT/style.json"
cp "$ROOT/build/style/sprite.json" "$ROOT/build/style/sprite.png" \
  "$ROOT/build/style/sprite@2x.json" "$ROOT/build/style/sprite@2x.png" \
  "$ROOT/"
cp "$ROOT/vendor/openmaptiles/style/icons/"*.svg "$ROOT/icons/"

# Merge comma-joined text-font stacks from style.json into single comma-named
# glyph directories so GitHub Pages can serve them without server-side merging.
node "$ROOT/scripts/merge-fonts.js"

# Render a fresh random basemap screenshot for the README (see scripts/random-map.js).
node "$ROOT/scripts/random-map.js"