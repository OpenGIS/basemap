'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  buildModel,
  classifyPaint,
  parseAttributes,
  parseStyleAttribute,
  normaliseColour
} = require('./palette');

const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');

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

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isSamePath(left, right) {
  return path.relative(left, right) === '' && path.relative(right, left) === '';
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function canonicalisePath(inputPath) {
  const resolved = path.resolve(inputPath);

  try {
    return fs.realpathSync.native(resolved);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  }

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

function assertSafeOutputPath({ root = DEFAULT_ROOT, outDir } = {}) {
  if (!outDir) throw new Error('An output directory is required');

  const canonicalRoot = fs.realpathSync.native(path.resolve(root));
  const canonicalOutDir = canonicalisePath(outDir);
  const sourceDir = canonicalisePath(
    path.join(canonicalRoot, 'vendor', 'openmaptiles', 'style', 'icons')
  );
  const lexicalAllowedRoots = [
    path.join(canonicalRoot, 'build'),
    path.join(canonicalRoot, '.opencode', 'tmp')
  ];

  const unsafe = (reason) => {
    throw new Error(`Refusing to write palette icons to ${outDir}: ${reason}`);
  };

  const allowedRoots = lexicalAllowedRoots.map((allowedPath) => {
    const canonical = canonicalisePath(allowedPath);
    if (!isSamePath(canonical, path.resolve(allowedPath))) {
      unsafe(`allowed output root ${allowedPath} resolves through a symlink or case alias`);
    }
    return canonical;
  });

  if (isSamePath(canonicalOutDir, canonicalRoot)) unsafe('it is the repository root');
  if (isInside(canonicalRoot, canonicalOutDir)) unsafe('it is an ancestor of the repository root');

  if (isSamePath(canonicalOutDir, sourceDir)) unsafe('it is the vendor icon source directory');
  if (isInside(canonicalOutDir, sourceDir)) unsafe('it is inside the vendor icon source directory');
  if (isInside(sourceDir, canonicalOutDir)) unsafe('it is an ancestor of the vendor icon source directory');

  for (const allowedRoot of allowedRoots) {
    if (isSamePath(canonicalOutDir, allowedRoot)) {
      unsafe('it is an allowed output root; choose a strict subdirectory');
    }
    if (isInside(allowedRoot, canonicalOutDir)) {
      unsafe('it is an ancestor of an allowed output root');
    }
  }

  const insideAllowedRoot = allowedRoots.some((allowedRoot) =>
    isInside(canonicalOutDir, allowedRoot)
  );
  if (!insideAllowedRoot) {
    unsafe('it is outside the allowed output roots (build or .opencode/tmp)');
  }

  const requestedOutDir = path.resolve(outDir);
  const relativeOutDir = path.relative(canonicalRoot, requestedOutDir);
  if (
    relativeOutDir === '' ||
    relativeOutDir === '..' ||
    relativeOutDir.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeOutDir)
  ) {
    unsafe('it is not lexically inside the repository root');
  }

  let current = canonicalRoot;
  for (const segment of relativeOutDir.split(path.sep)) {
    if (!segment) continue;
    current = path.join(current, segment);
    let stats;
    try {
      stats = fs.lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      unsafe(`path component ${current} is a symlink`);
    }
    if (!stats.isDirectory()) {
      unsafe(`path component ${current} is not a directory`);
    }
  }

  return {
    root: canonicalRoot,
    sourceDir,
    outDir: canonicalOutDir,
    allowedRoots
  };
}

function prepareOutputDir({ root = DEFAULT_ROOT, outDir } = {}) {
  if (!outDir) throw new Error('An output directory is required');

  const paths = assertSafeOutputPath({ root, outDir });
  const targetDir = paths.outDir;
  let stats = null;

  try {
    stats = fs.lstatSync(targetDir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (!stats) {
    fs.mkdirSync(targetDir, { recursive: true });
    assertSafeOutputPath({ root, outDir });
    stats = fs.lstatSync(targetDir);
  }

  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Refusing to prepare ${outDir}: output path is not a regular directory`);
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      throw new Error(`Refusing to clean ${outDir}: subdirectory ${entry.name} is present`);
    }
    if (entry.isFile() && !entry.name.endsWith('.svg')) {
      throw new Error(`Refusing to clean ${outDir}: non-SVG file ${entry.name} is present`);
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      throw new Error(`Refusing to clean ${outDir}: unsupported entry ${entry.name} is present`);
    }
  }

  for (const entry of entries) {
    if (entry.name.endsWith('.svg')) {
      fs.unlinkSync(path.join(targetDir, entry.name));
    }
  }

  return targetDir;
}

function replaceAttributeValue(tag, name, value) {
  const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(["'])([\\s\\S]*?)\\2`, 'i');
  return tag.replace(pattern, (_, prefix, quote) => `${prefix}${quote}${value}${quote}`);
}

function replaceStyleFill(style, target) {
  return String(style)
    .split(';')
    .map((declaration) => {
      const index = declaration.indexOf(':');
      if (index === -1) return declaration;
      const property = declaration.slice(0, index).trim().toLowerCase();
      if (property !== 'fill') return declaration;
      return `${declaration.slice(0, index + 1)}${target}`;
    })
    .join(';');
}

function addFillAttribute(tag, target) {
  if (/\/\s*>$/.test(tag)) {
    return tag.replace(/\s*\/\s*>$/, ` fill="${target}"/>`);
  }
  return tag.replace(/>$/, ` fill="${target}">`);
}

function recolourSvg(svg, { primary, target, preserve }) {
  const primaryColour = normaliseColour(primary);
  const targetColour = normaliseColour(target);
  if (!primaryColour || !targetColour) return svg;
  if (preserve.has(primaryColour)) return svg;

  const tagPattern = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][A-Za-z0-9:_-]*)([^>]*?)(\/?)>/g;
  const stack = [];
  let skipDepth = 0;

  return String(svg).replace(
    tagPattern,
    (full, closing, tagName, attributeText, selfClosing) => {
      if (full.startsWith('<!--')) return full;

      const tag = tagName.toLowerCase();

      if (closing) {
        if (stack.length) stack.pop();
        if (SKIP_CONTAINERS.has(tag) && skipDepth > 0) skipDepth -= 1;
        return full;
      }

      const attributes = parseAttributes(attributeText || '');
      const style = parseStyleAttribute(attributes.style);
      const ownFill = classifyPaint(
        hasOwn(style, 'fill') ? style.fill : attributes.fill
      );
      const ownStroke = classifyPaint(
        hasOwn(style, 'stroke') ? style.stroke : attributes.stroke
      );
      const parent = stack.length
        ? stack[stack.length - 1]
        : { fill: { kind: 'inherit' }, stroke: { kind: 'inherit' } };
      const inheritedFill = ownFill.kind === 'inherit' ? parent.fill : ownFill;
      const inheritedStroke = ownStroke.kind === 'inherit' ? parent.stroke : ownStroke;

      if (SKIP_CONTAINERS.has(tag)) skipDepth += 1;
      const insideSkippedContainer = skipDepth > 0;
      let updated = full;

      if (!insideSkippedContainer && SHAPE_TAGS.has(tag)) {
        let effectiveFill = null;
        if (inheritedFill.kind === 'colour') {
          effectiveFill = inheritedFill.value;
        } else if (inheritedFill.kind === 'inherit' && inheritedStroke.kind === 'inherit') {
          effectiveFill = '#000000';
        }

        if (effectiveFill === primaryColour && !preserve.has(effectiveFill)) {
          if (hasOwn(style, 'fill')) {
            const newStyle = replaceStyleFill(attributes.style, targetColour);
            updated = replaceAttributeValue(updated, 'style', newStyle);
          } else if (hasOwn(attributes, 'fill')) {
            updated = replaceAttributeValue(updated, 'fill', targetColour);
          } else {
            updated = addFillAttribute(updated, targetColour);
          }
        }
      }

      if (!selfClosing) {
        stack.push({ fill: inheritedFill, stroke: inheritedStroke });
      } else if (SKIP_CONTAINERS.has(tag) && skipDepth > 0) {
        skipDepth -= 1;
      }

      return updated;
    }
  );
}

