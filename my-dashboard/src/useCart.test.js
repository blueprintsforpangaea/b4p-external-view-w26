import { act, renderHook } from '@testing-library/react';
import useCart, { CART_KEY, MAX_LINES, MAX_QTY, capQuantity, cartKey } from './useCart';
import useOrg, { ORG_KEY } from './useOrg';
import { readJSON, writeJSON } from './storage';

const item = (id, quantity = 10, over = {}) => ({
  id, name: `Item ${id}`, category: 'C', subcategory: 'S', needsReview: false, quantity, ...over,
});

beforeEach(() => window.localStorage.clear());

describe('storage', () => {
  test('corrupted JSON falls back', () => {
    window.localStorage.setItem('k', '{not json');
    expect(readJSON('k', 'fallback')).toBe('fallback');
    expect(readJSON('missing', 7)).toBe(7);
  });

  test('throwing localStorage (private mode / quota) never breaks callers', () => {
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(readJSON('k', [])).toEqual([]);
    expect(() => writeJSON('k', [1])).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('capQuantity', () => {
  test.each([
    [5, 10, 5], [15, 10, 10], [0, 10, 0], [-3, 10, 0], [2.9, 10, 2], ['4', 10, 4], ['', 10, 0],
    ['abc', 10, 0], [NaN, 10, 0], [Infinity, 10, 0], [20000, null, MAX_QTY], [20000, 50000, MAX_QTY], [3, 0, 0],
  ])('capQuantity(%p, max %p) = %p', (qty, max, expected) => {
    expect(capQuantity(qty, max)).toBe(expected);
  });
});

describe('useCart', () => {
  test('add, step, cap at stock, zero removes', () => {
    const { result } = renderHook(() => useCart());
    act(() => { result.current.setQuantity(item(2, 3), 1); });
    expect(result.current.quantityOf(2)).toBe(1);
    act(() => { result.current.setQuantity(item(2, 3), 99); });
    expect(result.current.quantityOf(2)).toBe(3);
    act(() => { result.current.setQuantity(item(2, 3), 0); });
    expect(result.current.lines).toEqual([]);
  });

  test('zero-stock items are never added; unknown stock caps at the server limit', () => {
    const { result } = renderHook(() => useCart());
    act(() => { result.current.setQuantity(item(2, 0), 1); });
    expect(result.current.lines).toEqual([]);
    act(() => { result.current.setQuantity(item(3, null), 50000); });
    expect(result.current.quantityOf(3)).toBe(MAX_QTY);
  });

  test('editing from the slip (a line, not an item) still respects the stock cap', () => {
    const { result } = renderHook(() => useCart());
    act(() => { result.current.setQuantity(item(2, 4), 2); });
    const line = result.current.lines[0];
    expect(line.max).toBe(4);
    // App.js passes the stored line itself (it has `quantity` = amount on the slip, `max` = stock)
    act(() => { result.current.setQuantity(result.current.lines[0], 3); });
    expect(result.current.quantityOf(2)).toBe(3); // [+] on the slip must be able to go up
    act(() => { result.current.setQuantity(result.current.lines[0], 9); });
    expect(result.current.quantityOf(2)).toBe(4);
  });

  test('persists across a reload', () => {
    const first = renderHook(() => useCart());
    act(() => { first.result.current.setQuantity(item(2, 10), 4); });
    first.unmount();
    expect(JSON.parse(window.localStorage.getItem(CART_KEY))).toHaveLength(1);
    const second = renderHook(() => useCart());
    expect(second.result.current.quantityOf(2)).toBe(4);
    expect(second.result.current.totalUnits).toBe(4);
  });

  test.each([
    ['{broken'], ['"a string"'], ['null'], ['{"id":2}'], ['42'],
  ])('corrupted cart %s loads as empty', (raw) => {
    window.localStorage.setItem(CART_KEY, raw);
    const { result } = renderHook(() => useCart());
    expect(result.current.lines).toEqual([]);
  });

  test('invalid lines are dropped, valid ones kept', () => {
    window.localStorage.setItem(CART_KEY, JSON.stringify([
      { id: 2, name: 'ok', quantity: 2 },
      { id: '3', name: 'string id', quantity: 1 },
      { id: 4, name: 'neg', quantity: -1 },
      { id: 5, name: 'frac', quantity: 1.5 },
      { id: 6, quantity: 1 },
      null,
    ]));
    const { result } = renderHook(() => useCart());
    expect(result.current.lines.map((l) => l.id)).toEqual([2, '3']); // string ids are product keys now
  });

  test('tampered storage cannot exceed server limits', () => {
    const many = Array.from({ length: MAX_LINES + 5 }, (_, i) => ({ id: i + 2, name: `n${i}`, quantity: 1 }));
    window.localStorage.setItem(CART_KEY, JSON.stringify([
      { id: 1000, name: 'huge', quantity: 999999 }, { id: 1000, name: 'huge', quantity: 3 }, ...many,
    ]));
    const { result } = renderHook(() => useCart());
    const ids = result.current.lines.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate lines
    expect(ids.length).toBeLessThanOrEqual(MAX_LINES);
    expect(result.current.lines.every((l) => l.quantity <= MAX_QTY)).toBe(true);
  });

  test('refuses a 101st line but still edits existing ones', () => {
    const { result } = renderHook(() => useCart());
    act(() => {
      for (let i = 0; i < MAX_LINES; i += 1) result.current.setQuantity(item(i + 2), 1);
    });
    expect(result.current.lines).toHaveLength(MAX_LINES);
    let ok;
    act(() => { ok = result.current.setQuantity(item(999), 1); });
    expect(ok).toBe(false);
    expect(result.current.lines).toHaveLength(MAX_LINES);
    act(() => { ok = result.current.setQuantity(item(2), 5); });
    expect(ok).toBe(true);
    expect(result.current.quantityOf(2)).toBe(5);
  });

  test('reconcile drops vanished, renamed, expired and out-of-stock rows and re-caps the rest', () => {
    window.localStorage.setItem(CART_KEY, JSON.stringify([
      { id: 2, name: 'Item 2', quantity: 8 },
      { id: 3, name: 'Item 3', quantity: 1 },
      { id: 4, name: 'Item 4', quantity: 1 },
      { id: 5, name: 'Item 5', quantity: 1 },
      { id: 6, name: 'Item 6', quantity: 1 },
    ]));
    const { result } = renderHook(() => useCart());
    const byId = new Map([
      [2, item(2, 5)],
      [3, item(3, 10, { name: 'Different supply now' })],
      [5, item(5, 10, { expiryState: 'expired' })],
      [6, item(6, 0)],
    ]);
    let removed;
    act(() => { removed = result.current.reconcile(byId, byId); }); // numeric ids are legacy sheet rows
    expect(removed).toEqual(['Item 3', 'Item 4', 'Item 5', 'Item 6']);
    expect(result.current.lines.map((l) => [l.id, l.quantity])).toEqual([[2, 5]]);
  });

  test('another tab editing the cart is picked up', () => {
    const { result } = renderHook(() => useCart());
    const value = JSON.stringify([{ id: 7, name: 'From tab 2', quantity: 2 }]);
    window.localStorage.setItem(CART_KEY, value);
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: CART_KEY, newValue: value })); });
    expect(result.current.quantityOf(7)).toBe(2);
  });

  test('restore puts a removed line back at its old position, once', () => {
    const { result } = renderHook(() => useCart());
    act(() => { [2, 3, 4].forEach((id) => result.current.setQuantity(item(id), 1)); });
    const removed = result.current.lines[1];
    act(() => { result.current.remove(3); });
    act(() => { result.current.restore(removed, 1); });
    act(() => { result.current.restore(removed, 1); }); // double Undo is harmless
    expect(result.current.lines.map((l) => l.id)).toEqual([2, 3, 4]);
  });

  test('clear empties the cart and storage', () => {
    const { result } = renderHook(() => useCart());
    act(() => { result.current.setQuantity(item(2), 1); });
    act(() => { result.current.clear(); });
    expect(result.current.lines).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(CART_KEY))).toEqual([]);
  });
});

