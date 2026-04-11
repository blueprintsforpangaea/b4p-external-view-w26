import React, { useCallback, useEffect, useMemo, useState } from 'react';

const apiBase = process.env.REACT_APP_API_URL || 'http://127.0.0.1:8000';

// ── Session helpers ──────────────────────────────────────────────────────────
function getSession() {
  try {
    const s = sessionStorage.getItem('b4p_org');
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
function saveSession(org_name, org_email) {
  sessionStorage.setItem('b4p_org', JSON.stringify({ org_name, org_email }));
}
function clearSession() {
  sessionStorage.removeItem('b4p_org');
}

// ── Category/keyword constants ───────────────────────────────────────────────
const CATEGORY_KEYWORDS = {
  'Wound Care': ['bandage', 'gauze', 'wound', 'dressing', 'tape', 'suture', 'staple', 'adhesive', 'wrap', 'abdomen'],
  'Gloves & PPE': ['glove', 'mask', 'gown', 'shield', 'goggles', 'ppe', 'protective', 'nitrile', 'latex', 'n95', 'respirator'],
  'Syringes & Needles': ['syringe', 'needle', 'iv ', 'cannula', 'catheter', 'infusion', 'injection'],
  'Diagnostics': ['test', 'strip', 'monitor', 'glucose', 'diagnostic', 'culture', 'specimen', 'swab'],
  'Sterilization': ['steril', 'alcohol', 'antiseptic', 'disinfect', 'wipe', 'sanitiz', 'iodine', 'prep pad'],
  'Office Supplies': ['paper', 'pen', 'form', 'folder', 'label', 'stapler', 'printer', 'toner'],
  'Medications': ['tablet', 'capsule', 'vial', 'ampoule', 'medication', 'drug', 'pill', 'dose', 'saline', 'dextrose'],
};

const SUBCATEGORY_RULES = [
  ['Bandages & dressings', ['bandage', 'gauze', 'dressing', 'abdominal pad', 'abdomen', 'tape', 'wrap', 'adhesive strip', 'non-adherent']],
  ['Sutures & wound closure', ['suture', 'staple', 'stapler', 'closure device']],
  ['Syringes & needles', ['syringe', 'needle', 'hypodermic']],
  ['IV & infusion', [' iv', 'iv ', 'infusion', 'cannula', 'catheter', 'tubing', 'saline lock']],
  ['Gloves', ['glove', 'nitrile', 'latex', 'vinyl']],
  ['Masks & respirators', ['mask', 'n95', 'kn95', 'respirator']],
  ['Gowns & drapes', ['gown', 'drape', 'coverall']],
  ['Eye & face protection', ['goggle', 'face shield', 'shield', 'protective eyewear']],
  ['Wipes & disinfectants', ['wipe', 'disinfect', 'alcohol prep', 'antiseptic', 'sanitiz', 'chlorhexidine']],
  ['Specimen & diagnostics', ['swab', 'culture', 'specimen', 'test strip', 'glucose', 'diagnostic']],
  ['Surgical instruments & misc devices', ['forceps', 'scissor', 'clamp', 'retractor', 'medical device', 'instrument']],
  ['Office / admin', ['paper', 'pen', 'folder', 'label', 'stapler', 'printer']],
  ['Medications & fluids', ['vial', 'ampoule', 'tablet', 'capsule', 'injection drug', 'medication']],
];

const MISC_SUB = 'Misc / etc.';

// ── Helper functions (unchanged from original) ───────────────────────────────
function itemTextBlob(item) {
  return Object.values(item)
    .filter(k => k !== '_sheet_row')
    .map(v => String(v ?? '').toLowerCase())
    .join(' ');
}

function fallbackParentFromKeywords(item) {
  const text = itemTextBlob(item);
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) return cat;
  }
  return 'Other';
}

function parentCategory(item) {
  const raw = (item.Category ?? item.category ?? '').trim();
  if (raw) return raw;
  return fallbackParentFromKeywords(item);
}

function subcategory(item) {
  const text = itemTextBlob(item);
  for (const [label, keywords] of SUBCATEGORY_RULES) {
    if (keywords.some(kw => text.includes(kw))) return label;
  }
  return MISC_SUB;
}

function pickNameField(item) {
  const keys = Object.keys(item);
  const preferred = keys.find(k =>
    ['name', 'item', 'description', 'supply', 'product'].some(n => k.toLowerCase().includes(n))
  );
  return preferred || keys.find(k => k !== '_sheet_row') || 'Name';
}

