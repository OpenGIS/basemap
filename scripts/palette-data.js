#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildModel, normaliseColour } = require('./lib/palette');
const { recolourSvg } = require('./lib/recolour');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join('app', 'assets', 'data');
const ICON_DIRECTORY = 'vendor/openmaptiles/style/icons';
const DARK_PALETTE = 'themes/dark/palette.json';
const SENTINEL = '#FE01FE';
const PLACEHOLDER = '__PALETTE_ROLE__';
const DATA_VERSION = 1;

const HASHED_STATIC_FILES = [
  'palette.json',
  DARK_PALETTE,
  'scripts/lib/palette.js',
  'scripts/lib/recolour.js',
  'scripts/palette-data.js',
  'vendor/openmaptiles/layers/poi/poi.yaml',
  'vendor/openmaptiles/layers/poi/mapping.yaml',
  'vendor/openmaptiles/layers/poi/style.json',
  'vendor/openmaptiles/layers/poi/poi.sql',
  'vendor/openmaptiles/layers/poi/class.sql',
  'sprite.json'
];

const OUTPUT_FILES = ['palette.json', 'icons.json', 'manifest.json'];

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableSort(values) {
  return Array.from(values).sort(compareStrings);
}

function uniqueSorted(values) {
  return stableSort(new Set(values));
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function loadThemePalette(root, relativePath) {
  const filePath = path.join(root, relativePath);
  let text;

  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Dark palette is missing: ${relativePath}`);
    }
    throw error;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Dark palette ${relativePath} is not valid JSON: ${error.message}`);
  }
}

function hashInputPaths(root) {
  const iconRoot = path.join(root, ICON_DIRECTORY);
  const iconFiles = fs
    .readdirSync(iconRoot)
    .filter((file) => file.toLowerCase().endsWith('.svg'))
    .map((file) => `${ICON_DIRECTORY}/${file}`);
  return stableSort([...HASHED_STATIC_FILES, ...iconFiles]);
}

function computeInputsHash({ root = DEFAULT_ROOT } = {}) {
  const hash = crypto.createHash('sha256');
  for (const relativePath of hashInputPaths(root)) {
    hash.update(relativePath);
    hash.update(Buffer.from([0]));
    hash.update(fs.readFileSync(path.join(root, relativePath)));
    hash.update(Buffer.from([0]));
  }
  return `sha256:${hash.digest('hex')}`;
}

