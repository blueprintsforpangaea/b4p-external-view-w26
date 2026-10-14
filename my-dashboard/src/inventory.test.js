import {
  allocateFefo,
  rankByRelevance,
  matchingTypes,
  baseRequestName,
  suppliesLabel,
  formatMonth,
  makerKey,
  productKey,
  slugify,
  uniqueSlugs,
  displayName,
  groupProducts,
  applyAvailability,
  applyBaseFilters,
  buildCatalog,
  nameFromNotes,
  unlabelledCount,
  badgesFor,
  canRequest,
  daysUntil,
  expiryState,
  filterAndSort,
  formatDateTime,
  formatExpiry,
  groupRequests,
  holdsFrom,
  matchesSearch,
  normalizeInventory,
  normalizeItem,
  OTHER_SUBCATEGORY,
  parseExpiry,
  parseQuantity,
  sortItems,
  statusInfo,
  statusStep,
  stockLabel,
  subcategoryCounts,
} from './inventory';

const TODAY = new Date(2026, 9, 9); // 2026-10-09, local midnight

// Shapes copied from the live /api/supplies response (2026-10-09).
const TELFA = {
  'Manufacturer Name': 'Cardinal Health',
  Category: 'ST/N',
  Subcategory: 'Wound Care & Bandages',
  General: 'non-adherent dressing',
  Name: 'SYN 62697 NON-ADHERENT PAD 3X4',
  'Lot Number': 'LOT0001',
  Notes: 'Sterile EO, expiration date 2030-11-07, MFG date 2025-11-07, quantity one',
  Quantity: '16',
  'Date of Expiration': '2030-11-07',
  'Pallet Number': '1',
  'Box Number': '4',
  Review: 'No',
  _sheet_row: 2,
};

const row = (over) => ({ ...TELFA, ...over });

describe('parseQuantity', () => {
  test.each([
    ['16', 16], [' 16 ', 16], ['1,200', 1200], ['0', 0], [7, 7],
    ['', null], [' ', null], [null, null], [undefined, null], ['-3', null], ['2.5', null], ['abc', null],
    ['1e3', null], ['0x10', null], ['20 (pens)', 20], ['5 boxes', 5], ['12(a)', 12], ['1,200 (cases)', 1200], ['2.5 kg', null],
  ])('%p -> %p', (input, expected) => {
    expect(parseQuantity(input)).toBe(expected);
  });

  test('whole number written with a decimal point (Sheets export) is a number', () => {
    expect(parseQuantity('12.0')).toBe(12);
  });
});

describe('expiry', () => {
  test.each([
    ['2030-11-07', '2030-11-07'], ['2027-1-5', '2027-01-05'], ['1/5/2027', '2027-01-05'],
    ['2030-11-07T00:00:00Z', '2030-11-07'], ['', ''], ['N/A', ''], ['2027-13-01', ''], ['13/01/2027', ''],
    [null, ''],
    ['01/2024', '2024-01-31'], ['2/2028', '2028-02-29'], ['2024-01', '2024-01-31'], ['Jan 2024', '2024-01-31'],
    ['February 2027', '2027-02-28'], ['Sept. 2026', '2026-09-30'], ['2024', '2024-12-31'], ['13/2024', ''], ['Foo 2024', ''],
  ])('parseExpiry(%p) = %p', (input, expected) => {
    expect(parseExpiry(input)).toBe(expected);
  });

  test('impossible calendar dates are rejected', () => {
    expect(parseExpiry('2027-02-30')).toBe('');
    expect(parseExpiry('2/31/2027')).toBe('');
  });

  test('daysUntil counts calendar days from today', () => {
    expect(daysUntil('2026-10-09', TODAY)).toBe(0);
    expect(daysUntil('2026-10-10', TODAY)).toBe(1);
    expect(daysUntil('2026-10-08', TODAY)).toBe(-1);
    expect(daysUntil('', TODAY)).toBeNull();
  });

  test('expiryState boundaries: yesterday expired, today and day 89 soon, day 90 fine', () => {
    expect(expiryState('2026-10-08', TODAY)).toBe('expired');
    expect(expiryState('2026-10-09', TODAY)).toBe('soon');
    expect(expiryState('2027-01-06', TODAY)).toBe('soon'); // 89 days
    expect(expiryState('2027-01-07', TODAY)).toBeNull(); // 90 days
    expect(expiryState('', TODAY)).toBeNull();
  });

  test('daysUntil is not thrown off by daylight saving time', () => {
    // US DST ends 2026-11-01; a naive ms difference would give 22.04 or 21.96 days.
    expect(daysUntil('2026-11-15', new Date(2026, 9, 24, 23, 30))).toBe(22);
  });

  test('formatExpiry is a readable date in UTC', () => {
    expect(formatExpiry('2030-11-07')).toBe('Nov 7, 2030');
    expect(formatExpiry('')).toBe('');
  });
});

