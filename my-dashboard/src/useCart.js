import { useCallback, useEffect, useRef, useState } from 'react';
import { readJSON, writeJSON } from './storage';

export const CART_KEY = 'b4p.cart.v1';
export const MAX_LINES = 100; // server limit per request
export const MAX_QTY = 10000; // server limit per line

// Lines are keyed by product (name + maker). Older saves used a sheet row number;
// reconcile() migrates those once inventory loads.
const validId = (id) => (Number.isInteger(id) && id > 0) || (typeof id === 'string' && id.length > 0 && id.length <= 400);

function cleanLines(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const l of value) {
    if (!l || !validId(l.id) || seen.has(l.id) || typeof l.name !== 'string') continue;
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) continue;
    const max = Number.isInteger(l.max) && l.max >= 0 ? l.max : null;
    seen.add(l.id);
    out.push({ ...l, max, quantity: Math.min(l.quantity, MAX_QTY, max ?? MAX_QTY) || 1 });
    if (out.length === MAX_LINES) break;
  }
  return out;
}

// Catalog items carry stock in `quantity`; slip lines carry it in `max`
// (their `quantity` is the amount requested).
const stockOf = (itemOrLine) => ('max' in itemOrLine ? itemOrLine.max : itemOrLine.quantity);

export function capQuantity(qty, max) {
  const n = Math.floor(Number(qty));
  if (!Number.isFinite(n) || n <= 0) return 0;
  const limit = max == null ? MAX_QTY : Math.min(max, MAX_QTY);
  return Math.min(n, limit);
}

function lineFrom(item, quantity) {
  return {
    id: item.id,
    name: item.name,
    requestName: item.requestName || item.name,
    category: item.category,
    subcategory: item.subcategory,
    needsReview: !!item.needsReview,
    lotCount: item.lots ? item.lots.length : 1,
    max: stockOf(item) ?? null,
    quantity,
  };
}

// Where a list is saved on this device: one per signed-in clinic email, plus one for visitors
// who aren't signed in. (There is no server-side store for lists yet.)
export const cartKey = (owner) => (owner ? `${CART_KEY}:${owner.trim().toLowerCase()}` : CART_KEY);

// One line per supply: quantities added together (capped again by reconcile once stock is known).
function mergeLines(saved, added) {
  const out = saved.map((l) => ({ ...l }));
  for (const line of added) {
    const same = out.find((l) => l.id === line.id);
    if (same) same.quantity = Math.min(same.quantity + line.quantity, MAX_QTY);
    else if (out.length < MAX_LINES) out.push(line);
  }
  return out;
}

// Cart keyed by product, persisted in localStorage, quantities capped at stock.
// `owner` is the signed-in clinic's email: their list is kept under it, so it's still there
// after they close the tab or come back another day. Signing in adds anything picked while
// signed out to their saved list; signing out puts their list away until they sign in again.
// `loads` changes whenever a saved list is swapped in, so it can be checked against stock.
export default function useCart(owner = null) {
  const [lines, setLines] = useState(() => {
    const own = cleanLines(readJSON(cartKey(owner), []));
    return owner ? mergeLines(own, cleanLines(readJSON(CART_KEY, []))) : own;
  });
  const [loads, setLoads] = useState(0);

  const linesRef = useRef(lines);
  linesRef.current = lines;
  const ownerRef = useRef(owner);

  // Swap lists when someone signs in or out (runs before the save below).
  useEffect(() => {
    const was = ownerRef.current;
    if (was === owner) return;
    ownerRef.current = owner;
    const saved = cleanLines(readJSON(cartKey(owner), []));
    setLines(owner && !was ? mergeLines(saved, linesRef.current) : saved);
    setLoads((n) => n + 1);
  }, [owner]);

  // Save. A signed-in clinic's list now holds anything picked while signed out, so the
  // visitors' list on this device is emptied.
  useEffect(() => {
    writeJSON(cartKey(ownerRef.current), lines);
    if (ownerRef.current) writeJSON(CART_KEY, []);
  }, [lines]);

  // Keep several open tabs in step.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === cartKey(ownerRef.current)) setLines(cleanLines(readJSON(e.key, [])));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Returns false when a new line would go past the per-request limit.
  const setQuantity = useCallback((item, qty) => {
    const current = linesRef.current;
    const exists = current.some((l) => l.id === item.id);
    if (!exists && current.length >= MAX_LINES && capQuantity(qty, stockOf(item)) > 0) return false;
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.id === item.id);
      const capped = capQuantity(qty, stockOf(item));
      if (idx === -1) {
        if (capped === 0 || prev.length >= MAX_LINES) return prev;
        return [...prev, lineFrom(item, capped)];
      }
      if (capped === 0) return prev.filter((l) => l.id !== item.id);
      const next = [...prev];
      next[idx] = { ...prev[idx], quantity: capped };
      return next;
    });
    return true;
  }, []);

  // Put a removed line back where it was (undo).
  const restore = useCallback((line, index) => {
    setLines((prev) => {
      if (prev.some((l) => l.id === line.id) || prev.length >= MAX_LINES) return prev;
      const next = [...prev];
      next.splice(Math.min(index, next.length), 0, line);
      return next;
    });
  }, []);

  const remove = useCallback((id) => setLines((prev) => prev.filter((l) => l.id !== id)), []);
  const clear = useCallback(() => setLines([]), []);

  // After inventory loads: refresh snapshots, re-cap, migrate row-keyed lines to
  // products, and drop lines that vanished or can no longer be requested.
  // `forRow` maps a sheet row to its product (for old saves). Returns removed names.
  const reconcile = useCallback((byId, forRow) => {
    const prev = linesRef.current;
    const removed = [];
    const merged = new Map();
    const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    for (const line of prev) {
      const legacy = typeof line.id === 'number' && forRow;
      const product = legacy ? forRow.get(line.id) : byId.get(line.id);
      const matches = product && (!legacy || same(line.name, product.name) || same(line.name, product.rawName));
      if (!matches || product.expiryState === 'expired' || product.quantity === 0) {
        removed.push(line.name);
        continue;
      }
      const qty = (merged.has(product.id) ? merged.get(product.id).quantity : 0) + line.quantity;
      merged.set(product.id, lineFrom(product, capQuantity(qty, product.quantity) || 1));
    }
    const next = [...merged.values()].slice(0, MAX_LINES);
    const unchanged = next.length === prev.length && next.every((l, i) => JSON.stringify(l) === JSON.stringify(prev[i]));
    if (!unchanged) setLines(next);
    return removed;
  }, []);

  const quantityOf = useCallback((id) => {
    const line = lines.find((l) => l.id === id);
    return line ? line.quantity : 0;
  }, [lines]);

  const totalUnits = lines.reduce((sum, l) => sum + l.quantity, 0);

  return { lines, setQuantity, remove, restore, clear, reconcile, quantityOf, totalUnits, loads };
}
