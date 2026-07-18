import React, { useCallback, useEffect, useMemo, useState } from 'react';
import bloopsLogo from './assets/bloops-logo.avif';

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
  const exactPreferred = [
    'Name',
    'name',
    'Item Name',
    'item_name',
    'Item',
    'item',
    'Description',
    'description',
  ];
  const exact = exactPreferred.find(k => keys.includes(k));
  if (exact) return exact;

  const preferred = keys.find(k => {
    const lower = k.toLowerCase();
    if (lower.includes('manufacturer')) return false;
    return ['name', 'item', 'description', 'supply', 'product'].some(n => lower.includes(n));
  });
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

const PRIMARY_BUTTON = {
  background: 'linear-gradient(180deg, var(--accent-blue), var(--accent-blue-dark))',
  color: '#fff',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: '999px',
  padding: '10px 18px',
  cursor: 'pointer',
  fontWeight: 600,
  letterSpacing: '0.01em',
  boxShadow: '0 8px 18px rgba(10, 132, 255, 0.24)',
};

const SECONDARY_BUTTON = {
  background: 'var(--color-background-primary)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-secondary)',
  borderRadius: '999px',
  padding: '10px 16px',
  cursor: 'pointer',
  fontWeight: 600,
};

const PANEL_STYLE = {
  background: 'var(--color-background-primary)',
  border: '1px solid var(--color-border-secondary)',
  borderRadius: '24px',
  boxShadow: 'var(--color-panel-shadow)',
};

