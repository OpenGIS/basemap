'use strict';

const fs = require('node:fs');
const {
  parseColour,
  tryParseColour,
  canonicalColour,
  formatColour
} = require('./colour');

const COLOUR_PROPERTIES = Object.freeze([
  'background-color',
  'fill-color',
  'fill-outline-color',
  'line-color',
  'icon-color',
  'icon-halo-color',
  'text-color',
  'text-halo-color'
]);

const COLOUR_PROPERTY_SET = new Set(COLOUR_PROPERTIES);
const RULE_KEYS = new Set(['layer', 'property', 'from', 'to', 'preserveAlpha']);
const THEME_KEYS = new Set(['version', 'name', 'tokens', 'rules']);

// Style literals must use explicit colour syntax. `parseColour` also accepts
// bare hex strings for theme values, but a bare token such as `cafe` in an
// expression operand is a data value, not a colour, so the walker must not
// rewrite it.
function isStyleColourLiteral(value) {
  const text = value.trim().toLowerCase();
  return (
    text.startsWith('#') ||
    text.startsWith('rgb(') ||
    text.startsWith('rgba(') ||
    text.startsWith('hsl(') ||
    text.startsWith('hsla(') ||
    text === 'transparent'
  );
}

class ThemeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ThemeError';
    if (details.unmatched) this.unmatched = details.unmatched;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(message) {
  throw new ThemeError(message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function validateThemeShape(theme) {
  if (!isPlainObject(theme)) fail('Theme must be a JSON object');
  for (const key of Object.keys(theme)) {
    if (!THEME_KEYS.has(key)) fail(`Unknown theme key ${JSON.stringify(key)}`);
  }

  if (theme.version !== 1) fail('Theme version must be 1');
  if (typeof theme.name !== 'string' || !theme.name.trim()) {
    fail('Theme name must be a non-empty string');
  }
  if (!isPlainObject(theme.tokens)) fail('Theme tokens must be an object');
  if (!Array.isArray(theme.rules)) fail('Theme rules must be an array');
}

function compileTokens(tokens) {
  const compiled = new Map();

  for (const [name, value] of Object.entries(tokens)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
      fail(`Token name ${JSON.stringify(name)} must start with a letter and contain only letters, digits, dashes or underscores`);
    }
    if (typeof value !== 'string') fail(`Token ${JSON.stringify(name)} must be a colour string`);
    try {
      compiled.set(name, parseColour(value));
    } catch (error) {
      fail(`Token ${JSON.stringify(name)} is not a valid colour: ${error.message}`);
    }
  }

  return compiled;
}

function resolveTarget(value, tokens, path) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${path}.to must be a colour literal or @token reference`);
  }

  if (!value.startsWith('@')) {
    try {
      return parseColour(value);
    } catch (error) {
      fail(`${path}.to is not a valid colour: ${error.message}`);
    }
  }

  const name = value.slice(1);
  if (!name) fail(`${path}.to has an empty token reference`);
  if (!tokens.has(name)) fail(`${path}.to references unknown token @${name}`);
  return tokens.get(name);
}

function compileRule(rule, index, tokens) {
  const path = `rules[${index}]`;

  if (!isPlainObject(rule)) fail(`${path} must be an object`);
  for (const key of Object.keys(rule)) {
    if (!RULE_KEYS.has(key)) fail(`${path} has unknown key ${JSON.stringify(key)}`);
  }

  if (typeof rule.layer !== 'string' || !rule.layer.trim()) {
    fail(`${path}.layer must be a non-empty string`);
  }

  if (typeof rule.property !== 'string' || !COLOUR_PROPERTY_SET.has(rule.property)) {
    fail(
      `${path}.property must be one of the colour paint properties: ${COLOUR_PROPERTIES.join(', ')}`
    );
  }

  let from = null;
  if (rule.from !== undefined) {
    try {
      from = canonicalColour(rule.from);
    } catch (error) {
      fail(`${path}.from is not a valid colour: ${error.message}`);
    }
  }

  const target = resolveTarget(rule.to, tokens, path);

  if (rule.preserveAlpha !== undefined && typeof rule.preserveAlpha !== 'boolean') {
    fail(`${path}.preserveAlpha must be a boolean`);
  }

  return {
    index,
    layer: rule.layer,
    layerPattern: globToRegExp(rule.layer),
    property: rule.property,
    from,
    target,
    preserveAlpha: rule.preserveAlpha !== false
  };
}

function compileTheme(theme, options = {}) {
  if (theme == null) {
    return { name: null, tokens: new Map(), rules: [], strict: options.strict !== false };
  }

  validateThemeShape(theme);
  const tokens = compileTokens(theme.tokens);
  const rules = theme.rules.map((rule, index) => compileRule(rule, index, tokens));

  return {
    name: theme.name,
    tokens,
    rules,
    strict: options.strict !== false
  };
}

function loadTheme(filePath, options = {}) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new ThemeError(`Cannot read theme ${filePath}: ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ThemeError(`Cannot parse theme ${filePath}: ${error.message}`);
  }

  compileTheme(parsed, options);
  return parsed;
}

