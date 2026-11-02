// Icon coverage: every category and supply name in the synthetic data and sample fixtures must
// resolve to a drawing of its own, not the generic "Unsorted supplies" box. Run on its own with
// `npm run icons` to see the list of gaps. Real inventory is never read here.
import { matchItem } from './productIcons';
import { ICON_IDS } from './productIcons/sprite';

const { TYPES } = require('../scripts/synthetic-inventory');
const sample = require('../../sample_inventory.json');

const rows = [
  ...Object.entries(TYPES).flatMap(([sub, names]) => names.map((name) => ({ Name: name, Subcategory: sub, source: 'synthetic' }))),
  ...sample.map((r) => ({ Name: r.Name, Subcategory: r.Subcategory || '', source: 'sample_inventory.json' })),
];

describe('icon coverage', () => {
  test('every synthetic and sample supply has a specific drawing', () => {
    const gaps = rows
      .map((r) => ({ r, hit: matchItem(r) }))
      .filter(({ hit }) => hit.via === 'fallback')
      .map(({ r }) => `${r.source}: "${r.Name}" (${r.Subcategory || 'no subcategory'})`);
    if (gaps.length) console.log(`No icon in the sprite mapping for:\n  ${gaps.join('\n  ')}`);
    expect(gaps).toEqual([]);
  });

  test('every drawing the mapping can return exists in the sprite', () => {
    for (const r of rows) expect(ICON_IDS).toContain(matchItem(r).icon);
  });
});