function canonicalisePath(inputPath) {
  const resolved = path.resolve(inputPath);
  const missing = [];
  let current = resolved;

  while (true) {
    try {
      const real = fs.realpathSync.native(current);
      return missing.length ? path.join(real, ...missing.slice().reverse()) : real;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function isSamePath(left, right) {
  return path.relative(left, right) === '' && path.relative(right, left) === '';
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function resolveOutDir({ root = DEFAULT_ROOT, outDir } = {}) {
  const canonicalRoot = fs.realpathSync.native(path.resolve(root));
  const requested = outDir
    ? path.resolve(canonicalRoot, outDir)
    : path.join(canonicalRoot, OUTPUT_DIR);
  const canonicalTarget = canonicalisePath(requested);
  const allowedRoots = [
    path.join(canonicalRoot, OUTPUT_DIR),
    path.join(canonicalRoot, 'build'),
    path.join(canonicalRoot, '.opencode', 'tmp')
  ].map((allowedPath) => canonicalisePath(allowedPath));

  const allowed = allowedRoots.some(
    (allowedRoot) =>
      isSamePath(canonicalTarget, allowedRoot) || isInside(canonicalTarget, allowedRoot)
  );

  if (!allowed) {
    throw new Error(
      `Refusing to write palette app data to ${requested}: use ${OUTPUT_DIR}, build/ or .opencode/tmp/`
    );
  }

  return canonicalTarget;
}

function classProvenance(meta) {
  if (!meta) return 'runtime';
  if (meta.schemaBacked) return 'schema';
  if (meta.dynamic) return 'dynamic';
  return 'runtime';
}

function collectMissing(rows) {
  const missingByClass = new Map();
  const missingByName = new Map();

  for (const row of rows) {
    if (!missingByClass.has(row.class)) missingByClass.set(row.class, new Set());
    missingByClass.get(row.class).add(row.icon);

    if (!missingByName.has(row.icon)) missingByName.set(row.icon, new Set());
    missingByName.get(row.icon).add(row.class);
  }

  const missingItems = stableSort(missingByName.keys()).map((name) => ({
    name,
    classes: stableSort(missingByName.get(name))
  }));
  const missingGroupsMap = new Map();

  for (const item of missingItems) {
    const primaryClass = item.classes[0];
    if (!missingGroupsMap.has(primaryClass)) missingGroupsMap.set(primaryClass, []);
    missingGroupsMap.get(primaryClass).push(item);
  }

  return {
    missingItems,
    missingGroups: stableSort(missingGroupsMap.keys()).map((className) => ({
      class: className,
      items: missingGroupsMap.get(className)
    }))
  };
}

function buildPaletteData({ model }) {
  const classMeta = new Map(model.classes.map((entry) => [entry.name, entry]));
  const iconMeta = new Map(model.icons.map((entry) => [entry.name, entry]));
  const missingRows = model.rows.filter((row) => row.icon && !row.inSprite);
  const { missingItems, missingGroups } = collectMissing(missingRows);
  const missingByClass = new Map();
  for (const item of missingItems) {
    for (const className of item.classes) {
      if (!missingByClass.has(className)) missingByClass.set(className, new Set());
      missingByClass.get(className).add(item.name);
    }
  }
  const overrides = model.palette.overrides || {};

  const palette = {
    version: model.palette.version,
    roles: model.roles.map((role) => ({
      id: role.id,
      label: role.label,
      color: role.color,
      sourceColors: stableSort(role.sourceColors),
      order: role.order
    })),
    preserve: stableSort(
      (model.palette.preserve || []).map((colour) => normaliseColour(colour)).filter(Boolean)
    ),
    overrides: stableSort(Object.keys(overrides)).reduce((result, iconName) => {
      result[iconName] = overrides[iconName];
      return result;
    }, {})
  };

  const roles = model.roles.map((role) => {
    const roleRows = model.rows.filter((row) => row.inSprite && row.roleId === role.id);
    const classGroups = new Map();

    for (const row of roleRows) {
      if (!classGroups.has(row.class)) {
        const meta = classMeta.get(row.class);
        classGroups.set(row.class, {
          name: row.class,
          provenance: classProvenance(meta),
          mappingKeys: meta ? stableSort(meta.mappingKeys) : [],
          layers: new Set(),
          icons: new Map()
        });
      }

      const group = classGroups.get(row.class);
      for (const layer of row.styleLayers || []) group.layers.add(layer);

      if (!group.icons.has(row.icon)) {
        group.icons.set(row.icon, {
          subclasses: new Set(),
          layers: new Set(),
          fallback: row.fallback || null
        });
      }
      const icon = group.icons.get(row.icon);
      if (icon.fallback === null && row.fallback) icon.fallback = row.fallback;
      icon.subclasses.add(row.subclass);
      for (const layer of row.styleLayers || []) icon.layers.add(layer);
    }

    const classes = stableSort(classGroups.keys()).map((className) => {
      const group = classGroups.get(className);
      const icons = stableSort(group.icons.keys()).map((iconName) => {
        const entry = group.icons.get(iconName);
        const meta = iconMeta.get(iconName);
        const subclasses = stableSort(entry.subclasses);
        return {
          name: iconName,
          subclass: subclasses[0],
          subclasses,
          layers: stableSort(entry.layers),
          roleId: role.id,
          fallback: entry.fallback,
          inSprite: true,
          primaryFill: meta ? meta.primaryFill : null
        };
      });
      return {
        name: className,
        provenance: group.provenance,
        mappingKeys: group.mappingKeys,
        layers: stableSort(group.layers),
        icons,
        missingCount: missingByClass.has(className) ? missingByClass.get(className).size : 0
      };
    });

    const iconNames = uniqueSorted(roleRows.map((row) => row.icon));
    return {
      id: role.id,
      label: role.label,
      color: role.color,
      sourceColors: stableSort(role.sourceColors),
      order: role.order,
      iconCount: iconNames.length,
      classCount: classes.length,
      iconNames,
      classes
    };
  });

  const phantoms = stableSort(model.phantoms.map((entry) => entry.name)).map((name) => {
    const entry = model.phantoms.find((phantom) => phantom.name === name);
    return {
      name: entry.name,
      reason: entry.reason,
      schemaClass: entry.schemaClass || null,
      text:
        entry.reason === 'schema-subclass'
          ? `Subclass of ${entry.schemaClass}`
          : 'Unreachable filter literal'
    };
  });

  return {
    palette,
    roles,
    missingGroups,
    missingNames: missingItems.map((item) => item.name),
    phantoms,
    layers: model.layers.map((layer) => ({
      id: layer.id,
      order: layer.order,
      iconImage: layer.iconImage,
      textOnly: layer.textOnly
    })),
    summary: {
      roles: model.roles.length,
      classes: model.classes.length,
      features: model.rows.length,
      existingIcons: model.poiIcons.length,
      missingIcons: missingItems.length,
      phantoms: model.phantoms.length,
      layers: model.layers.length,
      iconLayers: model.layers.filter((layer) => !layer.textOnly).length,
      textLayers: model.layers.filter((layer) => layer.textOnly).length
    },
    modelSummary: model.summary
  };
}

function assertCleanSources(iconRoot) {
  const files = fs
    .readdirSync(iconRoot)
    .filter((file) => file.toLowerCase().endsWith('.svg'))
    .sort();

  for (const file of files) {
    const source = fs.readFileSync(path.join(iconRoot, file), 'utf8');
    if (source.toLowerCase().includes(SENTINEL.toLowerCase())) {
      throw new Error(`Source SVG ${ICON_DIRECTORY}/${file} contains the sentinel ${SENTINEL}`);
    }
    if (source.includes(PLACEHOLDER)) {
      throw new Error(`Source SVG ${ICON_DIRECTORY}/${file} contains ${PLACEHOLDER}`);
    }
  }
}

function buildIconTemplates({ root, model }) {
  const iconRoot = path.join(root, ICON_DIRECTORY);
  const preserve = new Set(
    (model.palette.preserve || []).map((colour) => normaliseColour(colour)).filter(Boolean)
  );
  const templates = {};

  assertCleanSources(iconRoot);

  for (const icon of stableSort(model.poiIcons.map((entry) => entry.name))) {
    const entry = model.poiIcons.find((candidate) => candidate.name === icon);
    const sourcePath = path.join(iconRoot, `${icon}.svg`);

    if (!entry.exists || !fs.existsSync(sourcePath)) {
      throw new Error(`POI icon ${icon} has no source SVG at ${ICON_DIRECTORY}/${icon}.svg`);
    }
    if (entry.pattern) {
      throw new Error(`POI icon ${icon} uses a pattern fill and cannot be templated`);
    }
    if (entry.strokeOnly) {
      throw new Error(`POI icon ${icon} is stroke-only and cannot be templated`);
    }
    if (!entry.primaryFill) {
      throw new Error(`POI icon ${icon} has no resolvable primary fill`);
    }

    const source = fs.readFileSync(sourcePath, 'utf8');
    const lowered = source.toLowerCase();

    if (lowered.includes(SENTINEL.toLowerCase())) {
      throw new Error(`POI icon ${icon} already contains the sentinel colour ${SENTINEL}`);
    }
    if (source.includes(PLACEHOLDER)) {
      throw new Error(`POI icon ${icon} already contains the ${PLACEHOLDER} placeholder`);
    }

    const recoloured = recolourSvg(source, {
      primary: entry.primaryFill,
      target: SENTINEL,
      preserve
    });

    if (!recoloured.includes(SENTINEL)) {
      throw new Error(`POI icon ${icon} could not be templated with a primary fill`);
    }

    const template = recoloured.split(SENTINEL).join(PLACEHOLDER);
    if (template.toLowerCase().includes(SENTINEL.toLowerCase())) {
      throw new Error(`POI icon ${icon} still contains the sentinel colour after templating`);
    }

    templates[icon] = template;
  }

  return templates;
}

function buildAppData({ root = DEFAULT_ROOT, model } = {}) {
  const resolvedRoot = path.resolve(root);
  const builtModel = model || buildModel({ root: resolvedRoot });
  const hardErrors = builtModel.issues.filter((issue) => issue.level === 'error');

  if (hardErrors.length) {
    throw new Error(
      `Palette model has ${hardErrors.length} hard error(s): ${hardErrors
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join('; ')}`
    );
  }

  const darkPalette = loadThemePalette(resolvedRoot, DARK_PALETTE);
  const darkModel = buildModel({ root: resolvedRoot, palette: darkPalette });
  const darkErrors = darkModel.issues.filter((issue) => issue.level === 'error');

  if (darkErrors.length) {
    throw new Error(
      `Dark palette model has ${darkErrors.length} hard error(s): ${darkErrors
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join('; ')}`
    );
  }

  const inputsHash = computeInputsHash({ root: resolvedRoot });
  const darkPaletteData = buildPaletteData({ model: darkModel });
  const darkColours = {};
  for (const role of darkPaletteData.palette.roles) darkColours[role.id] = role.color;

  const paletteDocument = {
    version: DATA_VERSION,
    inputsHash,
    ...buildPaletteData({ model: builtModel }),
    themes: {
      dark: {
        palette: darkPaletteData.palette,
        colours: darkColours
      }
    }
  };
  const icons = buildIconTemplates({ root: resolvedRoot, model: builtModel });
  const paletteText = stringify(paletteDocument);
  const iconsText = stringify(icons);
  const manifestDocument = {
    version: DATA_VERSION,
    inputsHash,
    files: {
      'palette.json': `sha256:${sha256Hex(paletteText)}`,
      'icons.json': `sha256:${sha256Hex(iconsText)}`
    }
  };
  const manifestText = stringify(manifestDocument);

  return {
    root: resolvedRoot,
    model: builtModel,
    palette: paletteDocument,
    icons,
    manifest: manifestDocument,
    paletteText,
    iconsText,
    manifestText,
    inputsHash
  };
}

function writeAppData({ root = DEFAULT_ROOT, outDir, data } = {}) {
  const resolvedRoot = path.resolve(root);
  const targetDir = resolveOutDir({ root: resolvedRoot, outDir });
  const built = data || buildAppData({ root: resolvedRoot });
  const contents = new Map([
    ['palette.json', built.paletteText],
    ['icons.json', built.iconsText],
    ['manifest.json', built.manifestText]
  ]);

  fs.mkdirSync(targetDir, { recursive: true });

  const files = {};
  for (const name of OUTPUT_FILES) {
    const text = contents.get(name);
    fs.writeFileSync(path.join(targetDir, name), text);
    files[name] = { bytes: Buffer.byteLength(text), sha256: `sha256:${sha256Hex(text)}` };
  }

  return {
    outDir: targetDir,
    inputsHash: built.inputsHash,
    summary: built.palette.summary,
    files
  };
}

function checkAppData({ root = DEFAULT_ROOT, outDir, data } = {}) {
  const resolvedRoot = path.resolve(root);
  const targetDir = resolveOutDir({ root: resolvedRoot, outDir });
  const expected = data || buildAppData({ root: resolvedRoot });
  const contents = new Map([
    ['palette.json', expected.paletteText],
    ['icons.json', expected.iconsText],
    ['manifest.json', expected.manifestText]
  ]);
  const problems = [];

  for (const name of OUTPUT_FILES) {
    const filePath = path.join(targetDir, name);
    let actual;
    try {
      actual = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        problems.push(`missing ${name}`);
        continue;
      }
      throw error;
    }
    if (actual !== contents.get(name)) problems.push(`stale ${name}`);
  }

  return {
    ok: problems.length === 0,
    outDir: targetDir,
    inputsHash: expected.inputsHash,
    problems,
    message: problems.length
      ? `Palette app data is out of date (${problems.join(', ')}); run npm run palette:data`
      : `Palette app data is in sync (${expected.inputsHash})`
  };
}

function usage() {
  return [
    'Usage: node scripts/palette-data.js [options]',
    '',
    'Options:',
    `  (no arguments)  Write ${OUTPUT_DIR}/{palette,icons,manifest}.json`,
    '  --check         Verify generated data is in sync without writing',
    '  --out <dir>     Use an alternate generated directory (build/ or .opencode/tmp/)',
    '  --help, -h      Show this help'
  ].join('\n');
}

function parseArguments(argv) {
  const options = { check: false, help: false, out: null };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') {
      options.check = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--out') {
      const value = argv[index + 1];
      if (value === undefined || value === '') {
        throw new Error('--out requires a non-empty directory');
      }
      options.out = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  const root = DEFAULT_ROOT;

  try {
    if (options.check) {
      const result = checkAppData({ root, outDir: options.out });
      if (!result.ok) {
        console.error(result.message);
        process.exitCode = 1;
        return;
      }
      console.log(result.message);
      return;
    }

    const result = writeAppData({ root, outDir: options.out });
    console.log(`Wrote palette app data to ${result.outDir}`);
    console.log(
      `  ${result.summary.roles} roles, ${result.summary.classes} classes, ${result.summary.existingIcons} icons`
    );
    console.log(`  inputs ${result.inputsHash}`);
    for (const name of OUTPUT_FILES) {
      console.log(`  ${name} ${result.files[name].bytes} bytes ${result.files[name].sha256}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DATA_VERSION,
  DARK_PALETTE,
  DEFAULT_ROOT,
  HASHED_STATIC_FILES,
  ICON_DIRECTORY,
  OUTPUT_DIR,
  PLACEHOLDER,
  SENTINEL,
  buildAppData,
  buildPaletteData,
  buildIconTemplates,
  checkAppData,
  computeInputsHash,
  parseArguments,
  resolveOutDir,
  sha256Hex,
  writeAppData
};