describe('normalizeItem', () => {
  test('maps every live column', () => {
    const item = normalizeItem(TELFA, TODAY);
    expect(item).toMatchObject({
      id: 2,
      name: 'Syn 62697 Non-Adherent Pad 3X4', // ALL-CAPS sheet names are shown in title case
      rawName: 'SYN 62697 NON-ADHERENT PAD 3X4',
      general: 'Non-adherent dressing',
      manufacturer: 'Cardinal Health',
      category: 'ST/N',
      subcategory: 'Wound Care & Bandages',
      lot: 'LOT0001',
      quantity: 16,
      expiry: '2030-11-07',
      expiryState: null,
      pallet: '1',
      box: '4',
      needsReview: false,
    });
  });

  test('"Unknown" and blank names fall back to General, then a placeholder', () => {
    expect(normalizeItem(row({ Name: 'Unknown', General: 'gauze roll' })).name).toBe('Gauze roll');
    expect(normalizeItem(row({ Name: '  ', General: 'gauze roll' })).name).toBe('Gauze roll');
    expect(normalizeItem(row({ Name: '', General: '', Notes: '' })).name).toBe('Unnamed supply');
  });

  test('blank and whitespace subcategories go to Other', () => {
    expect(normalizeItem(row({ Subcategory: '' })).subcategory).toBe(OTHER_SUBCATEGORY);
    expect(normalizeItem(row({ Subcategory: ' ' })).subcategory).toBe(OTHER_SUBCATEGORY);
  });

  test('Review is Yes/No in the sheet, case-insensitive', () => {
    expect(normalizeItem(row({ Review: 'Yes' })).needsReview).toBe(true);
    expect(normalizeItem(row({ Review: ' yes ' })).needsReview).toBe(true);
    expect(normalizeItem(row({ Review: 'No' })).needsReview).toBe(false);
    expect(normalizeItem(row({ Review: '' })).needsReview).toBe(false);
  });

  test('missing columns never throw', () => {
    const item = normalizeItem({ _sheet_row: 9 }, TODAY);
    expect(item).toMatchObject({ id: 9, name: 'Unnamed supply', quantity: null, expiry: '' });
  });

  test('search text covers name, general, manufacturer, lot, notes, subcategory', () => {
    const item = normalizeItem(TELFA);
    for (const t of ['syn 62697', 'non-adherent', 'cardinal', 'lot0001', 'sterile', 'wound care']) {
      expect(item.searchText).toContain(t);
    }
  });
});

describe('search with units', () => {
  test('"10ml" finds "10 mL"', () => {
    const item = normalizeItem({ _sheet_row: 3, Name: 'Syringe 10 mL', Subcategory: 'Needles & Syringes' }, TODAY);
    expect(matchesSearch(item, 'syringe 10ml')).toBe(true);
    expect(matchesSearch(item, 'syringe 10 ml')).toBe(true);
    expect(matchesSearch(item, 'syringe 5ml')).toBe(false);
  });
});

describe('normalizeInventory', () => {
  test('non-arrays and junk rows are ignored', () => {
    expect(normalizeInventory(null)).toEqual([]);
    expect(normalizeInventory({ detail: 'x' })).toEqual([]);
    expect(normalizeInventory([null, 5, {}, { _sheet_row: 'abc' }, TELFA])).toHaveLength(1);
  });

  test('keeps duplicate names as separate rows keyed by sheet row', () => {
    const items = normalizeInventory([row({ _sheet_row: 2 }), row({ _sheet_row: 3 })]);
    expect(items.map((i) => i.id)).toEqual([2, 3]);
  });
});

describe('availability', () => {
  test('holdsFrom keeps only Requested rows', () => {
    expect(holdsFrom([
      { sheet_row: 2, availability_status: 'Requested' },
      { sheet_row: '3', availability_status: 'Requested' },
      { sheet_row: 4, availability_status: 'Limited' },
      null,
    ])).toEqual({ 2: true, 3: true });
    expect(holdsFrom(undefined)).toEqual({});
    expect(holdsFrom({ detail: 'down' })).toEqual({});
  });

  test('expired and zero-stock items cannot be requested; unknown stock can', () => {
    expect(canRequest(normalizeItem(row({ 'Date of Expiration': '2026-10-08' }), TODAY))).toBe(false);
    expect(canRequest(normalizeItem(row({ Quantity: '0' }), TODAY))).toBe(false);
    expect(canRequest(normalizeItem(row({ Quantity: '' }), TODAY))).toBe(true);
    expect(canRequest(normalizeItem(row({ 'Date of Expiration': '2026-10-09' }), TODAY))).toBe(true);
  });

  test('badges: only the plan\'s badges, in order', () => {
    const labels = (over, hold = false) => badgesFor(normalizeItem(row(over), TODAY), hold).map((b) => b.label);
    expect(labels({})).toEqual([]);
    expect(labels({ Quantity: '2' })).toEqual(['Low stock']);
    expect(labels({ Quantity: '3' })).toEqual([]); // "Low stock" only at 2 or fewer
    expect(labels({ Quantity: '0' })).toEqual([]);
    expect(labels({ Quantity: '1' }, true)).toEqual(['On hold']);
    expect(labels({ 'Date of Expiration': '2026-12-01' })).toEqual(['Expires soon']);
    expect(labels({ Review: 'Yes' })).toEqual(['Team check']);
    // expired items never reach the UI now, so there is no "Expired" badge
    expect(labels({ 'Date of Expiration': '2020-01-01' })).not.toContain('Expired');
    const kinds = badgesFor(normalizeItem(row({ Quantity: '1', 'Date of Expiration': '2026-12-01' }), TODAY), false).map((b) => b.kind);
    expect(kinds).toEqual(['low', 'soon']);
  });

  test('stockLabel', () => {
    expect(stockLabel(null)).toBe('Quantity not listed');
    expect(stockLabel(0)).toBe('Out of stock');
    expect(stockLabel(1200)).toBe('1,200 in stock');
  });
});

