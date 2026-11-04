#!/usr/bin/env bash
#
# Reproduces `make build-style` from the vendored OpenMapTiles sources under
# vendor/openmaptiles/, using the same docker tooling, then publishes a
# dark-first pair of styles and sprites.
#
# Upstream Makefile mechanics (v3.16):
#   docker compose run --rm --user=$(id -u):$(id -g) openmaptiles-tools \
#     bash -c 'style-tools recompose openmaptiles.yaml build/style/style.json style/style-header.json \
#       && spreet /style/icons build/style/sprite \
#       && spreet --retina /style/icons build/style/sprite@2x'
#
# with image openmaptiles/openmaptiles-tools:${TOOLS_VERSION} (7.2 from .env),
# workdir /tileset, project root mounted at /tileset.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="openmaptiles/openmaptiles-tools:7.2"
BACKUP="$ROOT/.opencode/tmp/slice4-old"

log() {
  printf '\n== %s\n' "$*"
}

# Keep a one-off snapshot of the previously published assets for comparison.
snapshot_previous() {
  if [ -e "$BACKUP/root-hashes.txt" ]; then
    return
  fi
  mkdir -p "$BACKUP"
  for name in style.json sprite.json sprite.png sprite@2x.json sprite@2x.png icons icons-light; do
    if [ -e "$ROOT/$name" ]; then
      cp -R "$ROOT/$name" "$BACKUP/"
    fi
  done
  (
    cd "$ROOT"
    for name in style.json sprite.json sprite.png sprite@2x.json sprite@2x.png; do
      if [ -e "$name" ]; then
        shasum -a 256 "$name"
      fi
    done
  ) > "$BACKUP/root-hashes.txt"
}

log "Snapshotting previous published assets"
snapshot_previous

log "Staging palette-recoloured icon trees"
mkdir -p "$ROOT/build/style"
node "$ROOT/scripts/palette.js" --theme light --apply
node "$ROOT/scripts/palette.js" --theme dark --apply

log "Recomposing the raw style and building both sprite sets"
docker run --rm --user="$(id -u):$(id -g)" \
  -v "$ROOT":/tileset \
  -v "$ROOT/vendor/openmaptiles/style":/style \
  -v "$ROOT/build/light/icons":/light-icons \
  -v "$ROOT/build/dark/icons":/dark-icons \
  -w /tileset \
  "$IMAGE" \
  bash -c 'style-tools recompose vendor/openmaptiles/openmaptiles.yaml build/style/style.json vendor/openmaptiles/style/style-header.json \
    && spreet /dark-icons build/style/sprite \
    && spreet --retina /dark-icons build/style/sprite@2x \
    && spreet /light-icons build/style/sprite-light \
    && spreet --retina /light-icons build/style/sprite-light@2x'

log "Generating dark and light styles"
node "$ROOT/scripts/style.js"

log "Validating styles and sprites"
node "$ROOT/scripts/style.js" --validate
for sprite in sprite.json sprite.png sprite@2x.json sprite@2x.png \
  sprite-light.json sprite-light.png sprite-light@2x.json sprite-light@2x.png; do
  if [ ! -s "$ROOT/build/style/$sprite" ]; then
    echo "Missing or empty sprite output: build/style/$sprite" >&2
    exit 1
  fi
done
node -e '
const fs = require("node:fs");
for (const name of ["sprite.json", "sprite@2x.json", "sprite-light.json", "sprite-light@2x.json"]) {
  const document = JSON.parse(fs.readFileSync(process.argv[1] + "/" + name, "utf8"));
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`${name} is not a sprite JSON object`);
  }
}
' "$ROOT/build/style"

log "Publishing styles and sprites to the repository root"
cp "$ROOT/build/style/style-dark.json" "$ROOT/style.json"
cp "$ROOT/build/style/style-light.json" "$ROOT/style-light.json"
cp "$ROOT/build/style/sprite.json" "$ROOT/build/style/sprite.png" \
  "$ROOT/build/style/sprite@2x.json" "$ROOT/build/style/sprite@2x.png" \
  "$ROOT/"
cp "$ROOT/build/style/sprite-light.json" "$ROOT/build/style/sprite-light.png" \
  "$ROOT/build/style/sprite-light@2x.json" "$ROOT/build/style/sprite-light@2x.png" \
  "$ROOT/"

publish_icons() {
  local source="$1" destination="$2"
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const [source, destination] = process.argv.slice(1);
    fs.mkdirSync(destination, { recursive: true });
    const names = fs.readdirSync(source);
    const keep = new Set(names);
    for (const name of fs.readdirSync(destination)) {
      if (!keep.has(name)) fs.rmSync(path.join(destination, name), { recursive: true, force: true });
    }
    for (const name of names) {
      fs.copyFileSync(path.join(source, name), path.join(destination, name));
    }
  ' "$source" "$destination"
}

log "Publishing icon trees"
publish_icons "$ROOT/build/dark/icons" "$ROOT/icons"
publish_icons "$ROOT/build/light/icons" "$ROOT/icons-light"

log "Merging shared font stacks"
node "$ROOT/scripts/merge-fonts.js"

log "Building the static site artifact"
node "$ROOT/scripts/site-build.js"