function titleCaseWords(s) {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function genericLabel(item) {
  const g = String(item.General ?? item.general ?? '').trim();
  const strippedGeneral = g.replace(/^\{+|\}+$/g, '').trim();
  if (strippedGeneral && strippedGeneral.length <= 80) {
    const nice = strippedGeneral.replace(/\//g, ' / ');
    return titleCaseWords(nice) || MISC_SUB;
  }
  const nameKey = pickNameField(item);
  const n = String(item[nameKey] ?? '').trim();
  const cleaned = n.replace(/^\{+|\}+$/g, '').trim();
  const segment = cleaned.split(/[,([{]/)[0].trim();
  const words = segment.split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
  if (!words) return MISC_SUB;
  return titleCaseWords(words);
}

function parseStockQuantity(item) {
  const raw = item.Quantity ?? item.quantity ?? '';
  const n = parseInt(String(raw).replace(/,/g, ''), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function supplyStatusFromReview(item) {
  const r = String(item.Review ?? item.review ?? '').trim().toLowerCase();
  if (!r) return { label: 'Status unknown', tone: 'muted' };
  if (r.includes('shipped')) return { label: 'Shipped', tone: 'info' };
  if (r.includes('approved')) return { label: 'Approved', tone: 'ok' };
  if (r.includes('pending') || r.includes('under review') || r.includes('requested')) {
    return { label: 'Under review', tone: 'warn' };
  }
  if (r.includes('no review')) return { label: 'Available', tone: 'ok' };
  return { label: 'See warehouse notes', tone: 'muted' };
}

function paletteForKey(label) {
  let h = 0;
  const s = String(label);
  for (let i = 0; i < s.length; i += 1) h = s.charCodeAt(i) + ((h << 5) - h);
  const hue = Math.abs(h) % 360;
  return {
    bg: `hsl(${hue} 42% 90%)`,
    fg: `hsl(${hue} 38% 22%)`,
    border: `hsl(${hue} 30% 78%)`,
  };
}

function buildGroups(items, query, parentFilter, subFilter) {
  const q = query.toLowerCase().trim();
  const filtered = items.filter(item => {
    if (q && !Object.entries(item).some(([k, v]) => k !== '_sheet_row' && String(v).toLowerCase().includes(q))) {
      return false;
    }
    const p = parentCategory(item);
    if (parentFilter !== 'All' && p !== parentFilter) return false;
    const s = subcategory(item);
    if (subFilter !== 'All' && s !== subFilter) return false;
    return true;
  });

  const parents = new Map();
  for (const item of filtered) {
    const p = parentCategory(item);
    const s = subcategory(item);
    const g = genericLabel(item);
    if (!parents.has(p)) parents.set(p, new Map());
    const subs = parents.get(p);
    if (!subs.has(s)) subs.set(s, new Map());
    const generics = subs.get(s);
    if (!generics.has(g)) generics.set(g, []);
    generics.get(g).push(item);
  }

  const parentKeys = [...parents.keys()].sort((a, b) => a.localeCompare(b));
  return { parentKeys, parents };
}

function sortMiscLast(a, b) {
  if (a === MISC_SUB && b !== MISC_SUB) return 1;
  if (b === MISC_SUB && a !== MISC_SUB) return -1;
  return a.localeCompare(b);
}

// ── Availability colors ──────────────────────────────────────────────────────
const AVAIL_COLORS = {
  Available: { bg: '#E8F5E2', fg: '#2F5C12', border: '#B8D6A3' },
  Requested: { bg: '#FFF8C5', fg: '#7A6A00', border: '#E8D48B' },
  Limited:   { bg: '#FFF0E0', fg: '#8B4513', border: '#F5CBA7' },
  Shipped:   { bg: '#F0F0F0', fg: '#6B6B6B', border: '#CCCCCC' },
};

// ── Components ───────────────────────────────────────────────────────────────
function TabButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '8px 16px',
        fontSize: '14px',
        borderRadius: '8px',
        border: active ? 'none' : '0.5px solid var(--color-border-secondary)',
        background: active ? '#185FA5' : 'transparent',
        color: active ? 'white' : 'var(--color-text-secondary)',
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }) {
  const colors = {
    ok:   { bg: '#E3F1D7', fg: '#2F5C12', border: '#B8D6A3' },
    warn: { bg: '#FFF3CD', fg: '#6B4E0A', border: '#E8D48B' },
    info: { bg: '#D9EDF7', fg: '#1B4F72', border: '#A9CCE3' },
    muted: { bg: 'var(--color-background-secondary)', fg: 'var(--color-text-secondary)', border: 'var(--color-border-tertiary)' },
  };
  const c = colors[status.tone] || colors.muted;
  return (
    <span
      style={{
        fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '999px',
        background: c.bg, color: c.fg, border: `0.5px solid ${c.border}`, whiteSpace: 'nowrap',
      }}
    >
      {status.label}
    </span>
  );
}

function AvailBadge({ availInfo }) {
  if (!availInfo) return null;
  const { availability_status, requesting_org } = availInfo;
  const c = AVAIL_COLORS[availability_status] || AVAIL_COLORS.Available;
  let label = availability_status;
  if (availability_status === 'Requested' && requesting_org) {
    label = `Requested by ${requesting_org}`;
  } else if (availability_status === 'Limited') {
    label = 'Low Stock';
  }
  return (
    <span
      style={{
        fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '999px',
        background: c.bg, color: c.fg, border: `0.5px solid ${c.border}`, whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

// ── Hooks ────────────────────────────────────────────────────────────────────
function useInventory() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`${apiBase}/api/supplies`)
      .then(r => {
        if (!r.ok) throw new Error(`Server error ${r.status}`);
        return r.json();
      })
      .then(json => {
        setData(Array.isArray(json) ? json : []);
        setLoading(false);
      })
      .catch(() => {
        setError('Could not load inventory. Is the API running on port 8000?');
        setLoading(false);
      });
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

function useAvailability() {
  const [data, setData] = useState({});
  const reload = useCallback(() => {
    fetch(`${apiBase}/inventory/availability`)
      .then(r => r.ok ? r.json() : [])
      .then(rows => {
        const map = {};
        for (const row of (Array.isArray(rows) ? rows : [])) {
          if (row.sheet_row != null) map[row.sheet_row] = row;
        }
        setData(map);
      })
      .catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { data, reload };
}

function useOrgRequests(email) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    if (!email) { setRows([]); return; }
    setLoading(true);
    setError(null);
    fetch(`${apiBase}/requests?email=${encodeURIComponent(email)}`)
      .then(r => r.ok ? r.json() : [])
      .then(json => {
        setRows(Array.isArray(json) ? json : []);
        setLoading(false);
      })
      .catch(() => {
        setError('Could not load your requests.');
        setLoading(false);
      });
  }, [email]);
  useEffect(() => { reload(); }, [reload]);
  return { rows, loading, error, reload };
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState('browse');
  const { data, loading, error, reload } = useInventory();
  const { data: availMap, reload: reloadAvail } = useAvailability();

  // Org session (sessionStorage only, no auth)
  const [org, setOrg] = useState(() => getSession());
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginName, setLoginName] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginError, setLoginError] = useState('');

  // Org's past requests (My Requests tab)
  const { rows: orgReqRows, loading: orgReqLoading, error: orgReqError, reload: reloadOrgReq }
    = useOrgRequests(org?.org_email ?? null);

  // Browse filters
  const [query, setQuery] = useState('');
  const [parentFilter, setParentFilter] = useState('All');
  const [subFilter, setSubFilter] = useState('All');

  // Cart
  const [cart, setCart] = useState({});
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [cartWarning, setCartWarning] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [doneBanner, setDoneBanner] = useState(null);

  const parentOptions = useMemo(() => {
    const set = new Set(data.map(parentCategory));
    return ['All', ...[...set].sort((a, b) => a.localeCompare(b))];
  }, [data]);

  const subOptions = useMemo(() => {
    const set = new Set(data.map(subcategory));
    return ['All', ...[...set].sort(sortMiscLast)];
  }, [data]);

  const groups = useMemo(
    () => buildGroups(data, query, parentFilter, subFilter),
    [data, query, parentFilter, subFilter]
  );

  const cartCount = useMemo(
    () => Object.values(cart).reduce((n, line) => n + line.quantity, 0),
    [cart]
  );

  // ── Auth handlers ──────────────────────────────────────────────────────────
  const handleLogin = useCallback(() => {
    const name = loginName.trim();
    const email = loginEmail.trim();
    if (!name) { setLoginError('Organization name is required.'); return; }
    if (!email || !email.includes('@')) { setLoginError('A valid email address is required.'); return; }
    saveSession(name, email);
    setOrg({ org_name: name, org_email: email });
    setLoginOpen(false);
    setLoginName('');
    setLoginEmail('');
    setLoginError('');
  }, [loginName, loginEmail]);

  const handleLogout = useCallback(() => {
    clearSession();
    setOrg(null);
    setCart({});
    setCartOpen(false);
    setCheckoutOpen(false);
  }, []);

  // ── Cart handlers ──────────────────────────────────────────────────────────
  const addToCart = useCallback((item, qtyDelta = 1) => {
    const row = item._sheet_row;
    if (row == null) return;
    const stock = parseStockQuantity(item);
    if (qtyDelta > 0 && stock === 0) return;

    if (qtyDelta > 0) {
      const avail = availMap[row];
      if (avail) {
        if (avail.availability_status === 'Requested' && avail.requesting_org) {
          setCartWarning(
            `This item has been requested by ${avail.requesting_org}. HQ will confirm availability upon review.`
          );
        } else if (avail.availability_status === 'Limited') {
          setCartWarning('This item has low stock. HQ will confirm availability upon review.');
        } else {
          setCartWarning(null);
        }
      }
    }

    setCart(prev => {
      const line = prev[row] || { item, quantity: 0 };
      const nextQty = Math.max(0, line.quantity + qtyDelta);
      if (nextQty === 0) {
        const { [row]: _, ...rest } = prev;
        return rest;
      }
      let capped = nextQty;
      if (stock != null && stock > 0) capped = Math.min(capped, stock);
      return { ...prev, [row]: { item, quantity: capped } };
    });
  }, [availMap]);

  // Require login before cart actions
  const handleAddToCart = useCallback((item, qtyDelta = 1) => {
    if (!org) { setLoginOpen(true); return; }
    addToCart(item, qtyDelta);
  }, [org, addToCart]);

  const setLineQty = useCallback((row, qty) => {
    setCart(prev => {
      const line = prev[row];
      if (!line) return prev;
      const n = parseInt(String(qty), 10);
      if (!Number.isFinite(n) || n <= 0) {
        const { [row]: _, ...rest } = prev;
        return rest;
      }
      const stock = parseStockQuantity(line.item);
      let capped = n;
      if (stock != null && stock > 0) capped = Math.min(n, stock);
      return { ...prev, [row]: { ...line, quantity: capped } };
    });
  }, []);

  const clearCart = useCallback(() => setCart({}), []);

  // ── Submit org request ─────────────────────────────────────────────────────
  const submitOrgRequest = useCallback(async () => {
    if (!org) { setLoginOpen(true); return; }
    const lines = Object.values(cart);
    if (!lines.length) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${apiBase}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_name: org.org_name,
          org_email: org.org_email,
          items: lines.map(l => {
            const nk = pickNameField(l.item);
            return {
              item_name: String(l.item[nk] || ''),
              category: parentCategory(l.item),
              quantity: l.quantity,
            };
          }),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(body.detail || 'Request failed. Please try again.');
        setSubmitting(false);
        return;
      }
      setDoneBanner(`Request ${body.request_id} submitted! We'll follow up within 48 hours.`);
      clearCart();
      setCheckoutOpen(false);
      setCartWarning(null);
      reloadOrgReq();
      reloadAvail();
    } catch {
      setSubmitError('Network error — please try again.');
    }
    setSubmitting(false);
  }, [org, cart, clearCart, reloadOrgReq, reloadAvail]);

  // ── Group org requests by Request ID for My Requests tab ──────────────────
  const orgReqGroups = useMemo(() => {
    const byId = new Map();
    for (const row of orgReqRows) {
      const id = (row['Request ID'] || '').trim() || '—';
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(row);
    }
    // Sort by most recent (Request ID contains timestamp)
    const ids = [...byId.keys()].sort((a, b) => b.localeCompare(a));
    return { ids, byId };
  }, [orgReqRows]);

  // ── Loading / error states ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '320px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '32px', height: '32px',
            border: '2.5px solid var(--color-border-tertiary)',
            borderTopColor: '#378ADD', borderRadius: '50%',
            margin: '0 auto 16px', animation: 'spin 0.8s linear infinite',
          }} />
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', margin: 0 }}>Loading supplies…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px 24px', textAlign: 'center', maxWidth: '520px', margin: '0 auto' }}>
        <p style={{ color: 'var(--color-text-danger)', fontSize: '14px', marginBottom: '16px' }}>{error}</p>
        <button type="button" onClick={reload} style={{
          background: '#185FA5', color: 'white', border: 'none',
          borderRadius: '8px', padding: '8px 16px', cursor: 'pointer',
        }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '24px 20px 120px', fontFamily: 'var(--font-sans)' }}>
      {/* ── Header ── */}
      <header style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '6px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0, color: 'var(--color-text-primary)' }}>
            Blueprints supply desk
          </h1>
          {/* Login / org info */}
          {org ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                Signed in as <strong>{org.org_name}</strong>
              </span>
              <button type="button" onClick={handleLogout} style={{
                fontSize: '12px', padding: '4px 10px', borderRadius: '6px',
                border: '0.5px solid var(--color-border-secondary)',
                background: 'transparent', cursor: 'pointer', color: 'var(--color-text-secondary)',
              }}>
                Sign out
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setLoginOpen(true)} style={{
              fontSize: '13px', padding: '6px 14px', borderRadius: '8px',
              border: '0.5px solid var(--color-border-secondary)',
              background: 'var(--color-background-secondary)', cursor: 'pointer',
              fontWeight: 500,
            }}>
              Sign in
            </button>
          )}
        </div>
        <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', margin: '0 0 16px' }}>
          Browse consolidated supplies and submit a request — sign in with your org name and email to get started.
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <TabButton active={tab === 'browse'} onClick={() => setTab('browse')}>
            Browse & request
          </TabButton>
          <TabButton active={tab === 'my-requests'} onClick={() => {
            if (!org) { setLoginOpen(true); return; }
            setTab('my-requests');
            reloadOrgReq();
          }}>
            My Requests
          </TabButton>
          <div style={{ flex: 1 }} />
          {/* Cart button */}
          <button
            type="button"
            onClick={() => {
              if (!org) { setLoginOpen(true); return; }
              setCartOpen(v => !v);
            }}
            style={{
              position: 'relative', padding: '8px 14px', borderRadius: '8px',
              border: '0.5px solid var(--color-border-secondary)',
              background: 'var(--color-background-secondary)', cursor: 'pointer', fontSize: '14px',
            }}
          >
            Cart{cartCount > 0 ? ` (${cartCount})` : ''}
            {cartCount > 0 && (
              <span style={{
                position: 'absolute', top: '-6px', right: '-6px',
                background: '#C0392B', color: 'white', fontSize: '11px',
                minWidth: '18px', height: '18px', borderRadius: '999px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
              }}>
                {cartCount > 99 ? '99+' : cartCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* ── Success banner ── */}
      {doneBanner && (
        <div style={{
          marginBottom: '16px', padding: '12px 14px', borderRadius: '10px',
          background: 'var(--color-background-success)',
          border: '0.5px solid var(--color-border-success)',
          color: 'var(--color-text-success)', fontSize: '14px',
          display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center',
        }}>
          <span>{doneBanner}</span>
          <button type="button" onClick={() => setDoneBanner(null)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>
            ×
          </button>
        </div>
      )}

      {/* ── Cart add warning ── */}
      {cartWarning && (
        <div style={{
          marginBottom: '12px', padding: '10px 14px', borderRadius: '8px',
          background: '#FFF8C5', border: '0.5px solid #E8D48B', color: '#7A6A00', fontSize: '13px',
          display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center',
        }}>
          <span>{cartWarning}</span>
          <button type="button" onClick={() => setCartWarning(null)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '16px', lineHeight: 1, color: '#7A6A00' }}>
            ×
          </button>
        </div>
      )}

      {/* ══════════════════ BROWSE TAB ══════════════════ */}
      {tab === 'browse' && (
        <>
          <div style={{ position: 'relative', marginBottom: '12px' }}>
            <input
              type="search"
              placeholder="Search name, manufacturer, lot, notes…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: '14px',
                borderRadius: '8px', border: '0.5px solid var(--color-border-secondary)',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
            <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              Warehouse category
              <select value={parentFilter} onChange={e => setParentFilter(e.target.value)}
                style={{ fontSize: '13px', padding: '6px 8px', borderRadius: '6px' }}>
                {parentOptions.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              Supply type
              <select value={subFilter} onChange={e => setSubFilter(e.target.value)}
                style={{ fontSize: '13px', padding: '6px 8px', borderRadius: '6px' }}>
                {subOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>

          <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '0 0 14px' }}>
            Items are grouped by a generic label (from the <strong>General</strong> field when present). Expand a row to see each specific SKU.
          </p>

          {groups.parentKeys.length === 0 ? (
            <p style={{ color: 'var(--color-text-secondary)' }}>No items match these filters.</p>
          ) : (
            groups.parentKeys.map(parent => {
              const subs = groups.parents.get(parent);
              const subKeys = [...subs.keys()].sort(sortMiscLast);
              const pal = paletteForKey(parent);
              return (
                <section key={parent} style={{
                  marginBottom: '18px', borderRadius: '12px',
                  border: `0.5px solid ${pal.border}`, overflow: 'hidden',
                  background: 'var(--color-background-primary)',
                }}>
                  <div style={{ padding: '10px 14px', background: pal.bg, color: pal.fg, fontWeight: 600, fontSize: '15px' }}>
                    {parent}
                  </div>
                  <div style={{ padding: '10px 12px 14px' }}>
                    {subKeys.map(sub => {
                      const generics = subs.get(sub);
                      const genKeys = [...generics.keys()].sort((a, b) => a.localeCompare(b));
                      return (
                        <div key={sub} style={{ marginBottom: '12px' }}>
                          <div style={{
                            fontSize: '12px', fontWeight: 600, letterSpacing: '0.04em',
                            textTransform: 'uppercase', color: 'var(--color-text-secondary)', margin: '6px 4px 8px',
                          }}>
                            {sub}
                          </div>
                          {genKeys.map(gen => {
                            const items = generics.get(gen);
                            const totalStock = items.reduce((sum, it) => sum + (parseStockQuantity(it) || 0), 0);
                            return (
                              <details key={`${sub}::${gen}`} style={{
                                border: '0.5px solid var(--color-border-tertiary)',
                                borderRadius: '10px', marginBottom: '8px',
                                background: 'var(--color-background-secondary)',
                              }}>
                                <summary style={{
                                  cursor: 'pointer', listStyle: 'none', padding: '10px 12px',
                                  display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center',
                                }}>
                                  <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', flex: '1 1 200px' }}>{gen}</span>
                                  <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                    {items.length} listing{items.length !== 1 ? 's' : ''}
                                    {totalStock > 0 ? ` · ~${totalStock} units in view` : ''}
                                  </span>
                                </summary>
                                <div style={{ padding: '0 8px 10px' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                    <thead>
                                      <tr style={{ color: 'var(--color-text-secondary)', textAlign: 'left' }}>
                                        <th style={{ padding: '6px 6px' }}>Item</th>
                                        <th style={{ padding: '6px 6px', width: '120px' }}>Manufacturer</th>
                                        <th style={{ padding: '6px 6px', width: '60px' }}>Qty</th>
                                        <th style={{ padding: '6px 6px', width: '90px' }}>Status</th>
                                        <th style={{ padding: '6px 6px', width: '140px' }}>Availability</th>
                                        <th style={{ padding: '6px 6px', width: '100px' }} />
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {items.map(it => {
                                        const nk = pickNameField(it);
                                        const st = parseStockQuantity(it);
                                        const status = supplyStatusFromReview(it);
                                        const row = it._sheet_row;
                                        const avail = availMap[row];
                                        const inCart = cart[row]?.quantity || 0;
                                        return (
                                          <tr key={row} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                                            <td style={{ padding: '8px 6px', verticalAlign: 'top' }}>
                                              <div style={{ fontWeight: 500 }}>{it[nk] || '—'}</div>
                                              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                                Lot {it['Lot Number'] || '—'} · Box {it['Box Number'] || '—'}
                                              </div>
                                            </td>
                                            <td style={{ padding: '8px 6px', color: 'var(--color-text-secondary)', verticalAlign: 'top' }}>
                                              {it['Manufacturer Name'] || '—'}
                                            </td>
                                            <td style={{ padding: '8px 6px', verticalAlign: 'top' }}>{st != null ? st : '—'}</td>
                                            <td style={{ padding: '8px 6px', verticalAlign: 'top' }}>
                                              <StatusPill status={status} />
                                            </td>
                                            <td style={{ padding: '8px 6px', verticalAlign: 'top' }}>
                                              <AvailBadge availInfo={avail} />
                                            </td>
                                            <td style={{ padding: '8px 6px', verticalAlign: 'top', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                              <button type="button" onClick={() => handleAddToCart(it, -1)}
                                                disabled={inCart <= 0}
                                                style={{
                                                  padding: '4px 8px', marginRight: '4px', borderRadius: '6px',
                                                  border: '0.5px solid var(--color-border-secondary)',
                                                  background: 'var(--color-background-primary)',
                                                  cursor: inCart <= 0 ? 'default' : 'pointer',
                                                }}>
                                                −
                                              </button>
                                              <button type="button" onClick={() => handleAddToCart(it, 1)}
                                                style={{
                                                  padding: '4px 10px', borderRadius: '6px', border: 'none',
                                                  background: '#185FA5', color: 'white', cursor: 'pointer',
                                                }}>
                                                Add
                                              </button>
                                              {inCart > 0 && (
                                                <div style={{ fontSize: '12px', marginTop: '4px', color: 'var(--color-text-secondary)' }}>
                                                  In cart: {inCart}
                                                </div>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </details>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}
        </>
      )}

      {/* ══════════════════ MY REQUESTS TAB ══════════════════ */}
      {tab === 'my-requests' && (
        <div>
          {!org ? (
            <div style={{ textAlign: 'center', padding: '40px 24px' }}>
              <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
                Sign in to view your past requests and live status updates.
              </p>
              <button type="button" onClick={() => setLoginOpen(true)} style={{
                background: '#185FA5', color: 'white', border: 'none',
                borderRadius: '8px', padding: '9px 18px', cursor: 'pointer', fontWeight: 600,
              }}>
                Sign in
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)', flex: 1 }}>
                  Requests submitted by <strong>{org.org_name}</strong> ({org.org_email})
                </p>
                <button type="button" onClick={reloadOrgReq} style={{
                  padding: '8px 12px', borderRadius: '8px',
                  border: '0.5px solid var(--color-border-secondary)',
                  background: 'var(--color-background-secondary)', cursor: 'pointer',
                }}>
                  Refresh
                </button>
              </div>
              {orgReqLoading && <p style={{ color: 'var(--color-text-secondary)' }}>Loading requests…</p>}
              {orgReqError && <p style={{ color: 'var(--color-text-danger)' }}>{orgReqError}</p>}
              {!orgReqLoading && !orgReqError && orgReqGroups.ids.length === 0 && (
                <p style={{ color: 'var(--color-text-secondary)' }}>No requests yet. Browse the inventory and add items to your cart.</p>
              )}
              {!orgReqLoading && !orgReqError && orgReqGroups.ids.map(reqId => {
                const rows = orgReqGroups.byId.get(reqId);
                const firstRow = rows[0];
                const ts = firstRow['Timestamp'] || '';
                const overallStatus = firstRow['Status'] || 'Under Review';
                const statusTone = overallStatus === 'Shipped' ? 'info'
                  : overallStatus === 'Approved' ? 'ok'
                  : 'warn';
                return (
                  <details key={reqId} open style={{
                    marginBottom: '12px', border: '0.5px solid var(--color-border-tertiary)',
                    borderRadius: '10px', padding: '10px 14px',
                    background: 'var(--color-background-secondary)',
                  }}>
                    <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: '14px', flex: '1 1 180px' }}>{reqId}</span>
                      <StatusPill status={{ label: overallStatus, tone: statusTone }} />
                      {ts && (
                        <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                          {new Date(ts).toLocaleString()}
                        </span>
                      )}
                      <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                        {rows.length} item{rows.length !== 1 ? 's' : ''}
                      </span>
                    </summary>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginTop: '10px' }}>
                      <thead>
                        <tr style={{ color: 'var(--color-text-secondary)', textAlign: 'left' }}>
                          <th style={{ padding: '4px 6px' }}>Item</th>
                          <th style={{ padding: '4px 6px', width: '140px' }}>Category</th>
                          <th style={{ padding: '4px 6px', width: '60px' }}>Qty</th>
                          <th style={{ padding: '4px 6px', width: '110px' }}>Status</th>
                          {rows.some(r => r['Review Flag'] === 'TRUE') && (
                            <th style={{ padding: '4px 6px', width: '90px' }}>Flag</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, idx) => {
                          const rowStatus = row['Status'] || 'Under Review';
                          const rowTone = rowStatus === 'Shipped' ? 'info'
                            : rowStatus === 'Approved' ? 'ok' : 'warn';
                          return (
                            <tr key={idx} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                              <td style={{ padding: '6px 6px', fontWeight: 500 }}>{row['Item Name'] || '—'}</td>
                              <td style={{ padding: '6px 6px', color: 'var(--color-text-secondary)' }}>{row['Category'] || '—'}</td>
                              <td style={{ padding: '6px 6px' }}>{row['Quantity Requested'] || '—'}</td>
                              <td style={{ padding: '6px 6px' }}>
                                <StatusPill status={{ label: rowStatus, tone: rowTone }} />
                              </td>
                              {rows.some(r => r['Review Flag'] === 'TRUE') && (
                                <td style={{ padding: '6px 6px' }}>
                                  {row['Review Flag'] === 'TRUE' && (
                                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#8B0000' }}>Review needed</span>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </details>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ══════════════════ CART SIDEBAR ══════════════════ */}
      {cartOpen && (
        <aside style={{
          position: 'fixed', right: 16, top: 72, width: 360,
          maxWidth: 'calc(100vw - 32px)', maxHeight: 'min(75vh, 560px)',
          overflow: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
          borderRadius: '12px', border: '0.5px solid var(--color-border-tertiary)',
          background: 'var(--color-background-primary)', padding: '14px', zIndex: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '16px', flex: 1 }}>Cart</h2>
            <button type="button" onClick={() => setCartOpen(false)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '20px' }}>
              ×
            </button>
          </div>
          {cartCount === 0 ? (
            <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>Nothing here yet — add from Browse.</p>
          ) : (
            <>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
                {Object.entries(cart).map(([row, line]) => {
                  const nk = pickNameField(line.item);
                  const avail = availMap[Number(row)];
                  const cat = parentCategory(line.item);
                  return (
                    <li key={row} style={{
                      padding: '10px 0', borderBottom: '0.5px solid var(--color-border-tertiary)', fontSize: '13px',
                    }}>
                      <div style={{ fontWeight: 500, marginBottom: '2px' }}>{line.item[nk]}</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
                        {cat}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                          Qty
                          <input type="number" min={1} value={line.quantity}
                            onChange={e => setLineQty(Number(row), e.target.value)}
                            style={{ width: '56px', marginLeft: '6px', padding: '4px 6px' }}
                          />
                        </label>
                        {avail && <AvailBadge availInfo={avail} />}
                        <button type="button" onClick={() => setLineQty(Number(row), 0)}
                          style={{ marginLeft: 'auto', fontSize: '12px', background: 'none', border: 'none', color: '#A93226', cursor: 'pointer' }}>
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <button type="button" onClick={() => { setCheckoutOpen(true); setSubmitError(null); }}
                style={{
                  width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
                  background: '#185FA5', color: 'white', fontWeight: 600, cursor: 'pointer',
                }}>
                Checkout
              </button>
            </>
          )}
        </aside>
      )}

      {/* ══════════════════ CHECKOUT MODAL ══════════════════ */}
      {checkoutOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30, padding: '16px',
        }}>
          <div style={{
            width: 'min(520px, 100%)', background: 'var(--color-background-primary)',
            borderRadius: '12px', padding: '22px', boxShadow: '0 16px 60px rgba(0,0,0,0.2)',
            maxHeight: 'calc(100vh - 32px)', overflow: 'auto',
          }}>
            <h3 style={{ margin: '0 0 6px' }}>Confirm your request</h3>
            <p style={{ margin: '0 0 14px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
              Please review your items below. Once submitted, Blueprints HQ will follow up within 48 hours.
            </p>

            {/* Org info */}
            <div style={{
              padding: '10px 12px', borderRadius: '8px', marginBottom: '14px',
              background: 'var(--color-background-secondary)',
              border: '0.5px solid var(--color-border-tertiary)', fontSize: '13px',
            }}>
              <div><strong>Organization:</strong> {org?.org_name}</div>
              <div style={{ color: 'var(--color-text-secondary)' }}>{org?.org_email}</div>
            </div>

            {/* Order summary */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                Items ({cartCount} total)
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ color: 'var(--color-text-secondary)', textAlign: 'left' }}>
                    <th style={{ padding: '4px 6px', fontWeight: 500 }}>Item</th>
                    <th style={{ padding: '4px 6px', fontWeight: 500, width: '120px' }}>Category</th>
                    <th style={{ padding: '4px 6px', fontWeight: 500, width: '50px' }}>Qty</th>
                    <th style={{ padding: '4px 6px', fontWeight: 500, width: '120px' }}>Availability</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(cart).map(([row, line]) => {
                    const nk = pickNameField(line.item);
                    const cat = parentCategory(line.item);
                    const avail = availMap[Number(row)];
                    return (
                      <tr key={row} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                        <td style={{ padding: '6px 6px', fontWeight: 500 }}>{line.item[nk] || '—'}</td>
                        <td style={{ padding: '6px 6px', color: 'var(--color-text-secondary)' }}>{cat}</td>
                        <td style={{ padding: '6px 6px' }}>{line.quantity}</td>
                        <td style={{ padding: '6px 6px' }}><AvailBadge availInfo={avail} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {submitError && (
              <p style={{ color: '#A93226', fontSize: '13px', margin: '0 0 10px' }}>{submitError}</p>
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setCheckoutOpen(false)} style={{
                padding: '9px 14px', borderRadius: '8px',
                border: '0.5px solid var(--color-border-secondary)',
                background: 'transparent', cursor: 'pointer',
              }}>
                Cancel
              </button>
              <button type="button" disabled={submitting || cartCount === 0} onClick={submitOrgRequest}
                style={{
                  padding: '9px 16px', borderRadius: '8px', border: 'none',
                  background: submitting || cartCount === 0 ? '#B0B0B0' : '#185FA5',
                  color: 'white', fontWeight: 600,
                  cursor: submitting || cartCount === 0 ? 'default' : 'pointer',
                }}>
                {submitting ? 'Submitting…' : 'Submit request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════ LOGIN MODAL ══════════════════ */}
      {loginOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40, padding: '16px',
        }}>
          <div style={{
            width: 'min(420px, 100%)', background: 'var(--color-background-primary)',
            borderRadius: '12px', padding: '24px', boxShadow: '0 16px 60px rgba(0,0,0,0.2)',
          }}>
            <h3 style={{ margin: '0 0 6px' }}>Sign in to request supplies</h3>
            <p style={{ margin: '0 0 18px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
              Enter your organization name and email. This is stored only for your current session.
            </p>

            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              Organization name
            </label>
            <input
              value={loginName}
              onChange={e => setLoginName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="e.g. Riverside Free Clinic"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 12px', marginBottom: '12px',
                borderRadius: '8px', border: '0.5px solid var(--color-border-secondary)', fontSize: '14px',
              }}
            />

            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              Email address
            </label>
            <input
              type="email"
              value={loginEmail}
              onChange={e => setLoginEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="e.g. contact@clinic.org"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 12px', marginBottom: '12px',
                borderRadius: '8px', border: '0.5px solid var(--color-border-secondary)', fontSize: '14px',
              }}
            />

            {loginError && (
              <p style={{ color: '#A93226', fontSize: '13px', margin: '0 0 10px' }}>{loginError}</p>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { setLoginOpen(false); setLoginError(''); }}
                style={{
                  padding: '9px 14px', borderRadius: '8px',
                  border: '0.5px solid var(--color-border-secondary)',
                  background: 'transparent', cursor: 'pointer',
                }}>
                Cancel
              </button>
              <button type="button" onClick={handleLogin}
                style={{
                  padding: '9px 18px', borderRadius: '8px', border: 'none',
                  background: '#185FA5', color: 'white', fontWeight: 600, cursor: 'pointer',
                }}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