function selectRecolourIcons(model) {
  return model.selectedIcons
    .filter((icon) => icon.exists)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function validateRecolourInputs(model, palette) {
  const roleById = new Map(model.roles.map((role) => [role.id, role]));
  const overrides = palette.overrides || {};
  const sourceOwners = new Map();
  const selectedIcons = selectRecolourIcons(model);
  const selectedNames = new Set(selectedIcons.map((icon) => icon.name));

  for (const [iconName, roleId] of Object.entries(overrides)) {
    if (!selectedNames.has(iconName)) {
      throw new Error(
        `Palette override for ${iconName} is not a selected POI icon with a source SVG`
      );
    }
    if (!roleById.has(roleId)) {
      throw new Error(`Palette override for ${iconName} references unknown role ${roleId}`);
    }
  }

  for (const role of model.roles) {
    for (const colour of role.sourceColors) {
      if (sourceOwners.has(colour) && sourceOwners.get(colour) !== role.id) {
        throw new Error(
          `Source colour ${colour} is assigned to both ${sourceOwners.get(colour)} and ${role.id}`
        );
      }
      sourceOwners.set(colour, role.id);
    }
  }

  for (const icon of selectedIcons) {
    if (!icon.primaryFill || icon.pattern || icon.strokeOnly) {
      throw new Error(`POI icon ${icon.name} has no usable primary fill`);
    }
    const roleId = overrides[icon.name] || icon.roleId;
    if (!roleId) {
      throw new Error(`POI icon ${icon.name} has no resolvable palette role`);
    }
    const role = roleById.get(roleId);
    if (!role) {
      throw new Error(`POI icon ${icon.name} references unknown role ${roleId}`);
    }
    if (!role.color) {
      throw new Error(`Role ${role.id} has no valid target colour`);
    }
  }

  return { roleById, selectedIcons };
}

function recolourIcons({ root = DEFAULT_ROOT, palette, outDir } = {}) {
  if (!outDir) throw new Error('An output directory is required');

  const paths = assertSafeOutputPath({ root, outDir });
  const resolvedRoot = paths.root;
  const sourceDirectory = paths.sourceDir;
  let resolvedOutDir = paths.outDir;

  const model = buildModel({ root: resolvedRoot, palette });
  const modelErrors = model.issues.filter((issue) => issue.level === 'error');
  if (modelErrors.length) {
    const details = modelErrors.map((issue) => `${issue.code}: ${issue.message}`).join('; ');
    throw new Error(`Palette model has ${modelErrors.length} hard error(s): ${details}`);
  }

  const paletteConfig = palette || model.palette;
  const { roleById, selectedIcons } = validateRecolourInputs(model, paletteConfig);
  const overrides = paletteConfig.overrides || {};
  const preserve = new Set(
    (paletteConfig.preserve || []).map((colour) => normaliseColour(colour)).filter(Boolean)
  );
  const selectedByName = new Map(selectedIcons.map((icon) => [icon.name, icon]));

  resolvedOutDir = prepareOutputDir({ root: resolvedRoot, outDir });

  const files = fs
    .readdirSync(sourceDirectory)
    .filter((file) => file.toLowerCase().endsWith('.svg'))
    .sort();
  const recoloured = [];
  const unchanged = [];

  for (const file of files) {
    const name = file.slice(0, -4);
    const sourcePath = path.join(sourceDirectory, file);
    const targetPath = path.join(resolvedOutDir, file);
    const original = fs.readFileSync(sourcePath);
    const icon = selectedByName.get(name);

    if (!icon) {
      fs.writeFileSync(targetPath, original);
      unchanged.push(name);
      continue;
    }

    const roleId = overrides[name] || icon.roleId;
    const role = roleById.get(roleId);
    const primary = normaliseColour(icon.primaryFill);
    const target = normaliseColour(role.color);

    if (!primary || preserve.has(primary) || primary === target) {
      fs.writeFileSync(targetPath, original);
      unchanged.push(name);
      continue;
    }

    const updated = recolourSvg(original.toString('utf8'), {
      primary,
      target,
      preserve
    });
    fs.writeFileSync(targetPath, Buffer.from(updated, 'utf8'));
    recoloured.push(name);
  }

  return {
    outDir: resolvedOutDir,
    sourceDir: sourceDirectory,
    files: files.length,
    recoloured,
    unchanged,
    model
  };
}

module.exports = {
  recolourIcons,
  recolourSvg,
  prepareOutputDir,
  selectRecolourIcons,
  validateRecolourInputs,
  assertSafeOutputPath
};
