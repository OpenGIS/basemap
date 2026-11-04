'use strict';

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTION_PATTERN = /^(rgb|rgba|hsl|hsla)\(([\s\S]*)\)$/i;
const ALPHA_PRECISION = 1000;

function fail(value) {
  throw new TypeError(`Invalid colour: ${JSON.stringify(value)}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundChannel(value) {
  return clamp(Math.round(value + 1e-9), 0, 255);
}

function roundAlpha(value) {
  return clamp(Math.round(value * ALPHA_PRECISION) / ALPHA_PRECISION, 0, 1);
}

function makeColour(r, g, b, a = 1) {
  return {
    r: roundChannel(r),
    g: roundChannel(g),
    b: roundChannel(b),
    a: roundAlpha(a)
  };
}

function parseHex(hex) {
  const digits = hex.replace(/^#/, '').toLowerCase();
  const expanded =
    digits.length <= 4
      ? digits
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : digits;

  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);
  const a = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1;

  return makeColour(r, g, b, a);
}

function parseNumberComponent(component, label) {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(%?)$/.exec(component);
  if (!match) fail(`${label} component ${JSON.stringify(component)} is not a number`);
  return { value: Number(match[1]), percent: match[2] === '%' };
}

function parseRgbComponent(component, label) {
  const { value, percent } = parseNumberComponent(component, label);
  const channel = percent ? (value / 100) * 255 : value;
  if (!Number.isFinite(channel) || channel < 0 || channel > 255) {
    fail(`${label} component ${JSON.stringify(component)} is out of range`);
  }
  return channel;
}

function parsePercentage(component, label) {
  const { value, percent } = parseNumberComponent(component, label);
  if (!percent) fail(`${label} component ${JSON.stringify(component)} must be a percentage`);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    fail(`${label} component ${JSON.stringify(component)} is out of range`);
  }
  return value;
}

function parseAlphaComponent(component) {
  const { value, percent } = parseNumberComponent(component, 'Alpha');
  const alpha = percent ? value / 100 : value;
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    fail(`Alpha component ${JSON.stringify(component)} is out of range`);
  }
  return alpha;
}

function splitFunctionBody(body) {
  const slash = body.split('/');
  if (slash.length > 2) fail(`Function body ${JSON.stringify(body)} has too many alpha separators`);

  const main = slash[0].trim().replace(/,/g, ' ').trim();
  const components = main.split(/\s+/).filter(Boolean);
  const explicitAlpha = slash.length === 2 ? slash[1].trim() : null;

  if (!components.length) fail('Function body is empty');
  if (explicitAlpha === '') fail('Function body has an empty alpha component');
  if (components.length > 4) fail('Function body has too many components');

  let alpha = explicitAlpha;
  if (alpha === null && components.length === 4) alpha = components.pop();

  return { components, alpha };
}

function hueToRgb(p, q, t) {
  let hue = t;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

function hslToRgb(hue, saturation, lightness) {
  const h = (((hue % 360) + 360) % 360) / 360;
  const s = saturation / 100;
  const l = lightness / 100;

  if (s === 0) return [l * 255, l * 255, l * 255];

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return [
    hueToRgb(p, q, h + 1 / 3) * 255,
    hueToRgb(p, q, h) * 255,
    hueToRgb(p, q, h - 1 / 3) * 255
  ];
}

function parseFunction(name, body) {
  const { components, alpha } = splitFunctionBody(body);
  if (components.length !== 3) fail(`${name}() needs three colour components`);

  const parsedAlpha = alpha === null ? 1 : parseAlphaComponent(alpha);

  if (name === 'rgb' || name === 'rgba') {
    return makeColour(
      parseRgbComponent(components[0], 'Red'),
      parseRgbComponent(components[1], 'Green'),
      parseRgbComponent(components[2], 'Blue'),
      parsedAlpha
    );
  }

  const hue = parseNumberComponent(components[0], 'Hue');
  const hueValue = hue.percent ? (hue.value / 100) * 360 : hue.value;
  const [r, g, b] = hslToRgb(
    hueValue,
    parsePercentage(components[1], 'Saturation'),
    parsePercentage(components[2], 'Lightness')
  );

  return makeColour(r, g, b, parsedAlpha);
}

function parseColour(value) {
  if (isPlainObject(value) && ['r', 'g', 'b'].every((key) => key in value)) {
    return makeColour(value.r, value.g, value.b, value.a === undefined ? 1 : value.a);
  }

  if (typeof value !== 'string') fail(value);

  const text = value.trim();
  if (!text) fail(value);
  if (/^transparent$/i.test(text)) return makeColour(0, 0, 0, 0);

  if (HEX_PATTERN.test(text)) return parseHex(text);

  const match = FUNCTION_PATTERN.exec(text);
  if (!match) fail(value);

  return parseFunction(match[1].toLowerCase(), match[2].trim());
}

function tryParseColour(value) {
  try {
    return parseColour(value);
  } catch {
    return null;
  }
}

function formatAlpha(alpha) {
  return String(roundAlpha(alpha));
}

function canonicalColour(value) {
  const colour = parseColour(value);
  return `rgba(${colour.r}, ${colour.g}, ${colour.b}, ${formatAlpha(colour.a)})`;
}

function formatColour(value) {
  const colour = parseColour(value);

  if (colour.a === 1) {
    return `#${[colour.r, colour.g, colour.b]
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')}`;
  }

  return `rgba(${colour.r}, ${colour.g}, ${colour.b}, ${formatAlpha(colour.a)})`;
}

function compositeColour(foreground, background) {
  const front = parseColour(foreground);
  const back = parseColour(background);
  const alpha = front.a + back.a * (1 - front.a);

  if (alpha === 0) return makeColour(0, 0, 0, 0);

  const blend = (frontChannel, backChannel) =>
    (frontChannel * front.a + backChannel * back.a * (1 - front.a)) / alpha;

  return makeColour(blend(front.r, back.r), blend(front.g, back.g), blend(front.b, back.b), alpha);
}

function linearChannel(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(value, background) {
  const colour = background === undefined ? parseColour(value) : compositeColour(value, background);
  return (
    0.2126 * linearChannel(colour.r) +
    0.7152 * linearChannel(colour.g) +
    0.0722 * linearChannel(colour.b)
  );
}

function contrastRatio(foreground, background) {
  const back = parseColour(background);
  const front = compositeColour(foreground, back);
  const lighter = Math.max(relativeLuminance(front), relativeLuminance(back));
  const darker = Math.min(relativeLuminance(front), relativeLuminance(back));
  return (lighter + 0.05) / (darker + 0.05);
}

module.exports = {
  parseColour,
  tryParseColour,
  canonicalColour,
  formatColour,
  compositeColour,
  relativeLuminance,
  contrastRatio
};
