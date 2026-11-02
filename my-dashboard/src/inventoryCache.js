import { readJSON, writeJSON } from './storage';

// Last good inventory + availability, so repeat visits render instantly
// (and survive Render's cold start) while a fresh copy loads.
export const INVENTORY_KEY = 'b4p.inventory.v1';
const VERSION = 2; // bump when the saved shape or row handling changes
const DROP = new Set(['Image URL']); // photos are not shown; keep the cache small

const isRow = (r) => r !== null && typeof r === 'object' && !Array.isArray(r);

// Anything unexpected (old shape, other version, tampering) is treated as no cache.
export function readInventoryCache() {
  const c = readJSON(INVENTORY_KEY, null);
  if (!isRow(c) || c.v !== VERSION || !Number.isFinite(c.savedAt) || !Array.isArray(c.rows) || !c.rows.every(isRow)) {
    return null;
  }
  return {
    supplies: c.rows,
    availability: Array.isArray(c.availability) ? c.availability.filter(isRow) : null,
    savedAt: c.savedAt,
  };
}

export function clearInventoryCache() {
  try {
    window.localStorage.removeItem(INVENTORY_KEY);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

export function writeInventoryCache({ supplies, availability }) {
  const rows = (supplies || []).filter(isRow).map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) if (!DROP.has(k)) out[k] = v;
    return out;
  });
  const avail = Array.isArray(availability)
    ? availability.filter(isRow).map((a) => ({
      sheet_row: a.sheet_row, availability_status: a.availability_status, remaining: a.remaining,
    }))
    : null;
  writeJSON(INVENTORY_KEY, { v: VERSION, savedAt: Date.now(), rows, availability: avail });
}