describe('search, filters, sort', () => {
  const items = normalizeInventory([
    row({ _sheet_row: 2, Name: 'BD 10ml Syringe Luer-Lok', Subcategory: 'Needles & Syringes', Quantity: '40', 'Date of Expiration': '2027-05-01' }),
    row({ _sheet_row: 3, Name: 'Nitrile gloves medium', Subcategory: 'Gloves', Quantity: '3', 'Date of Expiration': '2026-11-01' }),
    row({ _sheet_row: 4, Name: 'Gauze 4x4', Subcategory: 'Wound Care & Bandages', Quantity: '', 'Date of Expiration': '' }),
    row({ _sheet_row: 5, Name: 'apron', Subcategory: '', Quantity: '0', 'Date of Expiration': '2020-01-01' }),
    row({ _sheet_row: 6, Name: 'Syringe 3ml', Subcategory: 'Needles & Syringes', Quantity: '1,200', 'Date of Expiration': '' }),
  ], TODAY);

  test('search is case-insensitive, all terms must match, extra spaces ignored', () => {
    const names = (q) => items.filter((i) => matchesSearch(i, q)).map((i) => i.id);
    expect(names('SYRINGE')).toEqual([2, 6]);
    expect(names('  syringe   10ml ')).toEqual([2]);
    expect(names('')).toEqual([2, 3, 4, 5, 6]);
    expect(names('cardinal')).toEqual([2, 3, 4, 5, 6]);
    expect(names('zzz')).toEqual([]);
  });

  test('search treats regex characters literally', () => {
    expect(() => items.filter((i) => matchesSearch(i, '(['))).not.toThrow();
    expect(items.filter((i) => matchesSearch(i, '4x4')).map((i) => i.id)).toEqual([4]);
  });

  test('in-stock filter hides zero, unknown and held items', () => {
    const ids = applyBaseFilters(items, { inStockOnly: true, holds: { 6: true } }).map((i) => i.id);
    expect(ids).toEqual([2, 3]);
  });

  test('hide-expiring filter hides soon and expired', () => {
    expect(applyBaseFilters(items, { hideExpiring: true }).map((i) => i.id)).toEqual([2, 4, 6]);
  });

  test('category counts are A-Z (no Other-last rule) and follow other filters', () => {
    const counts = subcategoryCounts(items);
    expect(counts.map((c) => c.name)).toEqual([...counts.map((c) => c.name)].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    expect(counts.find((c) => c.name === 'Needles & Syringes').count).toBe(2);
    expect(counts.find((c) => c.name === OTHER_SUBCATEGORY).count).toBe(1);
    const { base, results } = filterAndSort(items, { query: 'syringe', subcategory: 'Gloves', sort: 'stock' });
    expect(base).toHaveLength(2);
    expect(results).toEqual([]);
  });

  test('sorts: stock, name (default, case-insensitive), expiry', () => {
    expect(sortItems(items, 'stock').map((i) => i.id)).toEqual([6, 2, 3, 5, 4]);
    expect(sortItems(items, 'name').map((i) => i.name)).toEqual([
      'apron', 'BD 10ml Syringe Luer-Lok', 'Gauze 4x4', 'Nitrile gloves medium', 'Syringe 3ml',
    ]);
    expect(sortItems(items, 'expiry').map((i) => i.id)).toEqual([3, 2, 4, 6, 5]); // expired (5) last (FE-10)
    expect(sortItems(items, 'bogus').map((i) => i.id)).toEqual(sortItems(items, 'name').map((i) => i.id)); // unknown sort = name
    expect(sortItems(items).map((i) => i.id)).toEqual([5, 2, 4, 3, 6]); // default is A-Z
  });

  test('sorting does not mutate the input', () => {
    const before = items.map((i) => i.id);
    sortItems(items, 'name');
    expect(items.map((i) => i.id)).toEqual(before);
  });
});

describe('my requests', () => {
  const rows = [
    { 'Request ID': 'REQ-1', 'Item Name': 'Gauze', 'Quantity Requested': '2', Status: 'Shipped', Timestamp: '2026-09-01T10:00:00+00:00' },
    { 'Request ID': 'REQ-2', 'Item Name': 'Gloves', 'Quantity Requested': '5', Status: 'Under Review', Timestamp: '2026-10-01T10:00:00+00:00' },
    { 'Request ID': 'REQ-2', 'Item Name': '', 'Quantity Requested': '1', Status: 'Under Review', Timestamp: '2026-10-01T10:00:00+00:00' },
    { 'Request ID': '', 'Item Name': 'orphan' },
  ];

  test('groups lines by request, newest first, skips rows without an ID', () => {
    const groups = groupRequests(rows);
    expect(groups.map((g) => g.id)).toEqual(['REQ-2', 'REQ-1']);
    expect(groups[0].lines).toEqual([{ name: 'Gloves', quantity: 5 }, { name: 'Unnamed supply', quantity: 1 }]);
    expect(groupRequests(null)).toEqual([]);
  });

  test('status steps', () => {
    expect(statusStep('Under Review')).toBe(1);
    expect(statusStep(' approved ')).toBe(2);
    expect(statusStep('Shipped')).toBe(3);
    expect(statusStep('')).toBe(0);
    expect(statusStep('Delivered')).toBe(0);
  });

  test('formatDateTime tolerates junk', () => {
    expect(formatDateTime('2026-10-01T10:00:00+00:00')).toBe('Oct 1, 2026');
    expect(formatDateTime('not a date')).toBe('');
  });
});

describe('applyAvailability', () => {
  const items = normalizeInventory([
    row({ _sheet_row: 2, Name: 'Solo', Quantity: '10' }),
    row({ _sheet_row: 3, Name: 'Twin', Quantity: '3' }),
    row({ _sheet_row: 4, Name: 'twin', Quantity: '4' }),
    row({ _sheet_row: 5, Name: 'Unlisted', Quantity: '' }),
  ], TODAY);

  test('remaining after open requests becomes the requestable quantity', () => {
    const { items: out, holds } = applyAvailability(items, [
      { sheet_row: 2, availability_status: 'Available', remaining: 6 },
    ]);
    expect(out.find((i) => i.id === 2).quantity).toBe(6);
    expect(holds).toEqual({});
  });

  test('fully requested items keep their stock and are marked on hold', () => {
    const { items: out, holds } = applyAvailability(items, [
      { sheet_row: 2, availability_status: 'Requested', remaining: 0 },
    ]);
    expect(out.find((i) => i.id === 2).quantity).toBe(10);
    expect(holds).toEqual({ 2: true });
  });

  test('missing, null or junk availability leaves items alone', () => {
    expect(applyAvailability(items, null).items).toBe(items);
    expect(applyAvailability(items, []).items).toBe(items);
    const { items: out } = applyAvailability(items, [{ sheet_row: 5, remaining: null }, { sheet_row: 'x' }, null]);
    expect(out.map((i) => i.quantity)).toEqual([10, 3, 4, null]);
  });

  test('pooled remaining for a duplicate name never exceeds a row\'s own stock', () => {
    // The API pools stock by name once a request exists: rows 3 + 4 = 7, minus 2 requested = 5 on both rows.
    const { items: out } = applyAvailability(items, [
      { sheet_row: 3, availability_status: 'Limited', remaining: 5 },
      { sheet_row: 4, availability_status: 'Limited', remaining: 5 },
    ]);
    expect(out.find((i) => i.id === 3).quantity).toBeLessThanOrEqual(3);
    expect(out.find((i) => i.id === 4).quantity).toBeLessThanOrEqual(4);
  });
});

describe('statusInfo', () => {
  test.each([
    ['Under Review', { step: 1, label: 'Under review', stopped: false }],
    ['Approved', { step: 2, label: 'Approved', stopped: false }],
    ['Shipped', { step: 3, label: 'Shipped', stopped: false }],
    ['Delivered', { step: 4, label: 'Delivered', stopped: false }],
    [' denied ', { step: -1, label: 'Denied', stopped: true }],
    ['Cancelled', { step: -1, label: 'Cancelled', stopped: true }],
    ['canceled', { step: -1, label: 'Cancelled', stopped: true }],
    ['', { step: 0, label: 'Submitted', stopped: false }],
  ])('%p', (status, info) => {
    expect(statusInfo(status)).toEqual(info);
  });
});

describe('nameFromNotes', () => {
  test.each([
    ['', ''],
    [null, ''],
    ['   ', ''],
    ['Frozen sample tube for testing. Includes a code.', 'Frozen sample tube for testing'],
    ['Sterile, single use; latex free', 'Sterile, single use'],
    ['Is this a vial? Probably.', 'Is this a vial'],
    ['Box of gauze!', 'Box of gauze'],
    ['STERILE GAUZE PADS 4X4. BOX OF 10', 'Sterile gauze pads 4x4'],
    ['BD Syringe 10ML', 'BD Syringe 10ML'],          // mixed case kept
    ['contains 2.5 ml of saline. More text', 'Contains 2.5 ml of saline'], // decimal is not a sentence end
    ['  extra   spaces   here  ', 'Extra spaces here'],
  ])('%p -> %p', (notes, name) => {
    expect(nameFromNotes(notes)).toBe(name);
  });

  test('long text is cut at a word boundary with an ellipsis', () => {
    const out = nameFromNotes('word '.repeat(40), 20);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21);
    expect(out).not.toMatch(/\s…$/);
    expect(nameFromNotes('x'.repeat(100), 10)).toBe(`X${'x'.repeat(9)}…`); // one long word: hard cut
  });

  test.each(['N/A', 'n/a', '-', '--', '...', 'none', '?', ';'])('placeholder notes %p give no name', (notes) => {
    expect(nameFromNotes(notes)).toBe('');
  });
});

