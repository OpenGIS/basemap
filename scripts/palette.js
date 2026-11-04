#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildModel } = require('./lib/palette');
const { recolourIcons } = require('./lib/recolour');

const DEFAULT_OUTPUT = path.join('build', 'icons');

const THEMES = {
  light: {
    palette: 'palette.json',
    output: path.join('build', 'light', 'icons')
  },
  dark: {
    palette: path.join('themes', 'dark', 'palette.json'),
    output: path.join('build', 'dark', 'icons')
  }
};

function resolveTheme(themeName) {
  if (!Object.prototype.hasOwnProperty.call(THEMES, themeName)) {
    throw new Error(
      `Unknown theme: ${themeName}. Expected one of: ${Object.keys(THEMES).join(', ')}`
    );
  }
  return THEMES[themeName];
}

function resolveThemePalette(root, themeName) {
  return path.join(root, resolveTheme(themeName).palette);
}

function resolveDefaultOutput(root, themeName) {
  if (!themeName) return path.join(root, DEFAULT_OUTPUT);
  return path.join(root, resolveTheme(themeName).output);
}

function formatIssues(issues) {
  return issues.map((issue) => `  [${issue.level}] ${issue.code}: ${issue.message}`);
}

function formatSummary(model) {
  const { summary, roles, issues } = model;
  const schema = summary.schema;
  const lines = [
    'Palette summary',
    '  Schema',
    `    classes: ${schema.classes}`,
    `    rows: ${schema.rows}`,
    `    rows: ${schema.resolved} resolved, ${schema.textOnly} text-only, ${schema.noLayer} no layer`,
    `    icons: ${schema.icons} existing (${schema.selectedNames} selected names, ${schema.missingSprite} missing)`,
    '  Complete POI set',
    `    classes: ${summary.classes} (${summary.schemaClasses} schema, ${summary.runtimeClasses} runtime, ${summary.dynamicClasses} dynamic families)`,
    `    phantom literals: ${summary.phantomClasses}`,
    `    icon-capable classes: ${summary.iconCapableClasses}`,
    `    features: ${summary.features} (${summary.featureProvenance.schema} schema, ${summary.featureProvenance.runtime} runtime, ${summary.featureProvenance.dynamic} dynamic)`,
    `    rows: ${summary.resolved} resolved, ${summary.textOnly} text-only, ${summary.noLayer} no layer`,
    `    candidate icons: ${summary.candidates} (${summary.existingIcons} existing, ${summary.missingSprite} missing)`,
    `    layers: ${summary.layers} (${summary.iconLayers} icon, ${summary.textOnlyLayers} text-only)`,
    `    sprite icons: ${summary.spriteIcons}, svg icons: ${summary.svgIcons}`,
    `    roles: ${summary.roles}`,
    ...roles.map((role) => `      ${role.id}: ${role.iconCount}`),
    `  issues: ${summary.issues} (${summary.errors} errors, ${summary.warnings} warnings, ${summary.infos} info)`
  ];

  if (issues.length) {
    lines.push('', 'Issues');
    lines.push(...formatIssues(issues));
  }

  return lines.join('\n');
}

function usage() {
  return [
    'Usage: node scripts/palette.js [options]',
    '',
    'Options:',
    '  --summary            Print the palette model summary (default)',
    '  --apply              Write palette-recoloured icons',
    '  --theme <name>       Use a theme palette (light or dark); defaults to',
    '                       build/light/icons or build/dark/icons',
    '  --out <dir>          Output directory; must be a strict subdirectory of',
    '                       build/ or .opencode/tmp/',
    '  --palette <path>     Use an alternative palette JSON file; cannot be',
    '                       combined with --theme',
    '  --help, -h           Show this help'
  ].join('\n');
}

function parseArguments(argv) {
  const options = {
    summary: true,
    apply: false,
    help: false,
    out: null,
    palette: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--summary') {
      options.summary = true;
    } else if (argument === '--apply') {
      options.apply = true;
    } else if (argument === '--out') {
      index += 1;
      if (index >= argv.length || argv[index] === '') {
        throw new Error('--out requires a non-empty directory');
      }
      options.out = argv[index];
    } else if (argument === '--palette') {
      index += 1;
      if (index >= argv.length) throw new Error('--palette requires a file path');
      options.palette = argv[index];
    } else if (argument === '--theme') {
      index += 1;
      if (index >= argv.length || argv[index] === '') {
        throw new Error('--theme requires a theme name (light or dark)');
      }
      options.theme = argv[index];
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (options.theme && options.palette) {
    throw new Error('--theme and --palette cannot be used together');
  }
  if (options.theme) resolveTheme(options.theme);
  return options;
}

function loadPalette(root, palettePath) {
  if (!palettePath) return undefined;
  const resolved = path.resolve(process.cwd(), palettePath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
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

  const root = path.resolve(__dirname, '..');
  let palette;

  try {
    palette = options.theme
      ? JSON.parse(fs.readFileSync(resolveThemePalette(root, options.theme), 'utf8'))
      : loadPalette(root, options.palette);
  } catch (error) {
    console.error(`Unable to read palette: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (options.apply) {
    const outDir = options.out
      ? path.resolve(process.cwd(), options.out)
      : resolveDefaultOutput(root, options.theme);

    try {
      const result = recolourIcons({ root, palette, outDir });
      console.log(
        `Wrote ${result.files} icons to ${result.outDir} (${result.recoloured.length} recoloured)`
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
    return;
  }

  const model = buildModel({ root, palette });
  console.log(formatSummary(model));

  const hardErrors = model.issues.filter((issue) => issue.level === 'error');
  if (hardErrors.length) process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_OUTPUT,
  THEMES,
  formatSummary,
  formatIssues,
  parseArguments,
  loadPalette,
  main,
  usage,
  resolveTheme,
  resolveThemePalette,
  resolveDefaultOutput
};
