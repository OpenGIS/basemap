#!/usr/bin/env node
//
// Builds the static GitHub Pages artifact for the root Nuxt site.
//
// Sequence:
//   1. Regenerate the palette app data (scripts/palette-data.js).
//   2. Run `npm run generate` (the local Nuxt CLI via the package script).
//   3. Copy the map data and assets into .output/public.
//   4. Validate the artifact and fail loudly on any problem.
//
// The artifact is intentionally not committed; GitHub Actions publishes
// .output/public as the Pages artifact.
//
// Usage:
//   node scripts/site-build.js [--help]

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, '.output', 'public');
const SITE_PREFIX = '/basemap/';
const ASSET_DIR = 'nuxt-assets';
const PAGES = ['index.html'];

const STYLE_FILES = ['style.json', 'style-light.json'];

const SPRITE_SETS = [
  {
    theme: 'dark',
    json: 'sprite.json',
    png: 'sprite.png',
    retinaJson: 'sprite@2x.json',
    retinaPng: 'sprite@2x.png'
  },
  {
    theme: 'light',
    json: 'sprite-light.json',
    png: 'sprite-light.png',
    retinaJson: 'sprite-light@2x.json',
    retinaPng: 'sprite-light@2x.png'
  }
];

const MAP_FILES = [
  ...STYLE_FILES,
  ...SPRITE_SETS.flatMap((set) => [set.json, set.png, set.retinaJson, set.retinaPng])
];

const ICON_DIRECTORIES = ['icons', 'icons-light'];
const MAP_DIRECTORIES = [...ICON_DIRECTORIES, 'fonts'];

// MapLibre derives its worker URL from the bundled module URL, so the worker
// and its shared chunk must sit beside the hashed Nuxt assets.
const MAPLIBRE_DIST = path.join(ROOT, 'node_modules', 'maplibre-gl', 'dist');
const MAPLIBRE_WORKER_FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

// --- path helpers ---------------------------------------------------------

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (error) {
    return false;
  }
}

function isDirectory(directory) {
  try {
    return fs.statSync(directory).isDirectory();
  } catch (error) {
    return false;
  }
}

