'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collectTextFonts, distinctTextFonts } = require('./merge-fonts');

function styleWithStacks(stacks) {
  return {
    layers: stacks.map((fonts, index) => ({
      id: `layer-${index}`,
      type: 'symbol',
      layout: { 'text-font': fonts }
    }))
  };
}

test('distinctTextFonts returns the stacks present in one style', () => {
  const style = styleWithStacks([
    ['Noto Sans Regular'],
    ['Noto Sans Regular'],
    ['Noto Sans Regular', 'Noto Sans Bold']
  ]);

  assert.deepEqual(distinctTextFonts(style), [
    ['Noto Sans Regular'],
    ['Noto Sans Regular'],
    ['Noto Sans Regular', 'Noto Sans Bold']
  ]);
});

test('collectTextFonts unions both styles and removes duplicates', () => {
  const dark = styleWithStacks([
    ['Noto Sans Regular', 'Noto Sans Bold'],
    ['Noto Sans Regular']
  ]);
  const light = styleWithStacks([
    ['Noto Sans Regular'],
    ['Noto Sans Italic', 'Noto Sans Regular']
  ]);

  assert.deepEqual(collectTextFonts([dark, light]), [
    ['Noto Sans Italic', 'Noto Sans Regular'],
    ['Noto Sans Regular'],
    ['Noto Sans Regular', 'Noto Sans Bold']
  ]);
});

test('collectTextFonts ignores layers without text-font arrays', () => {
  const style = {
    layers: [
      { id: 'background', type: 'background' },
      { id: 'symbol', type: 'symbol', layout: {} },
      { id: 'text', type: 'symbol', layout: { 'text-font': ['Noto Sans Regular'] } }
    ]
  };

  assert.deepEqual(collectTextFonts([style]), [['Noto Sans Regular']]);
});
