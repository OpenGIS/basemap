'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');
const WHITE = '#FFFFFF';

const NAMED_COLOURS = {
  aliceblue: '#F0F8FF',
  antiquewhite: '#FAEBD7',
  aqua: '#00FFFF',
  aquamarine: '#7FFFD4',
  azure: '#F0FFFF',
  beige: '#F5F5DC',
  bisque: '#FFE4C4',
  black: '#000000',
  blue: '#0000FF',
  brown: '#A52A2A',
  chartreuse: '#7FFF00',
  chocolate: '#D2691E',
  coral: '#FF7F50',
  crimson: '#DC143C',
  cyan: '#00FFFF',
  darkblue: '#00008B',
  darkgreen: '#006400',
  darkgrey: '#A9A9A9',
  darkgray: '#A9A9A9',
  darkred: '#8B0000',
  fuchsia: '#FF00FF',
  gold: '#FFD700',
  gray: '#808080',
  green: '#008000',
  grey: '#808080',
  indigo: '#4B0082',
  ivory: '#FFFFF0',
  khaki: '#F0E68C',
  lavender: '#E6E6FA',
  lime: '#00FF00',
  magenta: '#FF00FF',
  maroon: '#800000',
  navy: '#000080',
  olive: '#808000',
  orange: '#FFA500',
  orchid: '#DA70D6',
  pink: '#FFC0CB',
  plum: '#DDA0DD',
  purple: '#800080',
  red: '#FF0000',
  salmon: '#FA8072',
  silver: '#C0C0C0',
  snow: '#FFFAFA',
  tan: '#D2B48C',
  teal: '#008080',
  tomato: '#FF6347',
  turquoise: '#40E0D0',
  violet: '#EE82EE',
  wheat: '#F5DEB3',
  white: '#FFFFFF',
  yellow: '#FFFF00'
};

const SHAPE_TAGS = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'polygon',
  'polyline',
  'line',
  'use'
]);

