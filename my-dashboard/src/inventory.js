// Pure helpers for inventory data. No React, no fetch: easy to test.

export const OTHER_SUBCATEGORY = 'Other supplies';
export const EXPIRING_SOON_DAYS = 90;
export const ONLY_FEW_LEFT = 2;
export const PAGE_SIZE = 48;

const DAY_MS = 86400000;

const str = (v) => (v == null ? '' : String(v).trim());

// One shared collator: A–Z ignoring case, numbers in numeric order ("2" < "10").
export const collate = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare;

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function parseQuantity(value) {
  // Leading whole number, so "20 (pens)" is 20; "2.5", "1e3" and "0x10" are not counts.
  const m = str(value).match(/^(\d[\d,]*)(?:\.0*)?(?=$|[\s(])/);
  return m ? Math.trunc(Number(m[1].replace(/,/g, ''))) : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Accepts YYYY-MM-DD (the sheet's format) and M/D/YYYY. Month-year ("01/2024",
// "2024-01", "Jan 2024") and year-only ("2024") expire at the end of that period,
// so a lot is not treated as fresh a month early. Returns 'YYYY-MM-DD' or ''.
export function parseExpiry(value) {
  const s = str(value);
  const endOfMonth = (y, mo) => (mo >= 1 && mo <= 12 ? toIso(y, mo, new Date(Date.UTC(y, mo, 0)).getUTCDate()) : '');
  let my = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (my) return endOfMonth(+my[2], +my[1]);
  my = s.match(/^(\d{4})-(\d{1,2})$/);
  if (my) return endOfMonth(+my[1], +my[2]);
  my = s.match(/^([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/);
  if (my && MONTHS.includes(my[1].toLowerCase())) return endOfMonth(+my[2], MONTHS.indexOf(my[1].toLowerCase()) + 1);
  my = s.match(/^(\d{4})$/);
  if (my) return toIso(+my[1], 12, 31);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return toIso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return toIso(+m[3], +m[1], +m[2]);
  return '';
}

function toIso(y, mo, d) {
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysUntil(isoDate, today = new Date()) {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - start) / DAY_MS);
}

// 'expired' | 'soon' | null
export function expiryState(isoDate, today = new Date()) {
  const days = daysUntil(isoDate, today);
  if (days == null) return null;
  if (days < 0) return 'expired';
  if (days < EXPIRING_SOON_DAYS) return 'soon';
  return null;
}

export function formatExpiry(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

// The name sent to HQ for one sheet row: the sheet Name (or, for unnamed rows,
// what we display plus the maker), then always the lot so HQ can pull the right
// box. The backend strips the trailing " [Lot …]" before matching names.
const MAX_ITEM_NAME = 500; // server limit

export function lotSuffix(item) {
  return ` [Lot ${item.lot || '—'}, Box ${item.box || '—'}, Pallet ${item.pallet || '—'}]`;
}

function requestName(item, usableName) {
  const base = usableName || (item.manufacturer ? `${item.name} (${item.manufacturer})` : item.name);
  const suffix = lotSuffix(item);
  return base.slice(0, Math.max(0, MAX_ITEM_NAME - suffix.length)) + suffix;
}

// "Name [Lot …]" -> "Name", so one supply split over lots counts once.
export function baseRequestName(name) {
  return str(name).replace(/\s*\[Lot [^\]]*\]$/, ''); // same rule as the backend's _base_item_name
}

const PLACEHOLDER_NOTES = new Set(['na', 'n/a', 'none', 'unknown', 'tbd']);

// A display name from the first sentence of Notes, for rows with no name or type.
export function nameFromNotes(notes, max = 80) {
  let s = str(notes).replace(/\s+/g, ' ');
  // Placeholders people type into a required cell are not names.
  if (!/[a-z0-9]/i.test(s) || PLACEHOLDER_NOTES.has(s.toLowerCase().replace(/[^a-z/]/g, ''))) return '';
  const m = s.match(/^(.+?)[.!?;](\s|$)/);
  if (m) s = m[1];
  if (s === s.toUpperCase()) s = s.toLowerCase();
  s = capitalize(s.trim());
  if (s.length > max) s = `${s.slice(0, max).replace(/\s+\S*$/, '')}…`;
  return s;
}

// Maps/Sets only for anything looked up by sheet text ("constructor", "__proto__"...).
const UNITS = new Map([['x', 'x'], ['cm', 'cm'], ['mm', 'mm'], ['ml', 'mL'], ['in', 'in'], ['yd', 'yd'], ['yds', 'yds'],
  ['ft', 'ft'], ['oz', 'oz'], ['cc', 'cc'], ['mg', 'mg'], ['kg', 'kg']]);
const ACRONYMS = new Set(['REF', 'USP', 'PVC', 'ICU', 'EKG', 'ECG', 'PPE', 'CPR', 'LED', 'USB', 'EO', 'DEHP', 'HEPA']);
const SMALL_WORDS = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

// Sheet names are often SHOUTED. Mostly-uppercase names get title case for display;
// tokens with digits (18G, 4x4) and short codes (BD, IV, REF) stay as written.
export function displayName(name) {
  const s = str(name);
  const letters = s.replace(/[^A-Za-z]/g, '');
  const upper = letters.replace(/[^A-Z]/g, '').length;
  if (!letters || upper / letters.length < 0.7) return s;
  return s
    .split(' ')
    .map((token, i) => {
      const lower = token.toLowerCase();
      const bare = lower.replace(/[^a-z]/g, '');
      if (UNITS.has(bare) && bare.length === token.replace(/[^A-Za-z]/g, '').length && !/\d/.test(token)) {
        return token.replace(/[A-Za-z]+/, UNITS.get(bare));
      }
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      const letters = token.replace(/[^A-Za-z]/g, '');
      if (/\d/.test(token) || /^[A-Z]{1,2}$/.test(letters) || ACRONYMS.has(letters)) return token;
      return lower.replace(/(^|[-/(])([a-z])/g, (m, sep, c) => sep + c.toUpperCase());
    })
    .join(' ');
}

// Search text: lowercase, accents removed ("Café" is "cafe"), inch marks dropped.
const plain = (t) => str(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/["″”“]/g, '');
// ...and with sizes written one way: "4 x 4", "4×4" and 4" x 4" are all "4x4"; "0.9 %" is "0.9%";
// "10 mL" is "10ml". Applied to both the supply text and the query, so either spelling finds either.
const compact = (t) => t
  .replace(/(\d)\s*[x×]\s*(?=\d)/g, '$1x')
  .replace(/(\d)\s+%/g, '$1%')
  .replace(/(\d)\s+(?=(?:ml|mg|mcg|kg|g|l|cc|mm|cm|m|in|oz|lb|fr|ga|iu|u)(?![a-z]))/g, '$1');
// What a supply is searched against: the plain text and the compact text, side by side.
export const searchForms = (t) => { const p = plain(t); return `${p} ${compact(p)}`; };

// A query as [{t, alt}] terms. If the plain spelling finds nothing, `alt` (a trailing s/es
// removed: "syringes" -> "syringe") is tried.
export function searchTerms(query) {
  return compact(plain(query)).split(/\s+/).filter(Boolean).map((t) => {
    const stem = t.length > 3 ? t.replace(/(?:es|s)$/, '') : t;
    return { t, alt: stem !== t && stem.length > 2 ? stem : null };
  });
}

const hasTerm = (text, { t, alt }) => text.includes(t) || (alt !== null && text.includes(alt));

export function normalizeItem(raw, today = new Date()) {
  const name = str(raw['Name']);
  const general = str(raw['General']);
  const usableName = name && name.toLowerCase() !== 'unknown' ? name : '';
  const expiry = parseExpiry(raw['Date of Expiration']);
  const fromNotes = usableName || general ? '' : nameFromNotes(raw['Notes']);
  const item = {
    id: Number(raw['_sheet_row']),
    name: displayName(usableName) || capitalize(general) || fromNotes || 'Unnamed supply',
    // Nothing to identify it by now that photos are gone: kept out of the catalog.
    unlabelled: !usableName && !general && !fromNotes,
    rawName: name,
    general: capitalize(general),
    manufacturer: str(raw['Manufacturer Name']),
    category: str(raw['Category']),
    subcategory: str(raw['Subcategory']) || OTHER_SUBCATEGORY,
    lot: str(raw['Lot Number']),
    notes: str(raw['Notes']),
    quantity: parseQuantity(raw['Quantity']),
    expiry,
    expiryState: expiryState(expiry, today),
    pallet: str(raw['Pallet Number']),
    box: str(raw['Box Number']),
    needsReview: str(raw['Review']).toLowerCase() === 'yes',
  };
  item.requestName = requestName(item, usableName);
  // What the supply itself says (name, maker, lot...) ranks above matches on its category name alone.
  item.primaryText = searchForms([item.name, item.general, item.manufacturer, item.lot, item.notes].join(' '));
  item.searchText = `${item.primaryText} ${searchForms(item.subcategory)}`;
  return item;
}

export function normalizeInventory(rows, today = new Date()) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && Number.isFinite(Number(r['_sheet_row'])))
    .map((r) => normalizeItem(r, today));
}

// Merge GET /inventory/availability into items. `remaining` (stock minus open
// requests) becomes the number we show and cap at; when everything has been
// asked for, the item is on hold and keeps its sheet quantity.
export function applyAvailability(items, availability) {
  const holds = holdsFrom(availability);
  if (!Array.isArray(availability) || !availability.length) return { items, holds };
  const byRow = new Map();
  for (const a of availability) {
    if (a && Number.isFinite(Number(a.sheet_row))) byRow.set(Number(a.sheet_row), a);
  }
  const merged = items.map((item) => {
    const a = byRow.get(item.id);
    if (!a) return item;
    const remaining = Number.isInteger(a.remaining) ? a.remaining : null;
    if (remaining == null || remaining <= 0) return item;
    // The API pools `remaining` across rows with the same name; never show more than this row holds.
    const shown = item.quantity == null ? remaining : Math.min(remaining, item.quantity);
    if (shown === item.quantity) return item;
    return { ...item, quantity: shown, sheetQuantity: item.quantity };
  });
  return { items: merged, holds };
}

export function holdsFrom(availability) {
  const holds = Object.create(null);
  if (!Array.isArray(availability)) return holds;
  for (const a of availability) {
    if (a && a.availability_status === 'Requested') holds[Number(a.sheet_row)] = true;
  }
  return holds;
}

export function canRequest(item) {
  return item.expiryState !== 'expired' && item.quantity !== 0 && !item.onHold;
}

// Badges in display order. kind maps to a CSS modifier.
export function badgesFor(item, onHold) {
  const out = [];
  if (onHold) out.push({ kind: 'hold', label: 'On hold' });
  if (item.quantity != null && item.quantity > 0 && item.quantity <= ONLY_FEW_LEFT && !onHold) {
    out.push({ kind: 'low', label: 'Low stock' });
  }
  if (item.expiryState === 'soon') out.push({ kind: 'soon', label: 'Expires soon' });
  if (item.needsReview) out.push({ kind: 'info', label: 'Team check' });
  return out;
}

export function stockLabel(quantity) {
  if (quantity == null) return 'Quantity not listed';
  if (quantity === 0) return 'Out of stock';
  return `${quantity.toLocaleString('en-US')} in stock`;
}

export function matchesSearch(item, query) {
  return searchTerms(query).every((term) => hasTerm(item.searchText, term));
}

// Everything except the subcategory chip, so chip counts reflect the other filters.
export function applyBaseFilters(items, { query = '', inStockOnly = false, hideExpiring = false, holds = {} } = {}) {
  const terms = searchTerms(query);
  return items.filter((item) => {
    if (item.unlabelled) return false;
    if (inStockOnly && (!item.quantity || item.onHold || holds[item.id])) return false;
    if (hideExpiring && (item.allExpiring ?? item.expiryState)) return false;
    return terms.every((term) => hasTerm(item.searchText, term));
  });
}

// Search results in two groups: supplies whose own text matches, then the ones that matched only
// through their category or type name ("syringes" also lists the rest of Needles & Syringes).
export function rankByRelevance(items, query) {
  const terms = searchTerms(query);
  const own = [];
  const other = [];
  for (const item of items) (terms.every((term) => hasTerm(item.primaryText ?? item.searchText, term)) ? own : other).push(item);
  return { own, other };
}

export function subcategoryCounts(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.subcategory, (counts.get(item.subcategory) || 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => collate(a.name, b.name));
}

export const SORTS = {
  name: 'Name, A to Z',
  stock: 'Most in stock',
  expiry: 'Expiring soonest',
};

const byName = (a, b) => collate(a.name, b.name);

export function sortItems(items, sort = 'name') {
  const out = [...items];
  if (sort === 'name') return out.sort(byName);
  if (sort === 'expiry') {
    // Expired items can't be requested, so they go to the end.
    const expired = (i) => (i.expiryState === 'expired' ? 1 : 0);
    return out.sort((a, b) => {
      if (expired(a) !== expired(b)) return expired(a) - expired(b);
      if (!a.expiry && !b.expiry) return byName(a, b);
      if (!a.expiry) return 1;
      if (!b.expiry) return -1;
      return a.expiry.localeCompare(b.expiry) || byName(a, b);
    });
  }
  if (sort === 'stock') return out.sort((a, b) => (b.quantity ?? -1) - (a.quantity ?? -1) || byName(a, b));
  return out.sort(byName);
}

export function filterAndSort(items, filters) {
  const base = applyBaseFilters(items, filters);
  const chosen = filters.subcategory
    ? base.filter((i) => i.subcategory === filters.subcategory)
    : base;
  return { base, results: sortItems(chosen, filters.sort) };
}

// GET /requests returns one row per line; group into requests, newest first.
export const STATUS_STEPS = ['Submitted', 'Under review', 'Approved', 'Shipped'];

export function statusStep(status) {
  const s = str(status).toLowerCase();
  if (s === 'shipped') return 3;
  if (s === 'approved') return 2;
  if (s === 'under review') return 1;
  return 0;
}

// Display form of a backend status: track position, label, and whether it ended early.
export function statusInfo(status) {
  const raw = str(status);
  const s = raw.toLowerCase();
  if (s === 'denied' || s === 'cancelled' || s === 'canceled') {
    return { step: -1, label: s === 'denied' ? 'Denied' : 'Cancelled', stopped: true };
  }
  if (s === 'delivered') return { step: 4, label: 'Delivered', stopped: false };
  const step = statusStep(raw);
  return { step, label: STATUS_STEPS[step], stopped: false };
}

export function groupRequests(rows) {
  if (!Array.isArray(rows)) return [];
  const groups = new Map();
  for (const r of rows) {
    const id = str(r['Request ID']);
    if (!id) continue;
    if (!groups.has(id)) {
      groups.set(id, { id, status: str(r['Status']), timestamp: str(r['Timestamp']), lines: [], lotCount: 0 });
    }
    const name = baseRequestName(r['Item Name']) || 'Unnamed supply';
    const quantity = parseQuantity(r['Quantity Requested']);
    groups.get(id).lotCount += 1;
    const lines = groups.get(id).lines;
    const same = lines.find((l) => l.name === name);
    if (same) same.quantity = same.quantity == null || quantity == null ? null : same.quantity + quantity;
    else lines.push({ name, quantity });
  }
  return [...groups.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Catalog structure (category -> product type -> rows) ─────────────────

export function slugify(text) {
  return str(text)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'other';
}

// Slugs for a set of names, unique even when two names slugify alike
// ("Gloves & Masks" / "Gloves and Masks"): suffixes -2, -3… in sorted name order,
// so a URL doesn't change when counts do.
export function uniqueSlugs(names) {
  const out = new Map();
  const used = new Set();
  for (const name of [...new Set(names)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const base = slugify(name);
    let slug = base;
    for (let n = 2; used.has(slug); n += 1) slug = `${base}-${n}`;
    used.add(slug);
    out.set(name, slug);
  }
  return out;
}

// Rows in a table: requestable first, then by name.
export function sortRows(items) {
  return [...items].sort(byName);
}

// Group items (which already carry .type and .icon) by product type, biggest first.
export function groupByType(items) {
  const groups = new Map();
  for (const item of items) {
    const label = item.type || 'Other';
    if (!groups.has(label)) groups.set(label, { label, icon: item.icon, items: [] });
    groups.get(label).items.push(item);
  }
  const slugs = uniqueSlugs([...groups.keys()]);
  return [...groups.values()]
    .map((g) => ({ ...g, slug: slugs.get(g.label) }))
    .map((g) => ({ ...g, items: sortRows(g.items) }))
    .sort((a, b) => collate(a.label, b.label));
}

// [{name, slug, count, types}] in the same order as the chips used: biggest first, Other last.
export function buildCatalog(items) {
  const byCategory = new Map();
  const listed = items.filter((i) => !i.unlabelled);
  for (const item of listed) {
    if (!byCategory.has(item.subcategory)) byCategory.set(item.subcategory, []);
    byCategory.get(item.subcategory).push(item);
  }
  const counts = subcategoryCounts(listed);
  const slugs = uniqueSlugs(counts.map((c) => c.name));
  return counts.map(({ name, count }) => ({
    name,
    slug: slugs.get(name),
    count,
    types: groupByType(byCategory.get(name)),
  }));
}

export function unlabelledCount(items) {
  return items.filter((i) => i.unlabelled).length;
}

// Types whose own name matches every search term (at a word start).
export function matchingTypes(catalog, query) {
  const terms = plain(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out = [];
  for (const cat of catalog) {
    for (const type of cat.types) {
      // Word starts only ("gau" finds Gauze), so a one-letter search doesn't light up every tile.
      const words = plain(type.label).split(/[^a-z0-9]+/);
      if (terms.every((t) => words.some((w) => w.startsWith(t)))) out.push({ ...type, category: cat });
    }
  }
  return out.sort((a, b) => collate(a.label, b.label) || collate(a.category.name, b.category.name));
}

// ── Products: one row per Name + Maker, with its lots inside ─────────────

const norm = (t) => str(t).toLowerCase().replace(/\s+/g, ' ');

// "BD (Becton, Dickinson and Company)" and "BD" are one maker: drop any
// parenthetical, collapse punctuation. Different names stay different.
export function makerKey(maker) {
  return str(maker).split(' (')[0].toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function productKey(item) {
  return `${norm(item.rawName || item.name)}|${makerKey(item.manufacturer)}`;
}

// First expire, first out: dated lots by date, then undated, then expired.
function fefoRank(lot) {
  if (lot.expiryState === 'expired') return `2${lot.expiry}`;
  return lot.expiry ? `0${lot.expiry}` : '1';
}

// Expired lots are left out entirely: they never show, count or get requested.
export function groupProducts(items, holds = {}) {
  const byKey = new Map();
  for (const item of items) {
    if (item.unlabelled || item.expiryState === 'expired') continue;
    const key = productKey(item);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);
  }
  return [...byKey.entries()].map(([key, group]) => {
    const first = group.reduce((a, b) => (fefoRank(b) < fefoRank(a) || (fefoRank(b) === fefoRank(a) && b.id < a.id) ? b : a));
    // Lot breakdowns read A–Z by lot number, then by expiry.
    const lots = [...group].sort((a, b) => collate(a.lot, b.lot) || fefoRank(a).localeCompare(fefoRank(b)) || a.id - b.id);
    // A lot already approved to someone else is not available: it does not count and is not allocated.
    const heldIds = lots.filter((l) => holds[l.id]).map((l) => l.id);
    const everyLotHeld = heldIds.length === lots.length;
    const known = lots.filter((l) => l.quantity != null && !holds[l.id]);
    const next = lots.filter((l) => l.expiry).reduce((a, b) => (!a || b.expiry < a.expiry ? b : a), null);
    // Show the shortest spelling of the merged maker ("BD").
    const makers = lots.map((l) => l.manufacturer).filter(Boolean);
    const manufacturer = makers.reduce((a, b) => (b.length < a.length ? b : a), makers[0] || '');
    return {
      ...first,
      manufacturer,
      id: key,
      row: first.id,
      lots,
      quantity: known.length || everyLotHeld ? known.reduce((n, l) => n + l.quantity, 0) : null, // all held: 0 available
      expiry: next ? next.expiry : '',
      expiryState: next ? next.expiryState : null,
      allExpiring: lots.every((l) => l.expiryState),
      needsReview: lots.some((l) => l.needsReview),
      onHold: everyLotHeld,
      heldIds,
      searchText: [...new Set(lots.map((l) => l.searchText))].join(' '),
      primaryText: [...new Set(lots.map((l) => l.primaryText))].join(' '),
    };
  });
}

// Split a requested quantity across a product's lots, earliest expiry first,
// skipping expired lots. Returns [{item, quantity}] (one POST line per sheet row).
export function allocateFefo(product, quantity) {
  const held = new Set(product.heldIds || []);
  const usable = product.lots
    .filter((l) => l.expiryState !== 'expired' && l.quantity !== 0 && (held.size === product.lots.length || !held.has(l.id)))
    .sort((a, b) => fefoRank(a).localeCompare(fefoRank(b)) || a.id - b.id);
  const out = [];
  let left = quantity;
  for (const lot of usable) {
    if (left <= 0) break;
    if (lot.quantity == null) continue;
    const take = Math.min(left, lot.quantity);
    out.push({ item: lot, quantity: take });
    left -= take;
  }
  if (left > 0) {
    // Stock not listed (or changed since): HQ sorts it out on the first usable lot.
    const target = usable.find((l) => l.quantity == null) || usable[0] || product.lots[0];
    const hit = out.find((a) => a.item === target);
    if (hit) hit.quantity += left;
    else out.push({ item: target, quantity: left });
  }
  return out;
}

// "3 supplies" or "3 supplies (5 batches)": same wording on the confirmation and in My requests.
export function suppliesLabel(supplies, lots) {
  const base = `${supplies} ${supplies === 1 ? 'supply' : 'supplies'}`;
  return lots > supplies ? `${base} (${lots} batches)` : base;
}

export function formatMonth(isoDate) {
  if (!isoDate) return '';
  const [y, m] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
