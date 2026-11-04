#!/usr/bin/env node
'use strict';

//
// Produces the published basemap styles from the raw OpenMapTiles recompose.
//
// The raw recompose is the cartographic reference: the light output is a
// no-op of its layer tree, differing only in publication fields. The dark
// output starts from that light clone and applies themes/dark/theme.json
// strictly through scripts/lib/theme.js, so only the allowlisted paint colour
// properties change.
//
// Usage:
//   node scripts/style.js               write build/style/style-dark.json and style-light.json
//   node scripts/style.js --validate    verify the generated outputs against the raw style
//   node scripts/style.js --help        show this message

const fs = require('node:fs');
const path = require('node:path');
const { applyTheme, loadTheme } = require('./lib/theme');

const ROOT = path.resolve(__dirname, '..');
const RAW_STYLE = path.join('build', 'style', 'style.json');
const OUTPUT_DIR = path.join('build', 'style');
const DARK_OUTPUT = 'style-dark.json';
const LIGHT_OUTPUT = 'style-light.json';
const THEME_PATH = path.join('themes', 'dark', 'theme.json');
const LOCK_PATH = path.join('vendor', 'openmaptiles.lock.json');

const GLYPHS = 'https://www.ogis.org/basemap/fonts/{fontstack}/{range}.pbf';
const TILE_URL = 'https://tiles.openfreemap.org/planet';
const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
const DARK_SPRITE = 'https://www.ogis.org/basemap/sprite';
const LIGHT_SPRITE = 'https://www.ogis.org/basemap/sprite-light';

const THEMES = Object.freeze({
  dark: Object.freeze({ name: 'Basemap Dark', sprite: DARK_SPRITE }),
  light: Object.freeze({ name: 'Basemap Light', sprite: LIGHT_SPRITE })
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readUpstreamCommit(root = ROOT) {
  const lock = readJSON(path.join(root, LOCK_PATH));
  if (!isPlainObject(lock) || typeof lock.commit !== 'string' || !lock.commit.trim()) {
    throw new Error(`Upstream lock ${LOCK_PATH} has no commit SHA`);
  }
  return lock.commit;
}

function styleMetadata(rawStyle, theme, commit) {
  const metadata = isPlainObject(rawStyle.metadata) ? clone(rawStyle.metadata) : {};
  metadata['ogis:theme'] = theme;
  metadata['ogis:upstreamCommit'] = commit;
  return metadata;
}

function applyPublicationFields(style, { theme, commit }) {
  const definition = THEMES[theme];
  if (!definition) throw new Error(`Unknown output theme: ${theme}`);

  const output = clone(style);
  output.name = definition.name;
  output.sprite = definition.sprite;
  output.glyphs = GLYPHS;

  if (!isPlainObject(output.sources) || !isPlainObject(output.sources.openmaptiles)) {
    throw new Error('Raw style has no sources.openmaptiles object');
  }
  output.sources.openmaptiles.url = TILE_URL;
  output.sources.openmaptiles.attribution = ATTRIBUTION;

  output.metadata = styleMetadata(style, theme, commit);
  return output;
}

function createLightStyle(rawStyle, { commit }) {
  if (!isPlainObject(rawStyle)) throw new Error('Raw style must be a JSON object');
  return applyPublicationFields(rawStyle, { theme: 'light', commit });
}

function createDarkStyle(lightStyle, theme, { commit }) {
  if (!isPlainObject(lightStyle)) throw new Error('Light style must be a JSON object');
  if (!theme) throw new Error('A dark theme is required');

  const darkStyle = applyTheme(lightStyle, theme);
  darkStyle.name = THEMES.dark.name;
  darkStyle.sprite = THEMES.dark.sprite;
  darkStyle.metadata = {
    ...(isPlainObject(darkStyle.metadata) ? darkStyle.metadata : {}),
    'ogis:theme': 'dark',
    'ogis:upstreamCommit': commit
  };
  return darkStyle;
}

function mutablePaths() {
  return [
    ['name'],
    ['sprite'],
    ['glyphs'],
    ['metadata'],
    ['sources', 'openmaptiles', 'url'],
    ['sources', 'openmaptiles', 'attribution']
  ];
}

function deletePath(target, keys) {
  let cursor = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    cursor = cursor[keys[index]];
    if (!isPlainObject(cursor)) return;
  }
  delete cursor[keys[keys.length - 1]];
}

function stripMutableFields(style) {
  const stripped = clone(style);
  for (const keys of mutablePaths()) deletePath(stripped, keys);
  return stripped;
}

function stripIdentity(style) {
  const stripped = clone(style);
  delete stripped.name;
  delete stripped.metadata;
  delete stripped.sprite;
  delete stripped.layers;
  return stripped;
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message);
  }
}