const SKIP_CONTAINERS = new Set(['defs', 'clippath', 'mask', 'pattern', 'symbol', 'marker']);

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normaliseColour(value) {
  if (value === undefined || value === null) return null;
  let colour = String(value).trim().toLowerCase();
  if (!colour) return null;
  if (Object.prototype.hasOwnProperty.call(NAMED_COLOURS, colour)) {
    colour = NAMED_COLOURS[colour];
  }
  if (/^#[0-9a-f]{3}$/i.test(colour)) {
    colour = `#${colour[1]}${colour[1]}${colour[2]}${colour[2]}${colour[3]}${colour[3]}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(colour)) {
    return colour.toUpperCase();
  }
  return null;
}

function classifyPaint(value) {
  if (value === undefined || value === null) return { kind: 'inherit' };
  const text = String(value).trim().toLowerCase();
  if (!text) return { kind: 'inherit' };
  if (text === 'none' || text === 'transparent') return { kind: 'none' };
  if (text.startsWith('url(')) return { kind: 'url', value: text };
  const colour = normaliseColour(text);
  if (colour) return { kind: 'colour', value: colour };
  return { kind: 'unknown', value: text };
}

function parseStyleAttribute(value) {
  const result = {};
  if (!value) return result;
  for (const declaration of String(value).split(';')) {
    const index = declaration.indexOf(':');
    if (index === -1) continue;
    const property = declaration.slice(0, index).trim().toLowerCase();
    const propertyValue = declaration.slice(index + 1).trim();
    if (property) result[property] = propertyValue;
  }
  return result;
}

function parseAttributes(value) {
  const result = {};
  const pattern = /([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(value || '')) !== null) {
    result[match[1].toLowerCase()] = match[3] !== undefined ? match[3] : match[4];
  }
  return result;
}

function modeOf(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const ordered = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  return ordered.length ? ordered[0][0] : null;
}

function analyseSvg(svg, name) {
  const cleaned = String(svg).replace(/<!--[\s\S]*?-->/g, '');
  const tagPattern = /<(\/?)([A-Za-z][A-Za-z0-9:_-]*)([^>]*?)(\/?)>/g;
  const fills = [];
  const strokes = [];
  const stack = [];
  let skipDepth = 0;
  let pattern = false;
  let match;

  while ((match = tagPattern.exec(cleaned)) !== null) {
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const selfClosing = match[4] === '/';
    const attributes = parseAttributes(match[3] || '');

    if (closing) {
      if (stack.length) stack.pop();
      if (SKIP_CONTAINERS.has(tag) && skipDepth > 0) skipDepth -= 1;
      continue;
    }

    const parent = stack.length
      ? stack[stack.length - 1]
      : { fill: { kind: 'inherit' }, stroke: { kind: 'inherit' } };
    const style = parseStyleAttribute(attributes.style);
    const ownFill = classifyPaint(
      Object.prototype.hasOwnProperty.call(style, 'fill') ? style.fill : attributes.fill
    );
    const ownStroke = classifyPaint(
      Object.prototype.hasOwnProperty.call(style, 'stroke') ? style.stroke : attributes.stroke
    );
    const inheritedFill = ownFill.kind === 'inherit' ? parent.fill : ownFill;
    const inheritedStroke = ownStroke.kind === 'inherit' ? parent.stroke : ownStroke;

    if (SKIP_CONTAINERS.has(tag)) skipDepth += 1;
    const insideSkippedContainer = skipDepth > 0;

    if (!insideSkippedContainer && SHAPE_TAGS.has(tag)) {
      if (inheritedFill.kind === 'url') {
        pattern = true;
      } else if (inheritedFill.kind === 'colour') {
        fills.push(inheritedFill.value);
      } else if (inheritedFill.kind === 'inherit') {
        if (inheritedStroke.kind === 'inherit') fills.push('#000000');
      }

      if (inheritedStroke.kind === 'url') {
        pattern = true;
      } else if (inheritedStroke.kind === 'colour') {
        strokes.push(inheritedStroke.value);
      }
    }

    if (!selfClosing) {
      stack.push({ fill: inheritedFill, stroke: inheritedStroke });
    } else if (SKIP_CONTAINERS.has(tag) && skipDepth > 0) {
      skipDepth -= 1;
    }
  }

  const fillCounts = new Map();
  for (const colour of fills) fillCounts.set(colour, (fillCounts.get(colour) || 0) + 1);
  const distinctFills = Array.from(fillCounts.keys()).sort();
  const nonWhiteFills = distinctFills.filter((colour) => colour !== WHITE);
  const nonWhiteStrokeFills = Array.from(new Set(strokes))
    .filter((colour) => colour !== WHITE)
    .sort();
  const strokeOnly = fills.length === 0 && strokes.length > 0;
  const unparseable = pattern;
  let primaryFill = null;

  if (!pattern) {
    if (nonWhiteFills.length) {
      primaryFill = modeOf(fills.filter((colour) => colour !== WHITE));
    } else if (fills.length) {
      primaryFill = modeOf(fills);
    } else if (nonWhiteStrokeFills.length) {
      primaryFill = modeOf(strokes.filter((colour) => colour !== WHITE));
    } else if (strokes.length) {
      primaryFill = modeOf(strokes);
    }
  }

  return {
    name,
    exists: true,
    primaryFill,
    distinctFills,
    nonWhiteFills,
    strokes: Array.from(new Set(strokes)).sort(),
    strokeOnly,
    pattern,
    unparseable,
    fillCount: fills.length
  };
}

function readFlowSequence(text) {
  const inner = text.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!inner.trim()) return [];
  return inner
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/^['"]|['"]$/g, ''));
}

function readValueAcross(lines, startIndex, initial) {
  let text = initial === undefined ? '' : initial;
  let index = startIndex;
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    let depth = (trimmed.match(/\[/g) || []).length - (trimmed.match(/\]/g) || []).length;
    while (depth > 0 && index + 1 < lines.length) {
      index += 1;
      const next = lines[index];
      text += ` ${next.trim()}`;
      depth += (next.match(/\[/g) || []).length - (next.match(/\]/g) || []).length;
    }
  }
  const valueText = text.trim();
  if (valueText.startsWith('[')) return { value: readFlowSequence(valueText), end: index };
  return { value: valueText.replace(/^['"]|['"]$/g, ''), end: index };
}

function readMappingFields(lines, startIndex, indent) {
  const fields = {};
  const pattern = new RegExp(`^ {${indent}}([A-Za-z_][A-Za-z0-9_]*):\\s*(.*)$`);
  let index = startIndex;
  let last = startIndex - 1;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const match = line.match(pattern);
    if (!match) break;
    const parsed = readValueAcross(lines, index, match[2]);
    fields[match[1]] = parsed.value;
    last = parsed.end;
    index = parsed.end + 1;
  }
  return { fields, end: last };
}

function addCatalogueRows(rows, className, subclasses, mappingKey) {
  const list = Array.isArray(subclasses) ? subclasses : [subclasses];
  for (const subclass of list) {
    if (subclass === undefined || subclass === null || subclass === '') continue;
    const row = { class: className, subclass };
    if (mappingKey) row.mappingKey = mappingKey;
    rows.push(row);
  }
}

function parsePoiMappings(text) {
  const lines = text.split(/\r?\n/);
  const mappings = {};
  let current = null;

  for (const line of lines) {
    const header = line.match(/^def_poi_mapping_([A-Za-z0-9_]+):/);
    if (header) {
      current = header[1];
      mappings[current] = [];
      continue;
    }
    if (!current) continue;
    const value = line.match(/^ {2}- (.+?)\s*$/);
    if (value) {
      mappings[current].push(value[1].replace(/^['"]|['"]$/g, ''));
      continue;
    }
    if (line.trim() && !line.startsWith('#') && !/^ {2}/.test(line)) {
      current = null;
    }
  }

  return mappings;
}

function collectClassLiterals(expression, target) {
  if (!Array.isArray(expression)) return;
  const [operator, ...args] = expression;
  if (['in', '!in', '==', '!='].includes(operator) && args[0] === 'class') {
    for (const value of args.slice(1)) target.add(value);
  }
  for (const argument of expression) {
    if (Array.isArray(argument)) collectClassLiterals(argument, target);
  }
}

function extractClassLiterals(layers) {
  const literals = new Set();
  for (const layer of layers) {
    if (layer.textOnly) continue;
    collectClassLiterals(layer.filter, literals);
  }
  return Array.from(literals).sort();
}

function parsePoiCatalogue(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^ {6}values:\s*$/.test(line));
  const classes = [];
  const rows = [];
  let current = null;
  let index = start === -1 ? lines.length : start + 1;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() && /^ {0,6}\S/.test(line)) break;

    const classMatch = line.match(/^ {8}([A-Za-z0-9_]+):\s*(.*)$/);
    if (classMatch) {
      current = { name: classMatch[1], subclasses: [], rows: [] };
      classes.push(current);
      index += 1;
      continue;
    }

    if (!current) {
      index += 1;
      continue;
    }

    const subclassMatch = line.match(/^ {10}subclass:\s*(.*)$/);
    if (subclassMatch) {
      const parsed = readValueAcross(lines, index, subclassMatch[1]);
      addCatalogueRows(current.rows, current.name, parsed.value);
      index = parsed.end + 1;
      continue;
    }

    const listMatch = line.match(/^ {10}- (.*)$/);
    if (listMatch) {
      const rest = listMatch[1];
      if (/^__AND__:\s*$/.test(rest)) {
        const parsed = readMappingFields(lines, index + 1, 14);
        addCatalogueRows(current.rows, current.name, parsed.fields.subclass, parsed.fields.mapping_key);
        index = parsed.end + 1;
        continue;
      }
      const itemSubclass = rest.match(/^subclass:\s*(.*)$/);
      if (itemSubclass) {
        const parsed = readValueAcross(lines, index, itemSubclass[1]);
        addCatalogueRows(current.rows, current.name, parsed.value);
        index = parsed.end + 1;
        continue;
      }
    }

    if (/^ {10}__AND__:\s*$/.test(line)) {
      const parsed = readMappingFields(lines, index + 1, 12);
      addCatalogueRows(current.rows, current.name, parsed.fields.subclass, parsed.fields.mapping_key);
      index = parsed.end + 1;
      continue;
    }

    index += 1;
  }

  for (const entry of classes) {
    entry.subclasses = Array.from(new Set(entry.rows.map((row) => row.subclass))).sort();
    entry.rows.sort((a, b) => a.subclass.localeCompare(b.subclass));
  }
  classes.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of classes) {
    for (const row of entry.rows) rows.push(row);
  }
  rows.sort((a, b) => {
    const byClass = a.class.localeCompare(b.class);
    if (byClass !== 0) return byClass;
    return a.subclass.localeCompare(b.subclass);
  });

  return { classes, rows };
}

function evaluateFilter(expression, feature) {
  if (!expression) return true;
  if (!Array.isArray(expression)) return Boolean(expression);
  const [operator, ...args] = expression;

  if (operator === 'all') return args.every((item) => evaluateFilter(item, feature));
  if (operator === 'any') return args.some((item) => evaluateFilter(item, feature));
  if (operator === 'in') {
    const [key, ...values] = args;
    return values.includes(feature[key]);
  }
  if (operator === '!in') {
    const [key, ...values] = args;
    return !values.includes(feature[key]);
  }
  if (operator === '==') return feature[args[0]] === args[1];
  if (operator === '!=') return feature[args[0]] !== args[1];

  throw new Error(`Unsupported filter operator: ${operator}`);
}

function resolveImageExpression(expression, row, spriteNames) {
  if (typeof expression === 'string') {
    return {
      icon: expression.replace(/\{(class|subclass)\}/g, (_, key) => row[key] || ''),
      fallback: null
    };
  }
  if (!Array.isArray(expression)) return null;

  if (expression[0] === 'coalesce') {
    for (const candidate of expression.slice(1)) {
      const resolved = resolveImageExpression(candidate, row, spriteNames);
      if (!resolved || !resolved.icon) continue;
      const isLiteral = Array.isArray(candidate) && candidate[0] === 'image' && typeof candidate[1] === 'string';
      if (isLiteral || spriteNames.has(resolved.icon)) {
        return { icon: resolved.icon, fallback: resolved.fallback || 'dot' };
      }
    }
    return null;
  }

  if (expression[0] === 'image') {
    const argument = expression[1];
    if (typeof argument === 'string') return { icon: argument, fallback: 'dot' };
    if (Array.isArray(argument) && argument[0] === 'get') {
      return { icon: row[argument[1]] || null, fallback: argument[1] };
    }
  }

  return null;
}

function resolveIconImage(iconImage, row, spriteNames) {
  if (!iconImage) return null;
  const resolved = resolveImageExpression(iconImage, row, spriteNames);
  return resolved ? resolved.icon : null;
}

function resolveIconImageWithFallback(iconImage, row, spriteNames) {
  if (!iconImage) return null;
  return resolveImageExpression(iconImage, row, spriteNames);
}

function issueSortKey(issue) {
  return [issue.level, issue.code, issue.message].join('|');
}

function buildModel({ root = DEFAULT_ROOT, palette: paletteOverride } = {}) {
  const palette = paletteOverride || readJSON(path.join(root, 'palette.json'));
  const poiDirectory = path.join(root, 'vendor', 'openmaptiles', 'layers', 'poi');
  const catalogue = parsePoiCatalogue(
    fs.readFileSync(path.join(poiDirectory, 'poi.yaml'), 'utf8')
  );
  const mappings = parsePoiMappings(fs.readFileSync(path.join(poiDirectory, 'mapping.yaml'), 'utf8'));
  const style = readJSON(path.join(poiDirectory, 'style.json'));
  const sprite = readJSON(path.join(root, 'sprite.json'));
  const spriteNames = new Set(Object.keys(sprite));
  const iconsDirectory = path.join(root, 'vendor', 'openmaptiles', 'style', 'icons');

  const layers = style.layers.map((layer, index) => {
    const iconImage = layer.layout ? layer.layout['icon-image'] : undefined;
    return {
      id: layer.id,
      order: index,
      filter: layer.filter || null,
      iconImage: iconImage === undefined ? null : iconImage,
      textOnly: iconImage === undefined
    };
  });

  const issues = [];
  const addIssue = (level, code, message, details = {}) => {
    issues.push({ level, code, message, ...details });
  };

  const mappingKeysByValue = new Map();
  for (const [key, values] of Object.entries(mappings)) {
    for (const value of values) {
      if (!mappingKeysByValue.has(value)) mappingKeysByValue.set(value, []);
      const keys = mappingKeysByValue.get(value);
      if (!keys.includes(key)) keys.push(key);
    }
  }
  const mappingValues = new Set(mappingKeysByValue.keys());

  const schemaByName = new Map(catalogue.classes.map((entry) => [entry.name, entry]));
  const schemaSubclassToClass = new Map();
  for (const row of catalogue.rows) {
    if (!schemaSubclassToClass.has(row.subclass)) schemaSubclassToClass.set(row.subclass, row.class);
  }

  const dynamicFamilies = {
    information: ['guidepost', 'board', 'map', 'terminal', 'audioguide'],
    pitch: mappings.sport.slice(),
    place_of_worship: [
      'christian',
      'muslim',
      'jewish',
      'hinduist',
      'buddhist',
      'shintoist',
      'sikhist',
      'taoist',
      'multifaith',
      'cross',
      'place_of_worship'
    ]
  };

  const classLiterals = extractClassLiterals(layers);
  const phantomLiterals = [];
  const runtimeClassNames = [];

  for (const literal of classLiterals) {
    if (schemaByName.has(literal)) continue;
    if (!mappingValues.has(literal)) {
      phantomLiterals.push({ name: literal, reason: 'not-in-mapping-values' });
    } else if (schemaSubclassToClass.has(literal)) {
      phantomLiterals.push({
        name: literal,
        reason: 'schema-subclass',
        schemaClass: schemaSubclassToClass.get(literal)
      });
    } else {
      runtimeClassNames.push(literal);
    }
  }

  const classes = [];

  for (const entry of catalogue.classes) {
    classes.push({
      name: entry.name,
      schemaBacked: true,
      runtime: false,
      dynamic: false,
      phantom: false,
      source: 'schema',
      mappingKeys: (mappingKeysByValue.get(entry.name) || []).slice().sort(),
      subclasses: entry.subclasses.slice(),
      featureCount: 0,
      iconCapable: false
    });
  }

  for (const name of runtimeClassNames) {
    const dynamic = Object.prototype.hasOwnProperty.call(dynamicFamilies, name);
    classes.push({
      name,
      schemaBacked: false,
      runtime: true,
      dynamic,
      phantom: false,
      source: dynamic ? 'dynamic' : 'runtime',
      mappingKeys: (mappingKeysByValue.get(name) || []).slice().sort(),
      subclasses: dynamic ? dynamicFamilies[name].slice() : [name],
      featureCount: 0,
      iconCapable: false
    });
  }

  classes.sort((a, b) => a.name.localeCompare(b.name));

  const phantoms = phantomLiterals
    .map((entry) => ({
      name: entry.name,
      schemaBacked: false,
      runtime: false,
      dynamic: false,
      phantom: true,
      source: 'phantom',
      mappingKeys: (mappingKeysByValue.get(entry.name) || []).slice().sort(),
      subclasses: [],
      featureCount: 0,
      iconCapable: false,
      reason: entry.reason,
      schemaClass: entry.schemaClass || null
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const features = [];

  for (const row of catalogue.rows) {
    features.push({
      class: row.class,
      subclass: row.subclass,
      mappingKey: row.mappingKey,
      provenance: 'schema',
      classSource: 'schema',
      schemaRow: true
    });
  }

  for (const entry of classes) {
    if (entry.schemaBacked || entry.dynamic) continue;
    features.push({
      class: entry.name,
      subclass: entry.name,
      provenance: 'runtime',
      classSource: 'runtime',
      schemaRow: false
    });
  }

  for (const [name, values] of Object.entries(dynamicFamilies)) {
    for (const value of values) {
      features.push({
        class: name,
        subclass: value,
        provenance: 'dynamic',
        classSource: 'dynamic',
        schemaRow: false
      });
    }
  }

  features.sort((a, b) => {
    const byClass = a.class.localeCompare(b.class);
    if (byClass !== 0) return byClass;
    const bySubclass = a.subclass.localeCompare(b.subclass);
    if (bySubclass !== 0) return bySubclass;
    return a.provenance.localeCompare(b.provenance);
  });

  const resolvedFeatures = features.map((feature) => {
    const filterFeature = { class: feature.class, subclass: feature.subclass, $type: 'Point' };
    const matchingLayers = layers.filter((layer) => evaluateFilter(layer.filter, filterFeature));
    let selectedLayer = null;
    let icon = null;
    let fallback = null;

    for (const layer of matchingLayers) {
      if (layer.textOnly) continue;
      const candidate = resolveIconImageWithFallback(layer.iconImage, feature, spriteNames);
      if (candidate && candidate.icon) {
        selectedLayer = layer;
        icon = candidate.icon;
        fallback = candidate.fallback;
        break;
      }
    }

    let status = 'no-layer';
    if (icon) {
      status = 'resolved';
    } else if (matchingLayers.some((layer) => layer.textOnly)) {
      status = 'text-only';
    }

    return {
      ...feature,
      status,
      layerId: selectedLayer ? selectedLayer.id : null,
      layerOrder: selectedLayer ? selectedLayer.order : null,
      styleLayers: matchingLayers.map((layer) => layer.id),
      matchingLayerIds: matchingLayers.map((layer) => layer.id).sort(),
      icon,
      fallback
    };
  });

  const selectedNames = Array.from(
    new Set(resolvedFeatures.filter((feature) => feature.icon).map((feature) => feature.icon))
  ).sort();

  const svgFiles = fs
    .readdirSync(iconsDirectory)
    .filter((file) => file.toLowerCase().endsWith('.svg'))
    .sort();
  const iconAnalysis = new Map();

  for (const file of svgFiles) {
    const name = file.slice(0, -4);
    const svg = fs.readFileSync(path.join(iconsDirectory, file), 'utf8');
    iconAnalysis.set(name, analyseSvg(svg, name));
  }

  const roles = palette.roles
    .map((role) => ({
      ...role,
      color: normaliseColour(role.color),
      sourceColors: (role.sourceColors || []).map(normaliseColour).filter(Boolean),
      iconCount: 0,
      icons: []
    }))
    .sort((a, b) => a.order - b.order);

  const roleById = new Map(roles.map((role) => [role.id, role]));
  const roleBySourceColour = new Map();
  const colourOwners = new Map();
  const overrideMap = new Map(Object.entries(palette.overrides || {}));

  for (const role of roles) {
    const colours = Array.from(new Set([role.color, ...role.sourceColors].filter(Boolean)));
    for (const colour of colours) {
      if (colourOwners.has(colour)) {
        addIssue(
          'error',
          'duplicate-role-hex',
          `Colour ${colour} is assigned to both ${colourOwners.get(colour)} and ${role.id}`,
          { colour, roles: [colourOwners.get(colour), role.id] }
        );
      } else {
        colourOwners.set(colour, role.id);
      }
    }
    for (const colour of role.sourceColors) {
      if (!roleBySourceColour.has(colour)) roleBySourceColour.set(colour, role);
    }
  }

  const selectedNameSet = new Set(selectedNames);
  const icons = Array.from(iconAnalysis.values())
    .map((analysis) => {
      let role = null;
      if (analysis.primaryFill && roleBySourceColour.has(analysis.primaryFill)) {
        role = roleBySourceColour.get(analysis.primaryFill);
      }
      if (overrideMap.has(analysis.name)) {
        const overrideRole = roleById.get(overrideMap.get(analysis.name));
        if (overrideRole) role = overrideRole;
      }
      return {
        ...analysis,
        referenced: selectedNameSet.has(analysis.name),
        inSprite: spriteNames.has(analysis.name),
        roleId: role ? role.id : null,
        roleColour: role ? role.color : null,
        roleSourceMatch: role ? role.sourceColors.includes(analysis.primaryFill) : null
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const iconByName = new Map(icons.map((icon) => [icon.name, icon]));
  const selectedIcons = [];

  for (const name of selectedNames) {
    const existing = iconByName.get(name);
    selectedIcons.push(
      existing || {
        name,
        exists: false,
        primaryFill: null,
        distinctFills: [],
        nonWhiteFills: [],
        strokes: [],
        strokeOnly: false,
        pattern: false,
        unparseable: false,
        fillCount: 0,
        referenced: true,
        inSprite: spriteNames.has(name),
        roleId: null,
        roleColour: null,
        roleSourceMatch: null
      }
    );
  }

  const poiIcons = selectedIcons
    .filter((icon) => icon.inSprite)
    .map((icon) => icon)
    .sort((a, b) => a.name.localeCompare(b.name));

  const rows = resolvedFeatures.map((feature) => {
    const analysis = feature.icon ? iconByName.get(feature.icon) : null;
    return {
      ...feature,
      inSprite: feature.icon ? spriteNames.has(feature.icon) : false,
      roleId: analysis ? analysis.roleId : null
    };
  });

  const classByName = new Map(classes.map((entry) => [entry.name, entry]));
  for (const entry of classes) {
    const classRows = rows.filter((row) => row.class === entry.name);
    entry.featureCount = classRows.length;
    entry.iconCapable = classRows.some((row) => row.status === 'resolved');
  }
  for (const entry of phantoms) entry.featureCount = 0;

  for (const phantom of phantoms) {
    const reason =
      phantom.reason === 'schema-subclass'
        ? `is already a subclass of ${phantom.schemaClass}`
        : 'does not appear in any mapping value list';
    addIssue(
      'warning',
      'phantom-class-literal',
      `Style class literal ${phantom.name} ${reason} and is not a feature`,
      { class: phantom.name, reason: phantom.reason }
    );
  }

  const missingSpriteNames = selectedIcons
    .filter((icon) => !icon.inSprite)
    .map((icon) => icon.name)
    .sort();

  if (missingSpriteNames.length) {
    addIssue(
      'warning',
      'missing-sprite',
      `${missingSpriteNames.length} POI icon names are absent from sprite.json`,
      { count: missingSpriteNames.length, icons: missingSpriteNames }
    );
  }

  for (const icon of selectedIcons) {
    if (icon.inSprite && !icon.exists) {
      addIssue('warning', 'missing-svg', `Sprite icon ${icon.name} has no source SVG`, {
        icon: icon.name
      });
    }
  }

  for (const icon of poiIcons) {
    if (icon.exists && icon.pattern) {
      addIssue(
        'warning',
        'icon-pattern-fill',
        `POI icon ${icon.name} uses a pattern fill and cannot be resolved to a single colour`,
        { icon: icon.name }
      );
    }
    if (icon.exists && !icon.pattern && !icon.primaryFill) {
      addIssue('error', 'icon-no-primary-fill', `Icon ${icon.name} has no resolvable primary fill`, {
        icon: icon.name
      });
    }
    if (icon.exists && icon.primaryFill && !icon.roleId) {
      addIssue(
        'error',
        'poi-icon-no-role',
        `POI icon ${icon.name} has primary fill ${icon.primaryFill} with no palette role`,
        { icon: icon.name, colour: icon.primaryFill }
      );
    }
  }

  for (const role of roles) {
    role.icons = [];
    role.iconCount = 0;
  }

  for (const icon of poiIcons) {
    if (!icon.roleId) continue;
    const role = roleById.get(icon.roleId);
    role.icons.push(icon.name);
    role.iconCount += 1;
    if (icon.roleSourceMatch === false) {
      addIssue(
        'warning',
        'icon-role-colour-mismatch',
        `Icon ${icon.name} resolves to ${role.id} by override but its fill is ${icon.primaryFill}`,
        { icon: icon.name, role: role.id, colour: icon.primaryFill }
      );
    }
  }

  for (const role of roles) {
    role.icons.sort();
    if (role.iconCount === 0) {
      addIssue('warning', 'role-colour-unused', `Role ${role.id} is not used by any POI icon`, {
        role: role.id
      });
    }
  }

  for (const icon of icons) {
    if (icon.pattern) {
      addIssue(
        'warning',
        'icon-pattern-fill',
        `Icon ${icon.name} uses a pattern fill and cannot be resolved to a single colour`,
        { icon: icon.name }
      );
    }
  }

  const textOnlyLayers = layers.filter((layer) => layer.textOnly);
  for (const layer of textOnlyLayers) {
    addIssue('info', 'text-only-layer', `Layer ${layer.id} has no icon-image`, {
      layer: layer.id
    });
  }

  for (const row of rows) {
    if (row.status === 'no-layer') {
      addIssue(
        'info',
        'row-no-layer',
        `No POI layer matches ${row.class}/${row.subclass}`,
        { class: row.class, subclass: row.subclass, provenance: row.provenance }
      );
    }
  }

  const schemaRows = rows.filter((row) => row.provenance === 'schema');
  const schemaSelectedNames = Array.from(
    new Set(schemaRows.filter((row) => row.icon).map((row) => row.icon))
  ).sort();
  const schemaExisting = schemaSelectedNames.filter((name) => spriteNames.has(name)).length;

  const hardErrorCount = issues.filter((issue) => issue.level === 'error').length;
  const warningCount = issues.filter((issue) => issue.level === 'warning').length;
  const infoCount = issues.filter((issue) => issue.level === 'info').length;

  const roleCounts = {};
  for (const role of roles) roleCounts[role.id] = role.iconCount;

  const summary = {
    classes: classes.length,
    schemaClasses: classes.filter((entry) => entry.schemaBacked).length,
    runtimeClasses: classes.filter((entry) => entry.runtime).length,
    dynamicClasses: classes.filter((entry) => entry.dynamic).length,
    phantomClasses: phantoms.length,
    iconCapableClasses: classes.filter((entry) => entry.iconCapable).length,
    features: rows.length,
    featureProvenance: {
      schema: rows.filter((row) => row.provenance === 'schema').length,
      runtime: rows.filter((row) => row.provenance === 'runtime').length,
      dynamic: rows.filter((row) => row.provenance === 'dynamic').length
    },
    layers: layers.length,
    iconLayers: layers.filter((layer) => !layer.textOnly).length,
    textOnlyLayers: textOnlyLayers.length,
    resolved: rows.filter((row) => row.status === 'resolved').length,
    textOnly: rows.filter((row) => row.status === 'text-only').length,
    noLayer: rows.filter((row) => row.status === 'no-layer').length,
    candidates: selectedNames.length,
    icons: poiIcons.length,
    existingIcons: poiIcons.length,
    missingSprite: missingSpriteNames.length,
    spriteIcons: spriteNames.size,
    svgIcons: icons.length,
    roles: roles.length,
    roleCounts,
    issues: issues.length,
    errors: hardErrorCount,
    warnings: warningCount,
    infos: infoCount,
    schema: {
      classes: catalogue.classes.length,
      rows: catalogue.rows.length,
      resolved: schemaRows.filter((row) => row.status === 'resolved').length,
      textOnly: schemaRows.filter((row) => row.status === 'text-only').length,
      noLayer: schemaRows.filter((row) => row.status === 'no-layer').length,
      icons: schemaExisting,
      selectedNames: schemaSelectedNames.length,
      missingSprite: schemaSelectedNames.length - schemaExisting
    }
  };

  issues.sort((a, b) => issueSortKey(a).localeCompare(issueSortKey(b)));

  return {
    root,
    palette,
    classes,
    phantoms,
    rows,
    layers,
    icons,
    selectedIcons,
    poiIcons,
    roles,
    mappings,
    summary,
    issues
  };
}

module.exports = {
  buildModel,
  classifyPaint,
  parseAttributes,
  parseStyleAttribute,
  parsePoiCatalogue,
  parsePoiMappings,
  extractClassLiterals,
  evaluateFilter,
  resolveIconImage,
  resolveIconImageWithFallback,
  analyseSvg,
  normaliseColour
};