// ── Components ───────────────────────────────────────────────────────────────
function TabButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '11px 18px',
        fontSize: '13px',
        borderRadius: '999px',
        border: '1px solid var(--color-border-secondary)',
        background: active ? 'rgba(10,132,255,0.12)' : 'rgba(255,255,255,0.65)',
        color: active ? 'var(--accent-blue-dark)' : 'var(--color-text-secondary)',
        fontWeight: 600,
        cursor: 'pointer',
        boxShadow: active ? '0 8px 18px rgba(10,132,255,0.12)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }) {
  const colors = {
    ok:   { bg: '#E3F1D7', fg: '#2F5C12', border: '#2F5C12' },
    warn: { bg: '#FFF3CD', fg: '#6B4E0A', border: '#6B4E0A' },
    info: { bg: '#D9EDF7', fg: '#1B4F72', border: '#1B4F72' },
    muted: { bg: 'var(--color-background-secondary)', fg: 'var(--color-text-secondary)', border: 'var(--color-border-secondary)' },
  };
  const c = colors[status.tone] || colors.muted;
  return (
    <span
      style={{
        fontSize: '11px', fontWeight: 600, padding: '5px 10px', borderRadius: '999px',
        background: c.bg, color: c.fg, border: `1px solid ${c.border}`, whiteSpace: 'nowrap',
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
        fontSize: '11px', fontWeight: 600, padding: '5px 10px', borderRadius: '999px',
        background: c.bg, color: c.fg, border: `1px solid ${c.border}`, whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function MetricCard({ label, value, accent }) {
  return (
    <div style={{
      ...PANEL_STYLE,
      minHeight: '108px',
      padding: '18px 18px 20px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      background: accent,
    }}>
      <span style={{
        fontSize: '12px',
        color: 'var(--color-text-secondary)',
        fontWeight: 600,
      }}
      >
        {label}
      </span>
      <span style={{
        fontFamily: 'var(--font-display)',
        fontSize: '32px',
        lineHeight: 1,
        fontWeight: 700,
      }}
      >
        {value}
      </span>
    </div>
  );
}

function BrandLogo() {
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '8px 10px',
      borderRadius: '18px',
      background: 'rgba(255, 255, 255, 0.92)',
    }}>
      <img
        src={bloopsLogo}
        alt="Blueprints for Pangaea"
        style={{
          height: '64px',
          width: 'auto',
          objectFit: 'contain',
          display: 'block',
        }}
      />
    </div>
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
  const [quantityToAdd, setQuantityToAdd] = useState({});

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

  const summaryCounts = useMemo(() => {
    const requested = Object.values(availMap).filter(row => row.availability_status === 'Requested').length;
    const limited = Object.values(availMap).filter(row => row.availability_status === 'Limited').length;
    return {
      totalItems: data.length,
      categories: Math.max(0, parentOptions.length - 1),
      requested,
      limited,
    };
  }, [availMap, data.length, parentOptions.length]);

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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch(`${apiBase}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          org_name: org.org_name,
          org_email: org.org_email,
          items: lines.map(l => {
            const nk = pickNameField(l.item);
            return {
              item_name: String(l.item[nk] || ''),
              category: parentCategory(l.item),
              quantity: l.quantity,
              sheet_row: Number(l.item._sheet_row),
            };
          }),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(body.detail || 'Request failed. Please try again.');
        return;
      }
      setDoneBanner(`Request ${body.request_id} submitted! We'll follow up within 48 hours.`);
      clearCart();
      setCheckoutOpen(false);
      setCartWarning(null);
      reloadOrgReq();
      reloadAvail();
    } catch (err) {
      if (err.name === 'AbortError') {
        setSubmitError('Request timed out — the server may be starting up. Please try again in 30 seconds.');
      } else {
        setSubmitError('Network error — please try again.');
      }
    } finally {
      clearTimeout(timeout);
      setSubmitting(false);
    }
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
    <div style={{ position: 'relative', overflow: 'hidden', minHeight: '100vh' }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        background: [
          'radial-gradient(circle at 18% 0%, rgba(10,132,255,0.08) 0 10%, transparent 10.5%)',
          'radial-gradient(circle at 85% 12%, rgba(255,255,255,0.42) 0 18%, transparent 18.4%)',
        ].join(', '),
      }}
      />
      <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '32px 20px 120px', position: 'relative', zIndex: 1 }}>
        <section style={{
          ...PANEL_STYLE,
          padding: '28px',
          marginBottom: '22px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: '18px',
          alignItems: 'stretch',
          background: 'rgba(255,255,255,0.78)',
          backdropFilter: 'blur(16px)',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
              <BrandLogo />
              {org ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--color-text-secondary)' }}>
                    Signed in as <strong>{org.org_name}</strong>
                  </span>
                  <button type="button" onClick={handleLogout} style={{ ...SECONDARY_BUTTON, padding: '8px 14px', fontSize: '12px' }}>
                    Sign out
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setLoginOpen(true)} style={{ ...SECONDARY_BUTTON, fontSize: '12px' }}>
                  Sign in
                </button>
              )}
            </div>

            <div style={{ marginTop: '16px', maxWidth: '760px' }}>
              <div style={{ fontSize: '40px', lineHeight: 1.08, fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '-0.03em' }}>
                Medical Supplies Request System
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginTop: '24px' }}>
              <TabButton active={tab === 'browse'} onClick={() => setTab('browse')}>
                Browse & request
              </TabButton>
              <TabButton active={tab === 'my-requests'} onClick={() => {
                if (!org) { setLoginOpen(true); return; }
                setTab('my-requests');
                reloadOrgReq();
              }}
              >
                My Requests
              </TabButton>
              <button
                type="button"
                onClick={() => {
                  if (!org) { setLoginOpen(true); return; }
                  setCartOpen(v => !v);
                }}
                style={{ ...PRIMARY_BUTTON, position: 'relative' }}
              >
                Cart{cartCount > 0 ? ` (${cartCount})` : ''}
                {cartCount > 0 && (
                  <span style={{
                    position: 'absolute', top: '-10px', right: '-6px',
                    background: 'var(--bauhaus-red)', color: 'white', fontSize: '11px',
                    minWidth: '22px', height: '22px', borderRadius: '999px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '2px solid var(--color-border-secondary)',
                  }}
                  >
                    {cartCount > 99 ? '99+' : cartCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '16px', marginBottom: '20px' }}>
          <MetricCard label="Inventory rows" value={summaryCounts.totalItems} accent="rgba(255,255,255,0.86)" />
          <MetricCard label="Warehouse categories" value={summaryCounts.categories} accent="rgba(248,250,252,0.92)" />
          <MetricCard label="Items requested" value={summaryCounts.requested} accent="rgba(255,250,219,0.92)" />
          <MetricCard label="Low stock rows" value={summaryCounts.limited} accent="rgba(255,244,235,0.92)" />
        </section>

        {doneBanner && (
          <div style={{
            ...PANEL_STYLE,
            marginBottom: '16px',
            padding: '14px 18px',
            background: 'var(--color-background-success)',
            borderColor: 'var(--color-border-success)',
            color: 'var(--color-text-success)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: '12px',
            alignItems: 'center',
            borderRadius: '24px',
          }}>
            <span>{doneBanner}</span>
            <button type="button" onClick={() => setDoneBanner(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '22px', lineHeight: 1 }}>
              ×
            </button>
          </div>
        )}

        {cartWarning && (
          <div style={{
            ...PANEL_STYLE,
            marginBottom: '16px',
            padding: '14px 18px',
            background: '#FFF8C5',
            color: '#7A6A00',
            display: 'flex',
            justifyContent: 'space-between',
            gap: '12px',
            alignItems: 'center',
            borderRadius: '24px',
          }}>
            <span>{cartWarning}</span>
            <button type="button" onClick={() => setCartWarning(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '20px', lineHeight: 1, color: '#7A6A00' }}>
              ×
            </button>
          </div>
        )}

        {tab === 'browse' && (
          <>
            <section style={{ ...PANEL_STYLE, padding: '22px', marginBottom: '18px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', alignItems: 'end' }}>
                <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Search
                  <input
                    type="search"
                    placeholder="Search name, manufacturer, lot, notes…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    style={{
                      width: '100%',
                      marginTop: '8px',
                      padding: '14px 16px',
                      fontSize: '15px',
                      borderRadius: '16px',
                      border: '1px solid var(--color-border-secondary)',
                      background: 'rgba(255,255,255,0.82)',
                    }}
                  />
                </label>
                <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Warehouse category
                  <select value={parentFilter} onChange={e => setParentFilter(e.target.value)} style={{ width: '100%', marginTop: '8px', padding: '14px 16px', fontSize: '14px', borderRadius: '16px', border: '1px solid var(--color-border-secondary)', background: 'rgba(255,255,255,0.82)' }}>
                    {parentOptions.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Supply type
                  <select value={subFilter} onChange={e => setSubFilter(e.target.value)} style={{ width: '100%', marginTop: '8px', padding: '14px 16px', fontSize: '14px', borderRadius: '16px', border: '1px solid var(--color-border-secondary)', background: 'rgba(255,255,255,0.82)' }}>
                    {subOptions.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '14px 0 0', maxWidth: '760px' }}>
                Items stay grouped by the existing generic label logic. Expand a tile to inspect each row. Requested rows are highlighted in yellow and show who requested them.
              </p>
            </section>

            {groups.parentKeys.length === 0 ? (
              <div style={{ ...PANEL_STYLE, padding: '32px', textAlign: 'center' }}>
                <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>No items match these filters.</p>
              </div>
            ) : (
              groups.parentKeys.map(parent => {
                const subs = groups.parents.get(parent);
                const subKeys = [...subs.keys()].sort(sortMiscLast);
                return (
                  <section key={parent} style={{
                    ...PANEL_STYLE,
                    marginBottom: '18px',
                    overflow: 'hidden',
                    background: 'rgba(255, 255, 255, 0.82)',
                  }}>
                    <div style={{
                      padding: '18px 20px',
                      background: 'rgba(248,250,252,0.92)',
                      color: 'var(--color-text-primary)',
                      fontWeight: 700,
                      fontSize: '22px',
                      borderBottom: '1px solid var(--color-border-secondary)',
                    }}
                    >
                      {parent}
                    </div>
                    <div style={{ padding: '16px' }}>
                      {subKeys.map(sub => {
                        const generics = subs.get(sub);
                        const genKeys = [...generics.keys()].sort((a, b) => a.localeCompare(b));
                        return (
                          <div key={sub} style={{ marginBottom: '16px' }}>
                            <div style={{
                              fontSize: '12px',
                              fontWeight: 600,
                              letterSpacing: '0.12em',
                              textTransform: 'uppercase',
                              color: 'var(--color-text-secondary)',
                              margin: '4px 6px 10px',
                            }}
                            >
                              {sub}
                            </div>
                            {genKeys.map(gen => {
                              const items = generics.get(gen);
                              const totalStock = items.reduce((sum, it) => sum + (parseStockQuantity(it) || 0), 0);
                              return (
                                <details key={`${sub}::${gen}`} style={{
                                  border: '1px solid var(--color-border-secondary)',
                                  borderRadius: '18px',
                                  marginBottom: '10px',
                                  background: 'rgba(255,255,255,0.88)',
                                  overflow: 'hidden',
                                }}>
                                  <summary style={{
                                    cursor: 'pointer',
                                    listStyle: 'none',
                                    padding: '16px 18px',
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '8px',
                                    alignItems: 'center',
                                    background: 'rgba(248,250,252,0.95)',
                                  }}>
                                    <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', flex: '1 1 220px', fontSize: '17px' }}>{gen}</span>
                                    <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                      {items.length} listing{items.length !== 1 ? 's' : ''}
                                      {totalStock > 0 ? ` · ~${totalStock} units in view` : ''}
                                    </span>
                                  </summary>
                                  <div style={{ padding: '2px 10px 14px', overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '900px' }}>
                                      <thead>
                                        <tr style={{ color: 'var(--color-text-secondary)', textAlign: 'left', fontSize: '12px', borderBottom: '1px solid var(--color-border-tertiary)' }}>
                                          <th style={{ padding: '12px 10px' }}>Item</th>
                                          <th style={{ padding: '12px 10px', width: '140px' }}>Manufacturer</th>
                                          <th style={{ padding: '12px 10px', width: '70px' }}>Qty</th>
                                          <th style={{ padding: '12px 10px', width: '110px' }}>Status</th>
                                          <th style={{ padding: '12px 10px', width: '150px' }}>Availability</th>
                                          <th style={{ padding: '12px 10px', width: '180px' }}>Requested by</th>
                                          <th style={{ padding: '12px 10px', width: '130px' }} />
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
                                          const isRequested = avail?.availability_status === 'Requested';
                                          return (
                                            <tr key={row} style={{
                                              background: isRequested ? 'var(--requested-row)' : 'transparent',
                                              borderBottom: '1px solid var(--color-border-tertiary)',
                                            }}
                                            >
                                              <td style={{ padding: '14px 10px', verticalAlign: 'top' }}>
                                                <div style={{ fontWeight: 600, fontSize: '14px' }}>{it[nk] || '—'}</div>
                                                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                                                  Lot {it['Lot Number'] || '—'} · Box {it['Box Number'] || '—'}
                                                </div>
                                              </td>
                                              <td style={{ padding: '14px 10px', color: 'var(--color-text-secondary)', verticalAlign: 'top' }}>
                                                {it['Manufacturer Name'] || '—'}
                                              </td>
                                              <td style={{ padding: '14px 10px', verticalAlign: 'top' }}>{st != null ? st : '—'}</td>
                                              <td style={{ padding: '14px 10px', verticalAlign: 'top' }}>
                                                <StatusPill status={status} />
                                              </td>
                                              <td style={{ padding: '14px 10px', verticalAlign: 'top' }}>
                                                <AvailBadge availInfo={avail} />
                                              </td>
                                              <td style={{ padding: '14px 10px', verticalAlign: 'top', fontWeight: 600, color: isRequested ? '#7A6A00' : 'var(--color-text-secondary)' }}>
                                                {isRequested && avail.requesting_org ? `Requested by: ${avail.requesting_org}` : '—'}
                                              </td>
                                              <td style={{ padding: '14px 10px', verticalAlign: 'top', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                <button
                                                  type="button"
                                                  onClick={() => handleAddToCart(it, -1)}
                                                  disabled={inCart <= 0}
                                                  style={{
                                                    ...SECONDARY_BUTTON,
                                                    padding: '7px 11px',
                                                    marginRight: '6px',
                                                    opacity: inCart <= 0 ? 0.5 : 1,
                                                    cursor: inCart <= 0 ? 'default' : 'pointer',
                                                  }}
                                                >
                                                  −
                                                </button>
                                                <input 
                                                  type="number" 
                                                  min={1} 
                                                  max={st} 
                                                  value={quantityToAdd[row] ?? 1} 
                                                  onChange={e => {
                                                    setQuantityToAdd(previousValues => ({
                                                      ...previousValues,
                                                      [row]: Math.max(1, Number(e.target.value) || 1),
                                                    }))
                                                  }}
                                                  style={{ width: '64px', marginRight: '6px', padding: '6px 8px', borderRadius: '12px', border: '1px solid var(--color-border-secondary)', background: 'white' }} />
                                                <button 
                                                  type="button" 
                                                  onClick={() => {
                                                      handleAddToCart(it, quantityToAdd[row] ?? 1);
                                                      setQuantityToAdd(previousValues => {
                                                        const newValues = {...previousValues};
                                                        delete newValues[row];
                                                        return newValues;
                                                      })
                                                    }
                                                  } 
                                                  style={{ ...PRIMARY_BUTTON, padding: '7px 14px', boxShadow: 'none' }}>
                                                  Add
                                                </button>
                                                {inCart > 0 && (
                                                  <div style={{ fontSize: '12px', marginTop: '6px', color: 'var(--color-text-secondary)' }}>
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

        {tab === 'my-requests' && (
          <div style={{ ...PANEL_STYLE, padding: '22px' }}>
            {!org ? (
              <div style={{ textAlign: 'center', padding: '40px 24px' }}>
                <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
                  Sign in to view your past requests and live status updates.
                </p>
                <button type="button" onClick={() => setLoginOpen(true)} style={PRIMARY_BUTTON}>
                  Sign in
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                  <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)', flex: 1 }}>
                    Requests submitted by <strong>{org.org_name}</strong>
                  </p>
                  <button type="button" onClick={reloadOrgReq} style={SECONDARY_BUTTON}>
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
                      border: '1px solid var(--color-border-secondary)',
                      borderRadius: '18px',
                      padding: '14px 16px',
                      background: 'rgba(255,255,255,0.82)',
                      marginBottom: '12px',
                    }}>
                      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: '15px', flex: '1 1 180px' }}>{reqId}</span>
                        <StatusPill status={{ label: overallStatus, tone: statusTone }} />
                        {ts && <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{new Date(ts).toLocaleString()}</span>}
                        <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{rows.length} item{rows.length !== 1 ? 's' : ''}</span>
                      </summary>
                      <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                        <strong style={{ color: 'var(--color-text-primary)' }}>Organization:</strong> {firstRow['Org Name'] || org.org_name}
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginTop: '10px', minWidth: '640px' }}>
                          <thead>
                            <tr style={{ color: 'var(--color-text-secondary)', textAlign: 'left', fontSize: '12px', borderBottom: '1px solid var(--color-border-tertiary)' }}>
                              <th style={{ padding: '12px 8px' }}>Item</th>
                              <th style={{ padding: '12px 8px', width: '140px' }}>Category</th>
                              <th style={{ padding: '12px 8px', width: '60px' }}>Qty</th>
                              <th style={{ padding: '12px 8px', width: '110px' }}>Status</th>
                              {rows.some(r => r['Review Flag'] === 'TRUE') && <th style={{ padding: '12px 8px', width: '90px' }}>Flag</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row, idx) => {
                              const rowStatus = row['Status'] || 'Under Review';
                              const rowTone = rowStatus === 'Shipped' ? 'info'
                                : rowStatus === 'Approved' ? 'ok' : 'warn';
                              return (
                                <tr key={idx} style={{ borderBottom: '1px solid var(--color-border-tertiary)' }}>
                                  <td style={{ padding: '12px 8px', fontWeight: 600 }}>{row['Item Name'] || '—'}</td>
                                  <td style={{ padding: '12px 8px', color: 'var(--color-text-secondary)' }}>{row['Category'] || '—'}</td>
                                  <td style={{ padding: '12px 8px' }}>{row['Quantity Requested'] || '—'}</td>
                                  <td style={{ padding: '12px 8px' }}>
                                    <StatusPill status={{ label: rowStatus, tone: rowTone }} />
                                  </td>
                                  {rows.some(r => r['Review Flag'] === 'TRUE') && (
                                    <td style={{ padding: '12px 8px' }}>
                                      {row['Review Flag'] === 'TRUE' && <span style={{ fontSize: '11px', fontWeight: 600, color: '#8B0000' }}>Review needed</span>}
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  );
                })}
              </>
            )}
          </div>
        )}

        {cartOpen && (
          <aside style={{
            position: 'fixed',
            right: 16,
            top: 24,
            width: 380,
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: 'calc(100vh - 48px)',
            overflow: 'auto',
            ...PANEL_STYLE,
            borderRadius: '24px',
            padding: '18px',
            zIndex: 20,
            background: 'rgba(255,255,255,0.96)',
            backdropFilter: 'blur(18px)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '20px', flex: 1, fontFamily: 'var(--font-display)', fontWeight: 700 }}>Cart</h2>
              <button type="button" onClick={() => setCartOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '24px' }}>×</button>
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
                        padding: '14px',
                        border: '1px solid var(--color-border-secondary)',
                        borderRadius: '16px',
                        marginBottom: '10px',
                        background: 'rgba(248,250,252,0.82)',
                        fontSize: '13px',
                      }}>
                        <div style={{ fontWeight: 600, marginBottom: '2px' }}>{line.item[nk]}</div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
                          {cat}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                            Qty
                            <input type="number" min={1} value={line.quantity} onChange={e => setLineQty(Number(row), e.target.value)} style={{ width: '64px', marginLeft: '6px', padding: '6px 8px', borderRadius: '12px', border: '1px solid var(--color-border-secondary)', background: 'white' }} />
                          </label>
                          {avail && <AvailBadge availInfo={avail} />}
                          <button type="button" onClick={() => setLineQty(Number(row), 0)} style={{ marginLeft: 'auto', fontSize: '12px', background: 'none', border: 'none', color: '#A93226', cursor: 'pointer', fontWeight: 700 }}>
                            Remove
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <button type="button" onClick={() => { setCheckoutOpen(true); setSubmitError(null); }} style={{ ...PRIMARY_BUTTON, width: '100%', justifyContent: 'center' }}>
                  Checkout
                </button>
              </>
            )}
          </aside>
        )}

        {checkoutOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(17, 12, 10, 0.48)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30, padding: '16px' }}>
            <div style={{ width: 'min(560px, 100%)', ...PANEL_STYLE, borderRadius: '24px', padding: '24px', maxHeight: 'calc(100vh - 32px)', overflow: 'auto', background: 'rgba(255,255,255,0.98)' }}>
              <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 700 }}>Confirm your request</h3>
              <p style={{ margin: '0 0 14px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                Please review your items below. Once submitted, Blueprints HQ will follow up within 48 hours.
              </p>
              <div style={{ padding: '12px 14px', borderRadius: '16px', marginBottom: '14px', background: 'rgba(248,250,252,0.82)', border: '1px solid var(--color-border-secondary)', fontSize: '13px' }}>
                <div><strong>Organization:</strong> {org?.org_name}</div>
                <div style={{ color: 'var(--color-text-secondary)' }}>{org?.org_email}</div>
              </div>
              <div style={{ marginBottom: '14px', overflowX: 'auto' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>Items ({cartCount} total)</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '460px' }}>
                  <thead>
                    <tr style={{ color: 'var(--color-text-secondary)', textAlign: 'left', fontSize: '12px', borderBottom: '1px solid var(--color-border-tertiary)' }}>
                      <th style={{ padding: '12px 6px' }}>Item</th>
                      <th style={{ padding: '12px 6px', width: '120px' }}>Category</th>
                      <th style={{ padding: '12px 6px', width: '50px' }}>Qty</th>
                      <th style={{ padding: '12px 6px', width: '120px' }}>Availability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(cart).map(([row, line]) => {
                      const nk = pickNameField(line.item);
                      const cat = parentCategory(line.item);
                      const avail = availMap[Number(row)];
                      return (
                        <tr key={row} style={{ borderBottom: '1px solid var(--color-border-tertiary)' }}>
                          <td style={{ padding: '12px 8px', fontWeight: 600 }}>{line.item[nk] || '—'}</td>
                          <td style={{ padding: '12px 8px', color: 'var(--color-text-secondary)' }}>{cat}</td>
                          <td style={{ padding: '12px 8px' }}>{line.quantity}</td>
                          <td style={{ padding: '12px 8px' }}><AvailBadge availInfo={avail} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {submitError && <p style={{ color: '#A93226', fontSize: '13px', margin: '0 0 10px' }}>{submitError}</p>}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setCheckoutOpen(false)} style={SECONDARY_BUTTON}>Cancel</button>
                <button type="button" disabled={submitting || cartCount === 0} onClick={submitOrgRequest} style={{ ...PRIMARY_BUTTON, opacity: submitting || cartCount === 0 ? 0.55 : 1, cursor: submitting || cartCount === 0 ? 'default' : 'pointer' }}>
                  {submitting ? 'Submitting…' : 'Submit request'}
                </button>
              </div>
            </div>
          </div>
        )}

        {loginOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(17, 12, 10, 0.48)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40, padding: '16px' }}>
            <div style={{ width: 'min(440px, 100%)', ...PANEL_STYLE, borderRadius: '24px', padding: '24px', background: 'rgba(255,255,255,0.98)' }}>
              <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 700 }}>Sign in to request supplies</h3>
              <p style={{ margin: '0 0 18px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                Enter your organization name and email. This is stored only for your current session.
              </p>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Organization name</label>
              <input
                value={loginName}
                onChange={e => setLoginName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="e.g. Riverside Free Clinic"
                style={{ width: '100%', padding: '12px 14px', marginBottom: '12px', borderRadius: '14px', border: '1px solid var(--color-border-secondary)', fontSize: '14px', background: 'rgba(255,255,255,0.86)' }}
              />
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Email address</label>
              <input
                type="email"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="e.g. contact@clinic.org"
                style={{ width: '100%', padding: '12px 14px', marginBottom: '12px', borderRadius: '14px', border: '1px solid var(--color-border-secondary)', fontSize: '14px', background: 'rgba(255,255,255,0.86)' }}
              />
              {loginError && <p style={{ color: '#A93226', fontSize: '13px', margin: '0 0 10px' }}>{loginError}</p>}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => { setLoginOpen(false); setLoginError(''); }} style={SECONDARY_BUTTON}>Cancel</button>
                <button type="button" onClick={handleLogin} style={PRIMARY_BUTTON}>Continue</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