function walkFiles(directory) {
  if (!isDirectory(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function countFiles(directory, predicate = () => true) {
  return walkFiles(directory).filter((filePath) => predicate(path.basename(filePath))).length;
}

function totalSize(directory) {
  return walkFiles(directory).reduce((total, filePath) => {
    try {
      return total + fs.statSync(filePath).size;
    } catch (error) {
      return total;
    }
  }, 0);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(1)} ${units[index]}`;
}

// --- artifact validation --------------------------------------------------

const TAG_PATTERN = /<([a-zA-Z][\w:-]*)\b([^>]*)>/g;
const ASSET_ATTRIBUTES = new Set(['src', 'href', 'poster', 'data-src']);

function collectAssetReferences(html) {
  const references = [];
  let tagMatch;
  TAG_PATTERN.lastIndex = 0;
  while ((tagMatch = TAG_PATTERN.exec(html))) {
    const tag = tagMatch[1].toLowerCase();
    if (tag === 'a') continue;
    const attributes = tagMatch[2];
    const attributePattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let attributeMatch;
    while ((attributeMatch = attributePattern.exec(attributes))) {
      const name = attributeMatch[1].toLowerCase();
      if (!ASSET_ATTRIBUTES.has(name)) continue;
      const value = attributeMatch[2] !== undefined ? attributeMatch[2] : attributeMatch[3];
      if (!value) continue;
      references.push({ tag, attribute: name, value });
    }
  }
  return references;
}

function isExternalAsset(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value);
}

function pageUrlPathFor(page) {
  if (page === 'index.html') return SITE_PREFIX;
  return `${SITE_PREFIX}${path.posix.dirname(page)}/`;
}

function validateAssetPaths(html, { pageUrlPath = SITE_PREFIX, outputDir = OUTPUT_DIR } = {}) {
  const errors = [];

  if (html.includes('/_nuxt/')) {
    errors.push(`${pageUrlPath}: contains a /_nuxt/ reference`);
  }
  if (html.includes('_payload.json')) {
    errors.push(`${pageUrlPath}: references _payload.json`);
  }

  for (const reference of collectAssetReferences(html)) {
    const raw = reference.value.trim();
    if (!raw || raw.startsWith('#')) continue;
    if (raw.startsWith('data:') || raw.startsWith('blob:')) continue;
    if (isExternalAsset(raw)) {
      errors.push(
        `${pageUrlPath}: external asset URL "${raw}" in <${reference.tag} ${reference.attribute}>`
      );
      continue;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(raw.split('#')[0].split('?')[0]);
    } catch (error) {
      errors.push(`${pageUrlPath}: malformed asset URL "${raw}"`);
      continue;
    }

    const resolved = path.posix.resolve(pageUrlPath, pathname);
    if (resolved !== '/basemap' && !resolved.startsWith(SITE_PREFIX)) {
      errors.push(`${pageUrlPath}: asset "${raw}" is not under ${SITE_PREFIX}`);
      continue;
    }
    if (resolved.includes(`/${ASSET_DIR}/`) && !resolved.startsWith(`${SITE_PREFIX}${ASSET_DIR}/`)) {
      errors.push(`${pageUrlPath}: Nuxt asset "${raw}" is not under ${SITE_PREFIX}${ASSET_DIR}/`);
      continue;
    }

    let relative = resolved === SITE_PREFIX ? '' : resolved.slice(SITE_PREFIX.length);
    if (relative === '' || relative.endsWith('/')) relative = `${relative}index.html`;

    const filePath = path.resolve(outputDir, relative);
    if (filePath !== outputDir && !filePath.startsWith(`${outputDir}${path.sep}`)) {
      errors.push(`${pageUrlPath}: asset "${raw}" escapes the output directory`);
      continue;
    }
    if (!isFile(filePath)) {
      errors.push(`${pageUrlPath}: missing local asset "${raw}"`);
    }
  }

  return errors;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJSONFile(filePath) {
  try {
    return { document: JSON.parse(fs.readFileSync(filePath, 'utf8')), error: null };
  } catch (error) {
    return { document: null, error: error.message };
  }
}

function validateStyleDocument(style, file) {
  const errors = [];

  if (!isPlainObject(style)) {
    return [`invalid style ${file}: expected a JSON object`];
  }
  if (!isPlainObject(style.sources) || !isPlainObject(style.sources.openmaptiles)) {
    errors.push(`invalid style ${file}: missing sources.openmaptiles`);
  }
  if (typeof style.sprite !== 'string' || !style.sprite.trim()) {
    errors.push(`invalid style ${file}: missing sprite`);
  }
  if (typeof style.glyphs !== 'string' || !style.glyphs.trim()) {
    errors.push(`invalid style ${file}: missing glyphs`);
  }
  if (!Array.isArray(style.layers) || style.layers.length === 0) {
    errors.push(`invalid style ${file}: missing layers`);
  }

  return errors;
}

function validateStyleFile(outputDir, file) {
  const filePath = path.join(outputDir, file);
  if (!isFile(filePath)) return { errors: [`missing map file ${file}`], style: null };

  const { document, error } = readJSONFile(filePath);
  if (error) return { errors: [`invalid style ${file}: ${error}`], style: null };

  return { errors: validateStyleDocument(document, file), style: document };
}

function validateSpriteSet(outputDir, set) {
  const errors = [];

  for (const file of [set.json, set.png, set.retinaJson, set.retinaPng]) {
    const filePath = path.join(outputDir, file);
    if (!isFile(filePath)) {
      errors.push(`missing map file ${file}`);
      continue;
    }
    if (file.endsWith('.png')) {
      if (fs.statSync(filePath).size === 0) {
        errors.push(`invalid sprite ${file}: empty PNG`);
      }
      continue;
    }

    const { document, error } = readJSONFile(filePath);
    if (error) {
      errors.push(`invalid sprite ${file}: ${error}`);
    } else if (!isPlainObject(document) || Object.keys(document).length === 0) {
      errors.push(`invalid sprite ${file}: expected a non-empty JSON object`);
    }
  }

  return errors;
}

function validateArtifact(outputDir = OUTPUT_DIR) {
  const errors = [];

  for (const page of PAGES) {
    const filePath = path.join(outputDir, page);
    if (!isFile(filePath)) {
      errors.push(`missing HTML page ${page}`);
      continue;
    }
    const html = fs.readFileSync(filePath, 'utf8');
    errors.push(...validateAssetPaths(html, { pageUrlPath: pageUrlPathFor(page), outputDir }));
  }

  const styles = new Map();
  for (const file of STYLE_FILES) {
    const result = validateStyleFile(outputDir, file);
    errors.push(...result.errors);
    if (result.style) styles.set(file, result.style);
  }

  const defaultStyle = styles.get('style.json');
  if (defaultStyle && (!defaultStyle.metadata || defaultStyle.metadata['ogis:theme'] !== 'dark')) {
    errors.push('style.json is not the dark default (ogis:theme must be dark)');
  }
  const lightStyle = styles.get('style-light.json');
  if (lightStyle && (!lightStyle.metadata || lightStyle.metadata['ogis:theme'] !== 'light')) {
    errors.push('style-light.json is not the light style (ogis:theme must be light)');
  }

  for (const set of SPRITE_SETS) {
    errors.push(...validateSpriteSet(outputDir, set));
  }

  for (const file of MAPLIBRE_WORKER_FILES) {
    if (!isFile(path.join(outputDir, ASSET_DIR, file))) {
      errors.push(`missing MapLibre worker file ${ASSET_DIR}/${file}`);
    }
  }

  for (const directory of ICON_DIRECTORIES) {
    const directoryPath = path.join(outputDir, directory);
    const iconCount = countFiles(directoryPath, (name) => name.toLowerCase().endsWith('.svg'));
    if (!isDirectory(directoryPath)) {
      errors.push(`missing ${directory} directory`);
    } else if (iconCount === 0) {
      errors.push(`${directory} directory is empty`);
    }
  }

  const fontFileCount = countFiles(path.join(outputDir, 'fonts'));
  if (!isDirectory(path.join(outputDir, 'fonts'))) {
    errors.push('missing fonts directory');
  } else if (fontFileCount === 0) {
    errors.push('fonts directory is empty');
  }

  const payloadFiles = walkFiles(outputDir).filter((filePath) => path.basename(filePath) === '_payload.json');
  if (payloadFiles.length) {
    errors.push(
      `unexpected _payload.json file(s): ${payloadFiles
        .map((filePath) => path.relative(outputDir, filePath))
        .join(', ')}`
    );
  }

  return errors;
}

function summariseArtifact(outputDir = OUTPUT_DIR) {
  return {
    outputDir,
    pages: PAGES.slice(),
    iconCount: countFiles(path.join(outputDir, 'icons'), (name) =>
      name.toLowerCase().endsWith('.svg')
    ),
    lightIconCount: countFiles(path.join(outputDir, 'icons-light'), (name) =>
      name.toLowerCase().endsWith('.svg')
    ),
    fontFileCount: countFiles(path.join(outputDir, 'fonts')),
    totalBytes: totalSize(outputDir)
  };
}

// Maps a decoded /basemap/ request path onto the static artifact. Used by the
// screenshot harness so it serves the generated site rather than the repo.
function mapRequestToFile(requestPath, outputDir = OUTPUT_DIR) {
  if (typeof requestPath !== 'string' || !requestPath.startsWith(SITE_PREFIX)) {
    return { status: 404, filePath: null };
  }

  let relative = requestPath.slice(SITE_PREFIX.length);
  if (relative === '' || relative.endsWith('/')) relative = `${relative}index.html`;

  const filePath = path.resolve(outputDir, relative);
  if (filePath !== outputDir && !filePath.startsWith(`${outputDir}${path.sep}`)) {
    return { status: 403, filePath: null };
  }

  return { status: 200, filePath };
}

// --- build ----------------------------------------------------------------

function run(command, args) {
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
}

function syncIconDirectory(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  const sourceNames = new Set(
    fs
      .readdirSync(sourceDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.svg'))
      .map((entry) => entry.name)
  );
  if (sourceNames.size === 0) {
    throw new Error(`No SVG icons found in ${path.relative(ROOT, sourceDir)}/`);
  }

  for (const name of fs.readdirSync(targetDir)) {
    if (sourceNames.has(name)) continue;
    fs.rmSync(path.join(targetDir, name), { recursive: true, force: true });
  }
  for (const name of sourceNames) {
    fs.copyFileSync(path.join(sourceDir, name), path.join(targetDir, name));
  }

  return sourceNames.size;
}

function copyMapData(outputDir = OUTPUT_DIR) {
  for (const file of MAP_FILES) {
    const source = path.join(ROOT, file);
    if (!isFile(source)) {
      throw new Error(`Missing map file at ${source}`);
    }
  }
  for (const directory of MAP_DIRECTORIES) {
    const source = path.join(ROOT, directory);
    if (!isDirectory(source)) {
      throw new Error(`Missing ${directory} directory at ${source}`);
    }
  }

  fs.mkdirSync(outputDir, { recursive: true });

  for (const file of MAP_FILES) {
    fs.copyFileSync(path.join(ROOT, file), path.join(outputDir, file));
  }

  const assetsTarget = path.join(outputDir, ASSET_DIR);
  fs.mkdirSync(assetsTarget, { recursive: true });
  for (const file of MAPLIBRE_WORKER_FILES) {
    const source = path.join(MAPLIBRE_DIST, file);
    if (!isFile(source)) {
      throw new Error(`Missing MapLibre worker file at ${source}`);
    }
    fs.copyFileSync(source, path.join(assetsTarget, file));
  }

  for (const directory of ICON_DIRECTORIES) {
    syncIconDirectory(path.join(ROOT, directory), path.join(outputDir, directory));
  }

  fs.cpSync(path.join(ROOT, 'fonts'), path.join(outputDir, 'fonts'), { recursive: true });
}

function buildSite() {
  console.log('Generating palette app data…');
  run(process.execPath, [path.join(ROOT, 'scripts', 'palette-data.js')]);

  console.log('Running nuxt generate…');
  try {
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'generate']);
  } catch (error) {
    throw new Error('nuxt generate failed — see the output above');
  }

  console.log('Copying map data into the artifact…');
  copyMapData(OUTPUT_DIR);

  console.log('Validating the artifact…');
  const errors = validateArtifact(OUTPUT_DIR);
  if (errors.length) {
    throw new Error(`Artifact validation failed:\n  - ${errors.join('\n  - ')}`);
  }

  const summary = summariseArtifact(OUTPUT_DIR);
  console.log('');
  console.log('Site build complete');
  console.log(`  Output: ${summary.outputDir}`);
  console.log(`  Pages:  ${summary.pages.join(', ')}`);
  console.log(`  Icons:  ${summary.iconCount} dark, ${summary.lightIconCount} light`);
  console.log(`  Fonts:  ${summary.fontFileCount} files`);
  console.log(`  Size:   ${formatBytes(summary.totalBytes)}`);

  return summary;
}

// --- CLI ------------------------------------------------------------------

function usage() {
  return `Usage: node scripts/site-build.js [--help]

Builds the static GitHub Pages artifact in .output/public:
  1. regenerates app/assets/data with scripts/palette-data.js
  2. runs npm run generate (nuxt generate)
  3. copies both styles, both sprite sets, icons/, icons-light/ and fonts/
  4. validates page paths, assets and required map files

Options:
  --help, -h  show this message`;
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    return;
  }
  const unknown = argv.filter((argument) => argument !== '--help' && argument !== '-h');
  if (unknown.length) {
    console.error(`Unknown argument: ${unknown[0]}`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  try {
    buildSite();
  } catch (error) {
    console.error(`Site build failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ASSET_DIR,
  ICON_DIRECTORIES,
  MAPLIBRE_WORKER_FILES,
  MAP_DIRECTORIES,
  MAP_FILES,
  SPRITE_SETS,
  STYLE_FILES,
  OUTPUT_DIR,
  PAGES,
  ROOT,
  SITE_PREFIX,
  buildSite,
  collectAssetReferences,
  copyMapData,
  countFiles,
  isPlainObject,
  readJSONFile,
  formatBytes,
  mapRequestToFile,
  summariseArtifact,
  syncIconDirectory,
  totalSize,
  validateArtifact,
  validateAssetPaths,
  validateSpriteSet,
  validateStyleDocument,
  validateStyleFile,
  walkFiles
};
