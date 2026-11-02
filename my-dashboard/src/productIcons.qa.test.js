// QA checks for the product line drawings (icon-designer keeps their own tests in
// src/productIcons/mapping.test.js). Real inventory never lives in the repo: the
// full-coverage test runs only when QA_SUPPLIES_JSON points at a local snapshot.
import { iconFor, iconForSubcategory, matchItem, typeLabelFor } from './productIcons';
import { ICON_IDS, ICONS, SPRITE } from './productIcons/sprite';
import { normalizeInventory } from './inventory';

const SUBCATEGORIES = [
  'Needles & Syringes', 'IV Supplies', 'Misc Surgical', 'Misc Non-Medical', 'Wound Care & Bandages',
  'Catheters & Briefs', 'Vitals & Home Health', 'Airway & Oxygen', 'Gloves', 'Masks & Face Shields',
  'Apparel (Gowns, Shoe Covers, etc.)', 'Sutures',
];
const valid = (id) => ICON_IDS.includes(id);

describe('sprite', () => {
  test('every id has markup and a matching <symbol>, ids are unique', () => {
    expect(ICON_IDS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(ICON_IDS).size).toBe(ICON_IDS.length);
    for (const id of ICON_IDS) {
      expect(ICONS[id]).toMatch(/<(path|rect|circle|ellipse|line|polyline|polygon|g|use)\b/);
      expect(SPRITE).toContain(`<symbol id="pi-${id}" viewBox="0 0 48 48">`);
    }
    expect(SPRITE.match(/<symbol /g)).toHaveLength(ICON_IDS.length);
  });

  test('markup is inert: no scripts, handlers, external references or raster images', () => {
    expect(SPRITE).not.toMatch(/<script|<foreignObject|<image|\son[a-z]+\s*=|javascript:/i);
    const hrefs = SPRITE.match(/(?:xlink:)?href="[^"]*"/g) || [];
    for (const h of hrefs) expect(h).toMatch(/href="#pi-[\w-]+"/); // internal <use> only
  });

  test('drawings carry geometry only: no colours, fills or fonts baked in', () => {
    expect(SPRITE).not.toMatch(/\b(fill|stroke)="(?!none|currentColor)[^"]*"/);
    expect(SPRITE).not.toMatch(/<text|font-family|style=/);
  });

  test('every <use> inside the sprite points at something defined in it', () => {
    const defined = new Set([...SPRITE.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    for (const [, ref] of SPRITE.matchAll(/href="#([^"]+)"/g)) expect(defined.has(ref)).toBe(true);
  });

  test('injected sprite stays within the 12 KB gzip budget', () => {
    const { gzipSync } = require('zlib');
    expect(gzipSync(Buffer.from(SPRITE), { level: 9 }).length).toBeLessThanOrEqual(12 * 1024);
  });
});

describe('mapping never returns a blank', () => {
  test.each(SUBCATEGORIES)('subcategory %s has its own drawing', (sub) => {
    const id = iconForSubcategory(sub);
    expect(valid(id)).toBe(true);
    expect(iconFor({ subcategory: sub })).toBe(id);
  });

  test.each([
    [{}],
    [{ general: '', name: '', subcategory: '' }],
    [{ general: null, name: undefined, subcategory: null }],
    [{ General: 'zzzz', Name: 'qqqq', Subcategory: 'Not a real category' }],
    [{ name: 'Unknown' }],
    [{ general: '   ', name: '\t', subcategory: ' ' }],
    [{ general: '<script>alert(1)</script>' }],
    [{ general: '(['.repeat(50) }],
    [{ general: 'x'.repeat(10000) }],
    [{ general: 42, name: {}, subcategory: [] }],
  ])('%p resolves to a drawing and a label', (item) => {
    const hit = matchItem(item);
    expect(valid(hit.icon)).toBe(true);
    expect(typeof hit.label).toBe('string');
    expect(hit.label.trim()).not.toBe('');
    expect(['general', 'name', 'subcategory', 'fallback']).toContain(hit.via);
  });

  test('unknown subcategory falls back to the generic box', () => {
    expect(iconForSubcategory('')).toBe('box');
    expect(iconForSubcategory(undefined)).toBe('box');
    expect(iconForSubcategory('Other supplies')).toBe('box');
  });

  test('raw sheet rows and normalized items give the same answer', () => {
    const raw = { General: '10ml Syringe', Name: 'BD 10ml Syringe Luer-Lok Tip', Subcategory: 'Needles & Syringes', _sheet_row: 2 };
    const [item] = normalizeInventory([raw]);
    expect(matchItem(item)).toEqual(matchItem(raw));
    expect(iconFor(item)).toBe('syringe');
  });

  test('matching ignores case and spacing', () => {
    const a = matchItem({ general: 'Nitrile Exam Glove', subcategory: 'Gloves' });
    const b = matchItem({ general: '  NITRILE   exam glove ', subcategory: 'gloves' });
    expect(b).toEqual(a);
  });

  test('labels are plural sentence case', () => {
    const labels = new Set(SUBCATEGORIES.map((s) => typeLabelFor({ subcategory: s })));
    for (const l of labels) {
      expect(l.charAt(0)).toBe(l.charAt(0).toUpperCase());
      expect(l.slice(1)).toBe(l.slice(1).replace(/\b(?!IV|ECG|EKG|OR|BP|PPE|N95|CPR|KN95)[A-Z]{2,}\b/g, (w) => w.toLowerCase()));
    }
  });

  test('mapping 2,000 rows is fast', () => {
    const items = Array.from({ length: 2000 }, (_, i) => ({
      general: `thing ${i % 557}`, name: `Item ${i}`, subcategory: SUBCATEGORIES[i % 12],
    }));
    const t = performance.now();
    items.forEach((it) => iconFor(it));
    expect(performance.now() - t).toBeLessThan(200);
  });
});

const SNAPSHOT = process.env.QA_SUPPLIES_JSON;
(SNAPSHOT ? describe : describe.skip)('live snapshot coverage (local only)', () => {
  const rows = SNAPSHOT ? JSON.parse(require('fs').readFileSync(SNAPSHOT, 'utf8')) : [];
  const items = normalizeInventory(rows);

  test('every row, General value and subcategory resolves to a real drawing', () => {
    expect(items.every((i) => valid(iconFor(i)))).toBe(true);
    const generals = [...new Set(rows.map((r) => (r.General || '').trim().toLowerCase()).filter(Boolean))];
    expect(generals.every((g) => valid(iconFor({ general: g })))).toBe(true);
  });

  test('at least 90% of labelled rows match a specific rule', () => {
    const labelled = items.filter((i) => !i.unlabelled);
    const specific = labelled.filter((i) => ['general', 'name'].includes(matchItem(i).via));
    expect(specific.length / labelled.length).toBeGreaterThanOrEqual(0.9);
  });
});