function isCompiledTheme(value) {
  return isPlainObject(value) && Array.isArray(value.rules) && value.tokens instanceof Map;
}

function findRule(rules, layerId, property, canonical) {
  for (const rule of rules) {
    if (rule.property !== property) continue;
    if (!rule.layerPattern.test(layerId)) continue;
    if (rule.from !== null && rule.from !== canonical) continue;
    return rule;
  }
  return null;
}

function transformColour(original, rule) {
  const target = rule.target;
  const alpha = rule.preserveAlpha ? original.a * target.a : target.a;
  return formatColour({ r: target.r, g: target.g, b: target.b, a: alpha });
}

function addUnmatched(unmatched, seen, layerId, property, literal) {
  const canonical = canonicalColour(literal);
  const key = `${layerId}\u0000${property}\u0000${canonical}`;
  if (seen.has(key)) return;

  seen.add(key);
  unmatched.push({ layer: layerId, property, literal, canonical });
}

function walkValue(value, layerId, property, rules, unmatched, seen) {
  if (typeof value === 'string') {
    if (!isStyleColourLiteral(value)) return value;

    const original = tryParseColour(value);
    if (!original) return value;

    const canonical = canonicalColour(original);
    const rule = findRule(rules, layerId, property, canonical);
    if (!rule) {
      addUnmatched(unmatched, seen, layerId, property, value);
      return value;
    }

    return transformColour(original, rule);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => walkValue(entry, layerId, property, rules, unmatched, seen));
  }

  if (isPlainObject(value)) {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = walkValue(entry, layerId, property, rules, unmatched, seen);
    }
    return result;
  }

  return value;
}

function formatUnmatched(unmatched) {
  return unmatched
    .slice()
    .sort(
      (a, b) =>
        a.layer.localeCompare(b.layer) ||
        a.property.localeCompare(b.property) ||
        a.canonical.localeCompare(b.canonical)
    )
    .map(
      (entry) =>
        `  layer ${JSON.stringify(entry.layer)} property ${JSON.stringify(entry.property)} literal ${JSON.stringify(entry.literal)} (${entry.canonical})`
    )
    .join('\n');
}

function applyTheme(style, theme, options = {}) {
  if (!isPlainObject(style)) fail('Style must be a JSON object');
  if (style.layers !== undefined && !Array.isArray(style.layers)) {
    fail('Style layers must be an array');
  }

  const output = clone(style);
  if (theme == null) return output;

  const compiled = isCompiledTheme(theme) ? theme : compileTheme(theme, options);
  const strict = options.strict === undefined ? compiled.strict : options.strict !== false;
  const unmatched = [];
  const seen = new Set();

  for (const layer of output.layers || []) {
    if (!isPlainObject(layer) || !isPlainObject(layer.paint)) continue;

    for (const [property, value] of Object.entries(layer.paint)) {
      if (!COLOUR_PROPERTY_SET.has(property)) continue;
      layer.paint[property] = walkValue(
        value,
        layer.id,
        property,
        compiled.rules,
        unmatched,
        seen
      );
    }
  }

  if (strict && unmatched.length) {
    const label = compiled.name ? `Theme ${JSON.stringify(compiled.name)}` : 'Theme';
    throw new ThemeError(
      `${label} left ${unmatched.length} colour literal(s) unmatched:\n${formatUnmatched(unmatched)}`,
      { unmatched }
    );
  }

  return output;
}

function applyThemeFile(style, filePath, options = {}) {
  const theme = loadTheme(filePath, options);
  return applyTheme(style, theme, options);
}

module.exports = {
  COLOUR_PROPERTIES,
  ThemeError,
  loadTheme,
  compileTheme,
  applyTheme,
  applyThemeFile,
  parseColour,
  tryParseColour,
  canonicalColour,
  formatColour
};