function validateStyles({ rawStyle, darkStyle, lightStyle, theme, commit }) {
  if (!isPlainObject(rawStyle)) throw new Error('Raw style must be a JSON object');
  if (!isPlainObject(lightStyle)) throw new Error('Light style must be a JSON object');
  if (!isPlainObject(darkStyle)) throw new Error('Dark style must be a JSON object');

  assertEqual(lightStyle.layers, rawStyle.layers, 'Light layers differ from the raw recompose');
  assertEqual(
    stripMutableFields(lightStyle),
    stripMutableFields(rawStyle),
    'Light style changed a field outside the publication allowlist'
  );
  assertEqual(lightStyle.name, THEMES.light.name, 'Light style name is not Basemap Light');
  assertEqual(lightStyle.sprite, THEMES.light.sprite, 'Light style sprite is not the light sprite');
  assertEqual(lightStyle.glyphs, GLYPHS, 'Light style glyphs URL is wrong');
  assertEqual(
    lightStyle.sources.openmaptiles.url,
    TILE_URL,
    'Light style tile URL is wrong'
  );
  assertEqual(
    lightStyle.sources.openmaptiles.attribution,
    ATTRIBUTION,
    'Light style attribution is wrong'
  );
  assertEqual(
    lightStyle.metadata && lightStyle.metadata['ogis:theme'],
    'light',
    'Light style metadata is missing ogis:theme=light'
  );
  assertEqual(
    lightStyle.metadata && lightStyle.metadata['ogis:upstreamCommit'],
    commit,
    'Light style metadata is missing the upstream commit'
  );

  assertEqual(darkStyle.name, THEMES.dark.name, 'Dark style name is not Basemap Dark');
  assertEqual(darkStyle.sprite, THEMES.dark.sprite, 'Dark style sprite is not the dark sprite');
  assertEqual(darkStyle.glyphs, GLYPHS, 'Dark style glyphs URL is wrong');
  assertEqual(
    darkStyle.sources.openmaptiles.url,
    TILE_URL,
    'Dark style tile URL is wrong'
  );
  assertEqual(
    darkStyle.sources.openmaptiles.attribution,
    ATTRIBUTION,
    'Dark style attribution is wrong'
  );
  assertEqual(
    darkStyle.metadata && darkStyle.metadata['ogis:theme'],
    'dark',
    'Dark style metadata is missing ogis:theme=dark'
  );
  assertEqual(
    darkStyle.metadata && darkStyle.metadata['ogis:upstreamCommit'],
    commit,
    'Dark style metadata is missing the upstream commit'
  );
  assertEqual(
    darkStyle.layers,
    applyTheme(lightStyle, theme).layers,
    'Dark style is not the light style with strict theme transformations applied'
  );
  assertEqual(
    stripIdentity(darkStyle),
    stripIdentity(lightStyle),
    'Dark style changed a field other than its name and metadata'
  );

  return true;
}

function buildStyles({
  root = ROOT,
  rawPath = path.join(root, RAW_STYLE),
  themePath = path.join(root, THEME_PATH),
  commit = readUpstreamCommit(root),
  theme
} = {}) {
  const rawStyle = readJSON(rawPath);
  const compiledTheme = theme || loadTheme(themePath);
  const lightStyle = createLightStyle(rawStyle, { commit });
  const darkStyle = createDarkStyle(lightStyle, compiledTheme, { commit });

  validateStyles({ rawStyle, darkStyle, lightStyle, theme: compiledTheme, commit });

  return { rawStyle, lightStyle, darkStyle, commit };
}

function writeJSON(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeStyles({ root = ROOT, outputDir = path.join(root, OUTPUT_DIR), styles } = {}) {
  const built = styles || buildStyles({ root });
  const darkPath = path.join(outputDir, DARK_OUTPUT);
  const lightPath = path.join(outputDir, LIGHT_OUTPUT);
  writeJSON(darkPath, built.darkStyle);
  writeJSON(lightPath, built.lightStyle);
  return { darkPath, lightPath, ...built };
}

function readStyles({ root = ROOT, outputDir = path.join(root, OUTPUT_DIR) } = {}) {
  return {
    rawStyle: readJSON(path.join(root, RAW_STYLE)),
    darkStyle: readJSON(path.join(outputDir, DARK_OUTPUT)),
    lightStyle: readJSON(path.join(outputDir, LIGHT_OUTPUT)),
    theme: loadTheme(path.join(root, THEME_PATH)),
    commit: readUpstreamCommit(root)
  };
}

function validateOutputs(options = {}) {
  const root = options.root || ROOT;
  const outputDir = options.outputDir || path.join(root, OUTPUT_DIR);
  return validateStyles(readStyles({ root, outputDir }));
}

function usage() {
  return `Usage: node scripts/style.js [options]

Produces the published basemap styles from ${RAW_STYLE}:
  ${path.join(OUTPUT_DIR, LIGHT_OUTPUT)}  cartographic no-op of the raw recompose
  ${path.join(OUTPUT_DIR, DARK_OUTPUT)}   light style with strict dark theme colours

Options:
  --validate    verify generated styles against the raw recompose
  --help, -h    show this message`;
}

function main(argv = process.argv.slice(2)) {
  const known = new Set(['--validate', '--help', '-h']);
  const unknown = argv.filter((argument) => !known.has(argument));
  if (unknown.length) {
    console.error(`Unknown argument: ${unknown[0]}`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    return;
  }

  try {
    if (argv.includes('--validate')) {
      validateOutputs();
      console.log('Style outputs validated: light is a no-op, dark is strictly themed.');
      return;
    }

    const result = writeStyles();
    console.log(
      `Wrote ${path.relative(ROOT, result.lightPath)} (${result.lightStyle.layers.length} layers)`
    );
    console.log(
      `Wrote ${path.relative(ROOT, result.darkPath)} (${result.darkStyle.layers.length} layers)`
    );
    console.log(`Upstream commit ${result.commit}`);
  } catch (error) {
    console.error(`Style generation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ATTRIBUTION,
  DARK_OUTPUT,
  DARK_SPRITE,
  GLYPHS,
  LIGHT_OUTPUT,
  LIGHT_SPRITE,
  OUTPUT_DIR,
  RAW_STYLE,
  ROOT,
  THEMES,
  TILE_URL,
  buildStyles,
  createDarkStyle,
  createLightStyle,
  deletePath,
  mutablePaths,
  readStyles,
  readUpstreamCommit,
  stripIdentity,
  stripMutableFields,
  usage,
  validateOutputs,
  validateStyles,
  writeStyles
};