describe('unlabelled rows', () => {
  const rows = [
    row({ _sheet_row: 2, Name: 'Real name', General: '', Notes: '' }),
    row({ _sheet_row: 3, Name: 'Unknown', General: 'gauze roll', Notes: '' }),
    row({ _sheet_row: 4, Name: '', General: '', Notes: 'Frozen sample tube. Code ST15.', 'Lot Number': 'L4' }),
    row({ _sheet_row: 5, Name: 'Unknown', General: '', Notes: '', Subcategory: '' }),
    row({ _sheet_row: 6, Name: '  ', General: ' ', Notes: ' ', Subcategory: 'Gloves' }),
  ];
  const items = normalizeInventory(rows, TODAY);
  const byId = (id) => items.find((i) => i.id === id);

  test('name chain: Name, then General, then Notes, then a placeholder', () => {
    expect(byId(2).name).toBe('Real name');
    expect(byId(3).name).toBe('Gauze roll');
    expect(byId(4).name).toBe('Frozen sample tube');
    expect(byId(5).name).toBe('Unnamed supply');
  });

  test('flag is set only when Name, General and Notes are all empty', () => {
    expect(items.map((i) => !!i.unlabelled)).toEqual([false, false, false, true, true]);
    expect(unlabelledCount(items)).toBe(2);
  });

  test('unlabelled rows never show in search or filters', () => {
    expect(applyBaseFilters(items, {}).map((i) => i.id)).toEqual([2, 3, 4]);
    expect(applyBaseFilters(items, { query: 'unnamed' })).toEqual([]);
    expect(applyBaseFilters(items, { query: 'cardinal' }).map((i) => i.id)).toEqual([2, 3, 4]);
  });

  test('unlabelled rows are left out of categories and their counts', () => {
    const catalog = buildCatalog(items);
    const total = catalog.reduce((n, c) => n + c.count, 0);
    expect(total).toBe(3);
    expect(catalog.find((c) => c.name === 'Gloves')).toBeUndefined();
  });

  test('a notes-named row is requested with lot/pallet/box detail', () => {
    expect(byId(4).requestName).toMatch(/^Frozen sample tube \(.*L4/);
  });
});

describe('products and FEFO allocation', () => {
  const lots = normalizeInventory([
    row({ _sheet_row: 10, Name: 'Saline 500ml', 'Manufacturer Name': 'Maker A', 'Date of Expiration': '2028-01-01', Quantity: '5', 'Lot Number': 'B' }),
    row({ _sheet_row: 11, Name: 'saline  500ML', 'Manufacturer Name': 'maker a', 'Date of Expiration': '2027-01-01', Quantity: '3', 'Lot Number': 'A' }),
    row({ _sheet_row: 12, Name: 'Saline 500ml', 'Manufacturer Name': 'Maker A', 'Date of Expiration': '2020-01-01', Quantity: '10', 'Lot Number': 'X' }),
    row({ _sheet_row: 13, Name: 'Saline 500ml', 'Manufacturer Name': 'Maker A', 'Date of Expiration': '', Quantity: '2', 'Lot Number': 'D' }),
    row({ _sheet_row: 14, Name: 'Saline 500ml', 'Manufacturer Name': 'Maker B', Quantity: '4' }),
  ], TODAY);
  const products = groupProducts(lots);
  const saline = products.find((p) => p.lots.length > 1);
  const take = (n) => allocateFefo(saline, n).map(({ item, quantity }) => [item.id, quantity]);

  test('same name and maker (ignoring case and spacing) merge; another maker stays separate', () => {
    expect(products).toHaveLength(2);
    expect(saline.lots.map((l) => l.id)).toEqual([11, 10, 13]); // A-Z by lot number; the expired lot is left out
  });

  test('stock counts usable lots only; first expiry is the next usable one', () => {
    expect(saline.quantity).toBe(10);
    expect(saline.expiry).toBe('2027-01-01');
    expect(saline.row).toBe(11);
  });

  test.each([
    [1, [[11, 1]]],
    [4, [[11, 3], [10, 1]]],
    [10, [[11, 3], [10, 5], [13, 2]]],
  ])('allocating %i units uses the earliest-expiring lots first', (n, expected) => {
    expect(take(n)).toEqual(expected);
  });

  test('never allocates from an expired lot, and always sums to the request', () => {
    for (let n = 1; n <= 15; n += 1) {
      const out = take(n);
      expect(out.some(([id]) => id === 12)).toBe(false);
      expect(out.reduce((sum, [, q]) => sum + q, 0)).toBe(n);
    }
  });

  test('lots with unlisted stock absorb what listed lots cannot cover', () => {
    const p = groupProducts(normalizeInventory([
      row({ _sheet_row: 20, Name: 'Tape', 'Date of Expiration': '2027-01-01', Quantity: '2' }),
      row({ _sheet_row: 21, Name: 'Tape', 'Date of Expiration': '2028-01-01', Quantity: '' }),
    ], TODAY))[0];
    expect(allocateFefo(p, 5).map(({ item, quantity }) => [item.id, quantity])).toEqual([[20, 2], [21, 3]]);
  });

  test('a product is on hold only when every usable lot is held', () => {
    expect(groupProducts(lots, { 11: true }).find((p) => p.lots.length > 1).onHold).toBe(false);
    expect(groupProducts(lots, { 10: true, 11: true, 13: true }).find((p) => p.lots.length > 1).onHold).toBe(true);
  });
});

describe('displayName', () => {
  test.each([
    ['BD Syringe 10ml Luer-Lok', 'BD Syringe 10ml Luer-Lok'], // mostly lower case: untouched
    ['NITRILE EXAM GLOVES', 'Nitrile Exam Gloves'],
    ['GAUZE 4X4 STERILE', 'Gauze 4X4 Sterile'], // tokens with digits kept as written
    ['', ''],
    ['12345', '12345'],
  ])('%p -> %p', (raw, shown) => {
    expect(displayName(raw)).toBe(shown);
  });

  test('search still finds the raw sheet text', () => {
    const item = normalizeItem(row({ Name: 'NITRILE EXAM GLOVES' }), TODAY);
    expect(matchesSearch(item, 'nitrile exam')).toBe(true);
  });
});

describe('displayName: frontend examples', () => {
  test.each([
    ['62697 TELFA PACK UNIVERSITY OF MICHIGAN HOSP', '62697 Telfa Pack University of Michigan Hosp'],
    ['CURAD XEROFORM PETROLATUM DRESSING 5 X 9 IN (12.7 X 22.8 CM)', 'Curad Xeroform Petrolatum Dressing 5 x 9 in (12.7 x 22.8 cm)'],
    ['IV START KIT REF 1234', 'IV Start Kit REF 1234'],
    ['BD Vacutainer Eclipse needle', 'BD Vacutainer Eclipse needle'],
  ])('%p', (raw, shown) => {
    expect(displayName(raw)).toBe(shown);
  });

  test('requestName keeps the sheet spelling', () => {
    const item = normalizeItem(row({ Name: 'IV START KIT REF 1234' }), TODAY);
    expect(item.name).toBe('IV Start Kit REF 1234');
    expect(item.requestName).toMatch(/^IV START KIT REF 1234 \[Lot LOT0001, Box 4, Pallet 1\]$/); // sheet spelling + lot suffix (FE-13)
  });
});

describe('slugs', () => {
  test('uniqueSlugs never maps two names to one slug', () => {
    const m = uniqueSlugs(['Gloves and Masks', 'Gloves & Masks', 'Gloves & Masks']);
    expect(m.get('Gloves & Masks')).toBe('gloves-and-masks');
    expect(m.get('Gloves and Masks')).toBe('gloves-and-masks-2');
  });

  test('names without ASCII letters still get distinct, routable slugs', () => {
    const names = ['Гигиена', 'Équipement', '日本語', '—'];
    const slugs = [...uniqueSlugs(names).values()];
    expect(new Set(slugs).size).toBe(names.length);
    for (const sl of slugs) expect(sl).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test('slugs are stable across calls and order of input', () => {
    const a = uniqueSlugs(['B & C', 'B and C']);
    const b = uniqueSlugs(['B and C', 'B & C']);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  test('buildCatalog gives colliding categories distinct slugs', () => {
    const items = normalizeInventory([
      row({ _sheet_row: 2, Subcategory: 'Gloves & Masks' }),
      row({ _sheet_row: 3, Subcategory: 'Gloves and Masks', Name: 'Other' }),
    ], TODAY);
    const slugs = buildCatalog(items).map((c) => c.slug);
    expect(new Set(slugs).size).toBe(2);
  });

  test('slugify is URL-safe', () => {
    expect(slugify('Apparel (Gowns, Shoe Covers, etc.)')).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('makers and product keys', () => {
  test('maker spelled with a parenthetical merges; a different maker does not', () => {
    expect(makerKey('BD (Becton, Dickinson and Company)')).toBe('bd');
    expect(makerKey('BD')).toBe('bd');
    expect(makerKey('Becton Dickinson')).toBe('becton dickinson');
    const items = normalizeInventory([
      row({ _sheet_row: 2, Name: 'BD 10ml Syringe Luer-Lok Tip', 'Manufacturer Name': 'BD (Becton, Dickinson and Company)', Quantity: '3' }),
      row({ _sheet_row: 3, Name: 'BD 10ml Syringe Luer-Lok Tip', 'Manufacturer Name': 'BD', Quantity: '2' }),
      row({ _sheet_row: 4, Name: 'BD 10ml Syringe Luer-Lok Tip', 'Manufacturer Name': 'Becton Dickinson', Quantity: '1' }),
    ], TODAY);
    const products = groupProducts(items);
    expect(products).toHaveLength(2);
    const bd = products.find((p) => p.lots.length === 2);
    expect(bd.quantity).toBe(5);
    expect(bd.manufacturer).toBe('BD');
  });

  test('a "|" in a name cannot make two different products collide', () => {
    const a = normalizeItem(row({ Name: 'a|b', 'Manufacturer Name': 'c' }), TODAY);
    const b = normalizeItem(row({ Name: 'a', 'Manufacturer Name': 'b|c' }), TODAY);
    expect(productKey(a)).not.toBe(productKey(b));
  });
});

describe('FEFO: frontend example', () => {
  const today = new Date(2026, 9, 9);
  const product = groupProducts(normalizeInventory([
    row({ _sheet_row: 2, Name: 'P', 'Date of Expiration': '2027-05-01', Quantity: '3' }),
    row({ _sheet_row: 3, Name: 'P', 'Date of Expiration': '2026-11-01', Quantity: '4' }),
    row({ _sheet_row: 4, Name: 'P', 'Date of Expiration': '2020-01-01', Quantity: '5' }),
    row({ _sheet_row: 5, Name: 'P', 'Date of Expiration': '', Quantity: '2' }),
  ], today))[0];
  const take = (n) => allocateFefo(product, n).map(({ item, quantity }) => [item.id, quantity]);

  test('quantity, expiry and lot order', () => {
    expect(product.quantity).toBe(9);
    expect(product.expiry).toBe('2026-11-01');
    expect(product.lots.map((l) => l.id)).not.toContain(4); // expired lot left out
    expect(product.lots).toHaveLength(3);
  });

  test('allocate 8 and 12', () => {
    expect(take(8)).toEqual([[3, 4], [2, 3], [5, 1]]);
    expect(take(12)).toEqual([[3, 7], [2, 3], [5, 2]]);
  });

  test('product filters: in-stock drops held products; hide-expiring uses allExpiring', () => {
    const held = groupProducts(product.lots, { 2: true, 3: true, 5: true });
    expect(applyBaseFilters(held, { inStockOnly: true })).toEqual([]);
    expect(applyBaseFilters([product], { hideExpiring: true })).toEqual([product]); // one lot is not expiring
  });

  test('formatMonth', () => {
    expect(formatMonth('2027-03-15')).toBe('Mar 2027');
    expect(formatMonth('')).toBe('');
  });
});

describe('request names sent to HQ', () => {
  const rn = (over) => normalizeItem(row(over), TODAY).requestName;

  test('named row: sheet spelling plus the lot suffix', () => {
    expect(rn({ Name: 'Saline 500ml', 'Lot Number': 'A1', 'Box Number': '3', 'Pallet Number': '2' }))
      .toBe('Saline 500ml [Lot A1, Box 3, Pallet 2]');
  });

  test('blanks become an em dash', () => {
    expect(rn({ Name: 'Tape', 'Lot Number': '', 'Box Number': '', 'Pallet Number': '' })).toBe('Tape [Lot —, Box —, Pallet —]');
  });

  test('unnamed row uses display name and maker', () => {
    expect(rn({ Name: 'Unknown', General: 'gauze roll', 'Manufacturer Name': 'Medline', 'Lot Number': 'L6', 'Box Number': '', 'Pallet Number': '' }))
      .toBe('Gauze roll (Medline) [Lot L6, Box —, Pallet —]');
  });

  test('capped at 500 chars, suffix kept whole', () => {
    const out = rn({ Name: 'x'.repeat(800), 'Lot Number': 'L9' });
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out).toMatch(/\[Lot L9, Box \S+, Pallet \S+\]$/);
  });

  test('baseRequestName round trip, and only a trailing suffix is stripped', () => {
    expect(baseRequestName(rn({ Name: 'Saline 500ml' }))).toBe('Saline 500ml');
    expect(baseRequestName('Saline[Lot A, Box 1, Pallet 1]')).toBe('Saline');
    expect(baseRequestName('Kit [Lot A] extra')).toBe('Kit [Lot A] extra');
    expect(baseRequestName('Plain name')).toBe('Plain name');
  });
});

describe('my requests: lot lines merge back into supplies', () => {
  test('1 + 24 of the same product is one line of 25 with 2 lots', () => {
    const [g] = groupRequests([
      { 'Request ID': 'REQ-1', 'Item Name': 'Saline [Lot A, Box 1, Pallet 1]', 'Quantity Requested': '1', Status: 'Under Review', Timestamp: 't' },
      { 'Request ID': 'REQ-1', 'Item Name': 'Saline [Lot B, Box 2, Pallet 1]', 'Quantity Requested': '24', Status: 'Under Review', Timestamp: 't' },
      { 'Request ID': 'REQ-1', 'Item Name': 'Gloves [Lot C, Box 1, Pallet 1]', 'Quantity Requested': '3', Status: 'Under Review', Timestamp: 't' },
    ]);
    expect(g.lines).toEqual([{ name: 'Saline', quantity: 25 }, { name: 'Gloves', quantity: 3 }]);
    expect(g.lotCount).toBe(3);
  });

  test('unknown quantity stays unknown after merging', () => {
    const [g] = groupRequests([
      { 'Request ID': 'R', 'Item Name': 'A [Lot 1, Box 1, Pallet 1]', 'Quantity Requested': '2', Timestamp: 't' },
      { 'Request ID': 'R', 'Item Name': 'A [Lot 2, Box 1, Pallet 1]', 'Quantity Requested': '', Timestamp: 't' },
    ]);
    expect(g.lines[0].quantity).toBeNull();
  });

  test.each([[1, 1, '1 supply'], [3, 3, '3 supplies'], [1, 2, '1 supply (2 batches)'], [2, 5, '2 supplies (5 batches)']])(
    'suppliesLabel(%i, %i) = %p', (supplies, lots, label) => {
      expect(suppliesLabel(supplies, lots)).toBe(label);
    },
  );
});

describe('matchingTypes: word starts in the type label only', () => {
  const catalog = [
    { name: 'Needles & Syringes', types: [{ label: 'Syringes', slug: 's' }, { label: 'Spinal needles', slug: 'sn' }, { label: 'Tube holders', slug: 't' }] },
    { name: 'Wound Care & Bandages', types: [{ label: 'Gauze sponges & pads', slug: 'g' }, { label: 'Adhesive bandages', slug: 'a' }] },
  ];
  const labels = (q) => matchingTypes(catalog, q).map((t) => t.label);

  test.each([
    ['syr', ['Syringes']],
    ['SYRINGE', ['Syringes']],
    ['a', ['Adhesive bandages']],          // not every label containing an "a"
    ['needles', ['Spinal needles']],        // the category name does not count
    ['gau pad', ['Gauze sponges & pads']],  // every term must start a word
    ['ringes', []],                         // mid-word does not match
    ['', []],
    ['   ', []],
  ])('%p -> %p', (q, expected) => {
    expect(labels(q)).toEqual(expected);
  });

  test('results carry their category and are A-Z', () => {
    const out = matchingTypes(catalog, 's');
    expect(out.map((t) => t.label)).toEqual(['Gauze sponges & pads', 'Spinal needles', 'Syringes']);
    expect(out.every((t) => t.category && t.category.name)).toBe(true);
  });
});

describe('held lots', () => {
  const mk = (id, lot, qty, exp) => ({ _sheet_row: id, Name: 'Syringe 10 mL', 'Manufacturer Name': 'Acme', Subcategory: 'Needles & Syringes',
    Quantity: String(qty), 'Lot Number': lot, 'Date of Expiration': exp });
  const items = normalizeInventory([mk(2, 'A', 5, '2027-01-01'), mk(3, 'B', 10, '2028-01-01')], TODAY);
  const avail = [{ sheet_row: 2, remaining: 0, availability_status: 'Requested' }, { sheet_row: 3, remaining: 10, availability_status: 'Available' }];

  test('a fully held lot does not count toward the product and is not allocated', () => {
    const { items: merged, holds } = applyAvailability(items, avail);
    const [p] = groupProducts(merged, holds);
    expect(p.quantity).toBe(10);
    expect(p.onHold).toBe(false);
    expect(allocateFefo(p, 15).map((a) => [a.item.lot, a.quantity])).toEqual([['B', 15]]); // overflow goes to the free lot, not lot A
    expect(allocateFefo(p, 4).map((a) => [a.item.lot, a.quantity])).toEqual([['B', 4]]);
  });

  test('on hold only when every lot is held', () => {
    const all = [{ ...avail[0] }, { sheet_row: 3, remaining: 0, availability_status: 'Requested' }];
    const { items: merged, holds } = applyAvailability(items, all);
    const [p] = groupProducts(merged, holds);
    expect(p.onHold).toBe(true);
    expect(p.quantity).toBe(0);
    expect(canRequest(p)).toBe(false);
  });
});

describe('search ranking', () => {
  const mk = (id, name, sub) => normalizeItem({ _sheet_row: id, Name: name, Subcategory: sub }, TODAY);
  const items = [mk(2, 'Alcohol prep pads', 'Needles & Syringes'), mk(3, 'Syringe 5 mL', 'Needles & Syringes'), mk(4, 'Gauze', 'Wound Care')];
  test('supplies that say the word come first; category-only matches follow', () => {
    const { own, other } = rankByRelevance(items.filter((i) => matchesSearch(i, 'syringes')), 'syringes');
    expect(own.map((i) => i.name)).toEqual(['Syringe 5 mL']);
    expect(other.map((i) => i.name)).toEqual(['Alcohol prep pads']);
  });
  test('category text still finds supplies (nothing is filtered out)', () => {
    expect(matchesSearch(items[0], 'needles')).toBe(true);
  });
});

describe('search folding', () => {
  const find = (name, query) => matchesSearch(normalizeItem({ _sheet_row: 9, Name: name }, TODAY), query);
  test.each([
    ['Café Wrap', 'cafe'], ['Cafe Wrap', 'café'], ['Cafe Wrap', 'CAFÉ'],
    ['Syringe', 'syringes'], ['Gloves', 'glove'], ['Gauze boxes', 'box'], ['Syringes', 'syringe'],
    ['Saline 0.9 %', '0.9%'], ['Saline 0.9%', '0.9 %'],
    ['Gauze 4 x 4', '4x4'], ['Gauze 4x4', '4 x 4'], ['Gauze 4×4', '4x4'], ['Bandage 4" x 4"', '4x4'], ['Gauze 4x4', 'gauze 4 x 4'],
    ['Syringe 10 mL', '10ml'], ['Syringe 10ml', '10 ml'],
  ])('%p is found by %p', (name, query) => {
    expect(find(name, query)).toBe(true);
  });
  test.each([['Gauze 4 x 4', '4x5'], ['Syringe', 'needles'], ['Gauze', 'gauzes x']])('%p is not found by %p', (name, query) => {
    expect(find(name, query)).toBe(false);
  });
});
