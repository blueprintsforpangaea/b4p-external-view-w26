import { buildIndex, distance, suggest } from './suggest';

const index = buildIndex(
  ['Nitrile exam gloves', 'Sterile gloves size 7', '10 mL syringe', 'Syringe filter', 'Insulin syringe 1 mL', 'Glove box liner', 'Gauze pads 4x4', 'nitrile EXAM gloves'],
  ['Gloves', 'Needles & Syringes', 'Wound Care'],
);
const labels = (q) => suggest(q, index).map((s) => s.label);

test('starts-with first (categories ahead of supplies), then word starts, then anywhere', () => {
  expect(labels('glo')).toEqual(['Gloves', 'Glove box liner', 'Nitrile exam gloves', 'Sterile gloves size 7']);
  expect(labels('syr')[0]).toBe('Syringe filter');
  expect(labels('ringe')).toEqual(expect.arrayContaining(['10 mL syringe', 'Syringe filter']));
});

test('close spellings still find it', () => {
  expect(labels('glvoes')).toContain('Gloves');
  expect(labels('syrnge')).toEqual(expect.arrayContaining(['Syringe filter', '10 mL syringe']));
  expect(labels('gauz')).toContain('Gauze pads 4x4');
  expect(labels('xyzzy')).toEqual([]);
});

test('the bold part is where it matched', () => {
  const [first] = suggest('exam', index);
  expect(first.label.slice(first.start, first.end)).toBe('exam');
  const fuzzy = suggest('glvoes', index).find((s) => s.label === 'Gloves');
  expect(fuzzy.label.slice(fuzzy.start, fuzzy.end)).toBe('Gloves');
});

test('names that differ only in case appear once; at most 8; empty query gives none', () => {
  expect(labels('nitrile')).toEqual(['Nitrile exam gloves']);
  expect(suggest('e', index, 8).length).toBeLessThanOrEqual(8);
  expect(labels('  ')).toEqual([]);
});

test('distance counts a swap as one edit and gives up early', () => {
  expect(distance('glvoes', 'gloves', 2)).toBe(1);
  expect(distance('abc', 'xyz', 1)).toBe(2);
});