describe('useOrg', () => {
  test('remembers trimmed name and email', () => {
    const first = renderHook(() => useOrg());
    act(() => { first.result.current[1]({ name: '  Riverside Clinic ', email: ' a@b.org ' }); });
    first.unmount();
    const second = renderHook(() => useOrg());
    expect(second.result.current[0]).toEqual({ name: 'Riverside Clinic', email: 'a@b.org' });
  });

  test.each(['{bad', '[]', '{"name": 5, "email": null}', 'null'])('corrupted org %s loads blank', (raw) => {
    window.localStorage.setItem(ORG_KEY, raw);
    const { result } = renderHook(() => useOrg());
    expect(result.current[0]).toEqual({ name: '', email: '' });
  });
});

describe('a signed-in clinic’s saved list', () => {
  const names = (lines) => lines.map((l) => `${l.name} x${l.quantity}`);

  test('is kept under their email and comes back when they return', () => {
    const first = renderHook(() => useCart('Ana@Clinic.org'));
    act(() => { first.result.current.setQuantity(item(1), 3); });
    first.unmount(); // closed the tab
    expect(readJSON(cartKey('ana@clinic.org'), [])).toHaveLength(1);
    expect(readJSON(CART_KEY, [])).toEqual([]); // not left in the visitors' list
    const later = renderHook(() => useCart('ana@clinic.org'));
    expect(names(later.result.current.lines)).toEqual(['Item 1 x3']);
  });

  test('signing in adds what was picked while signed out; signing out puts the list away', () => {
    writeJSON(cartKey('ana@clinic.org'), [{ id: 1, name: 'Item 1', quantity: 2 }]);
    const { result, rerender } = renderHook(({ owner }) => useCart(owner), { initialProps: { owner: null } });
    act(() => { result.current.setQuantity(item(1), 1); });
    act(() => { result.current.setQuantity(item(2), 4); });
    const loads = result.current.loads;
    rerender({ owner: 'ana@clinic.org' });
    expect(names(result.current.lines)).toEqual(['Item 1 x3', 'Item 2 x4']);
    expect(result.current.loads).toBe(loads + 1); // so the page re-checks stock
    expect(readJSON(CART_KEY, [])).toEqual([]);
    rerender({ owner: null });
    expect(result.current.lines).toEqual([]);
    expect(readJSON(cartKey('ana@clinic.org'), [])).toHaveLength(2);
    rerender({ owner: 'ana@clinic.org' });
    expect(names(result.current.lines)).toEqual(['Item 1 x3', 'Item 2 x4']);
  });

  test('another clinic signing in on the same device gets its own list, not the last one', () => {
    writeJSON(cartKey('a@one.org'), [{ id: 1, name: 'Item 1', quantity: 2 }]);
    const { result, rerender } = renderHook(({ owner }) => useCart(owner), { initialProps: { owner: 'a@one.org' } });
    rerender({ owner: 'b@two.org' });
    expect(result.current.lines).toEqual([]);
  });

  test('a list saved before this change (visitors’ key) moves into the account on first load', () => {
    writeJSON(CART_KEY, [{ id: 5, name: 'Item 5', quantity: 1 }]);
    const { result } = renderHook(() => useCart('ana@clinic.org'));
    expect(names(result.current.lines)).toEqual(['Item 5 x1']);
    expect(readJSON(CART_KEY, [])).toEqual([]);
  });
});
