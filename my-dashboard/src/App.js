import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiError, getAvailability, getSupplies, submitRequest } from './api';
import { iconFor, ProductIconSprite, typeLabelFor } from './catalogIcons';
import CategoryPage from './components/CategoryPage';
import CategoryTree from './components/CategoryTree';
import CheckoutForm from './components/CheckoutForm';
import Confirmation from './components/Confirmation';
import Dialog from './components/Dialog';
import Header from './components/Header';
import Icon from './components/Icons';
import ItemDetail from './components/ItemDetail';
import Landing from './components/Landing';
import HQReview from './components/HQReview';
import MyRequests from './components/MyRequests';
import RequestSlip from './components/RequestSlip';
import SearchResults from './components/SearchResults';
import { EmptyState, ErrorState, SkeletonTable, WakingNotice } from './components/States';
import { closeTo, navigate, useDebounced, useHashRoute, useMediaQuery } from './hooks';
import {
  allocateFefo, applyAvailability, applyBaseFilters, buildCatalog, formatDateTime, groupByType, groupProducts,
  matchingTypes, normalizeInventory, rankByRelevance,
  searchForms,
} from './inventory';
import { clearInventoryCache, readInventoryCache, writeInventoryCache } from './inventoryCache';
import useCart, { MAX_LINES } from './useCart';
import useOrg from './useOrg';
import './styles.css';

const DEFAULT_FILTERS = { inStockOnly: false, hideExpiring: false };
const SITE_NAME = 'External Supply Request Dashboard';
const CONTACT_EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(process.env.REACT_APP_CONTACT_EMAIL || '')
  ? process.env.REACT_APP_CONTACT_EMAIL
  : 'contact@b4pglobal.org';
const OVERLAYS = ['item', 'slip'];
function newClientId() {
  const c = window.crypto;
  if (c && c.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

const TITLES = { requests: 'My requests', checkout: 'Review your request', sent: 'Request submitted' };

function enrich(rows) {
  return normalizeInventory(rows).map((item) => {
    const label = typeLabelFor(item);
    const type = typeof label === 'string' && label ? label : 'Unsorted supplies';
    return { ...item, type, icon: iconFor(item), searchText: `${item.searchText} ${searchForms(type)}` };
  });
}

// Renders the cached copy at once, then refreshes from the API in the background.
function useInventory() {
  // A saved copy that can't be read is dropped, never allowed to break the page.
  const [cached] = useState(() => {
    const c = readInventoryCache();
    if (!c) return null;
    try {
      return { ...c, items: enrich(c.supplies) };
    } catch {
      clearInventoryCache();
      return null;
    }
  });
  const [inventory, setInventory] = useState(() => (cached
    ? { status: 'done', items: cached.items, error: null, savedAt: cached.savedAt, fresh: false }
    : { status: 'loading', items: [], error: null, savedAt: null, fresh: false }));
  const [availability, setAvailability] = useState(cached ? cached.availability : null);
  const [slow, setSlow] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const rowsRef = useRef(cached ? cached.supplies : null);

  // `revalidate` skips the browser's short HTTP cache (after user actions,
  // or when a saved copy is already on screen).
  const loadHolds = useCallback((revalidate = false) => {
    getAvailability(revalidate ? { cache: 'no-cache' } : undefined)
      .then((rows) => {
        setAvailability(rows);
        if (rowsRef.current) writeInventoryCache({ supplies: rowsRef.current, availability: rows });
      })
      .catch(() => {
        // Hold badges and "remaining" counts are a nice-to-have; the list works without them.
      });
  }, []);

  const load = useCallback((revalidate = false) => {
    setRefreshing(true);
    setSlow(false);
    setInventory((s) => (s.items.length ? { ...s, error: null } : { ...s, status: 'loading', error: null }));
    getSupplies({ onSlow: () => setSlow(true), ...(revalidate ? { cache: 'no-cache' } : {}) })
      .then((rows) => {
        const fresh = enrich(rows); // throws on unusable data, before anything is saved
        rowsRef.current = rows;
        writeInventoryCache({ supplies: rows, availability: null });
        setInventory({ status: 'done', items: fresh, error: null, savedAt: Date.now(), fresh: true });
        loadHolds(revalidate);
      })
      .catch((err) => {
        const message = err instanceof ApiError
          ? err.message
          : 'The supply list has data this page can’t read. Try again later, or let Blueprints HQ know.';
        setInventory((s) => (s.items.length ? { ...s, error: message } : { ...s, status: 'error', error: message }));
      })
      .finally(() => setRefreshing(false));
  }, [loadHolds]);

  useEffect(() => load(!!cached), [load, cached]);

  const merged = useMemo(() => applyAvailability(inventory.items, availability), [inventory.items, availability]);
  return {
    inventory: { ...inventory, items: merged.items },
    holds: merged.holds,
    slow,
    refreshing,
    reload: () => load(true),
    reloadHolds: () => loadHolds(true),
  };
}

export default function App() {
  const route = useHashRoute();
  const wide = useMediaQuery('(min-width: 1280px)'); // category tree shown
  const { inventory, slow, refreshing, holds, reload, reloadHolds } = useInventory();
  const cart = useCart();
  const [org, setOrg] = useOrg();

  const [rawQuery, setRawQuery] = useState('');
  // Typing stays instant; results follow at lower priority.
  const query = useDeferredValue(useDebounced(rawQuery.trim(), 100));
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [catsOpen, setCatsOpen] = useState(false);
  const [slipNotice, setSlipNotice] = useState(null);
  const [toast, setToast] = useState(null);
  const [lastSent, setLastSent] = useState(null);
  const attemptRef = useRef(null);

  const setFilter = useCallback((key, value) => setFilters((f) => ({ ...f, [key]: value })), []);
  const clearFilters = () => setFilters(DEFAULT_FILTERS);

  // Overlays (item details, request drawer) sit on top of the last page.
  const baseRef = useRef(OVERLAYS.includes(route.view) ? { view: 'catalog' } : route);
  if (!OVERLAYS.includes(route.view)) baseRef.current = route;
  const base = baseRef.current;
  const inCatalog = base.view === 'catalog' || base.view === 'category';

  // Typing a search from another page brings you to the results; following a
  // link to another page ends the search.
  const inCatalogRef = useRef(inCatalog);
  inCatalogRef.current = inCatalog;
  const keepQuery = useRef(false);
  const onQuery = useCallback((value) => {
    setRawQuery(value);
    if (value.trim() && !inCatalogRef.current) {
      keepQuery.current = true;
      navigate('/');
    }
  }, []);
  const basePath = routePath(base);
  useEffect(() => {
    if (keepQuery.current) keepQuery.current = false;
    else setRawQuery('');
  }, [basePath]);

  const items = inventory.items;
  // One row per product (name + maker); its lots (sheet rows) are inside.
  const products = useMemo(() => groupProducts(items, holds), [items, holds]);
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const productForRow = useMemo(() => {
    const map = new Map();
    for (const p of products) for (const lot of p.lots) map.set(lot.id, p);
    return map;
  }, [products]);
  const catalog = useMemo(() => buildCatalog(products), [products]);
  const catalogTotal = useMemo(() => catalog.reduce((n, c) => n + c.count, 0), [catalog]);
  const effective = useMemo(() => ({ ...filters, holds }), [filters, holds]);

  const category = base.view === 'category' ? catalog.find((c) => c.slug === base.slug) : null;
  const categoryView = useMemo(() => {
    if (!category) return null;
    const visible = applyBaseFilters(category.types.flatMap((t) => t.items), effective);
    return { groups: groupByType(visible), count: visible.length };
  }, [category, effective]);

  const searchView = useMemo(() => {
    if (!query) return null;
    const visible = applyBaseFilters(products, { ...effective, query });
    const { own, other } = rankByRelevance(visible, query);
    const groups = [...groupByType(own), ...groupByType(other).map((g) => ({ ...g, alsoMatched: true }))];
    return { types: matchingTypes(catalog, query), groups, count: visible.length };
  }, [query, products, catalog, effective]);

  // Once fresh inventory arrives, re-check what's saved on the request.
  const { reconcile } = cart;
  useEffect(() => {
    if (!inventory.fresh) return;
    const removed = reconcile(productsById, productForRow);
    if (removed.length) {
      setSlipNotice(
        removed.length === 1
          ? `“${removed[0]}” is no longer available and was taken off your request.`
          : `${removed.length} supplies are no longer available and were taken off your request.`,
      );
    }
  }, [inventory.fresh, productsById, productForRow, reconcile]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.undo ? 8000 : 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const { lines, setQuantity, restore, remove } = cart;
  // Handlers stay stable across cart changes (read lines via a ref), so memoised
  // rows don't all re-render when one quantity changes.
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const quantities = useMemo(() => new Map(lines.map((l) => [l.id, l.quantity])), [lines]);
  // Removing a line (quantity 0 or Remove) offers an undo.
  const offerUndo = useCallback((id) => {
    const index = linesRef.current.findIndex((l) => l.id === id);
    if (index === -1) return;
    const line = linesRef.current[index];
    setToast({
      message: `Removed ${line.name} from your request.`,
      undo: () => {
        restore(line, index);
        setToast(null);
      },
    });
  }, [restore]);

  const onQuantity = useCallback((item, n) => {
    if (n <= 0) offerUndo(item.id);
    if (!setQuantity(item, n)) {
      setToast({ message: `Your request is full. It can include up to ${MAX_LINES} different supplies.` });
    }
  }, [setQuantity, offerUndo]);

  const onRemove = useCallback((id) => {
    offerUndo(id);
    remove(id);
  }, [offerUndo, remove]);

  // New pages start at the top; overlays leave the page where it was.
  const baseKey = `${base.view}/${base.slug || ''}/${base.id || ''}/${query ? 'q' : ''}`;
  useLayoutEffect(() => {
    if (!base.type) window.scrollTo(0, 0);
  }, [baseKey, base.type]);

  useEffect(() => {
    const title = query && inCatalog ? `Results for ${query}`
      : TITLES[base.view] || (category ? category.name : '');
    document.title = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
  }, [base.view, category, query, inCatalog]);

  const handleSubmit = async (orgValues, onSlow) => {
    setOrg(orgValues);
    // Never send (or confirm) a partial request: stop if a supply vanished since it was added.
    const missing = lines.filter((l) => !productsById.has(l.id));
    if (missing.length) {
      throw new ApiError(`${missing.map((l) => l.name).join(', ')} ${missing.length === 1 ? 'is' : 'are'} no longer available. Remove ${missing.length === 1 ? 'it' : 'them'} from your request, then submit again.`);
    }
    // Each product line becomes one POST line per lot, earliest expiry first.
    const payload = lines.flatMap((l) => {
      const product = productsById.get(l.id);
      return allocateFefo(product, l.quantity).map(({ item, quantity }) => ({
        item_name: item.requestName,
        category: item.category.slice(0, 200), // the server rejects longer values
        quantity,
        sheet_row: item.id,
      }));
    });
    if (payload.length > MAX_LINES) {
      throw new ApiError(`This request covers ${payload.length} separate lots, and one request can include ${MAX_LINES}. Remove a few supplies and send them in a second request.`);
    }
    // One id per distinct request: a retry after a timeout resends the same id, so the server
    // returns the first request instead of creating a duplicate.
    const body = { org_name: orgValues.name, org_email: orgValues.email, items: payload };
    const key = JSON.stringify(body);
    if (!attemptRef.current || attemptRef.current.key !== key) attemptRef.current = { key, id: newClientId() };
    const res = await submitRequest({ ...body, client_request_id: attemptRef.current.id }, { onSlow });
    attemptRef.current = null;
    setLastSent({
      id: res.request_id,
      lines: lines.map((l) => ({ id: l.id, name: l.name, quantity: l.quantity })),
      lineCount: lines.length,
      lotCount: payload.length,
      totalUnits: cart.totalUnits,
      orgName: orgValues.name,
      email: orgValues.email,
    });
    cart.clear();
    setSlipNotice(null);
    reloadHolds();
    navigate(`/sent/${encodeURIComponent(res.request_id)}`, { replace: true });
  };

  const openItem = useCallback((id) => navigate(`/item/${id}`), []);
  const tableProps = useMemo(() => ({ quantities, onQuantity, onOpenItem: openItem }), [quantities, onQuantity, openItem]);

  let main;
  if (base.view === 'hq') {
    // Approvals hold stock, so refresh the holds the catalog shows after each change.
    main = <HQReview onStatusChanged={reloadHolds} />;
  } else if (base.view === 'requests') {
    main = (
      <MyRequests
        org={org}
        onEmailChange={(email) => setOrg({ ...org, email })}
        highlightId={lastSent && lastSent.id}
        onBrowse={() => navigate('/')}
      />
    );
  } else if (base.view === 'checkout') {
    main = cart.lines.length ? (
      <CheckoutForm lines={cart.lines} totalUnits={cart.totalUnits} org={org} onSubmit={handleSubmit} onBack={() => closeTo('/')} />
    ) : (
      <EmptyState
        level={1}
        title="Your request is empty"
        action={<button type="button" className="btn btn--primary" onClick={() => navigate('/')}>Browse supplies</button>}
      >
        Add supplies from the list, then come back here to submit your request.
      </EmptyState>
    );
  } else if (base.view === 'sent') {
    main = (
      <Confirmation
        requestId={base.id}
        sent={lastSent && lastSent.id === base.id ? lastSent : null}
        onBrowse={() => navigate('/')}
        onViewRequests={() => navigate('/requests')}
      />
    );
  } else {
    let page;
    if (inventory.status === 'error') {
      page = <ErrorState title="Couldn’t load the supply list" message={inventory.error} onRetry={reload} />;
    } else if (inventory.status === 'loading') {
      page = (
        <>
          {slow && <WakingNotice />}
          <span className="visually-hidden" role="status">Loading supplies</span>
          <SkeletonTable />
        </>
      );
    } else if (searchView) {
      page = (
        <SearchResults
          query={query}
          {...searchView}
          filters={filters}
          setFilter={setFilter}
          onClearSearch={() => setRawQuery('')}
          tableProps={tableProps}
        />
      );
    } else if (base.view === 'category' && category) {
      page = (
        <CategoryPage
          category={category}
          {...categoryView}
          filters={filters}
          setFilter={setFilter}
          onClearFilters={clearFilters}
          typeSlug={base.type}
          tableProps={tableProps}
        />
      );
    } else if (base.view === 'category') {
      page = (
        <EmptyState
          title="This category isn’t in the list anymore"
          action={<a className="btn btn--secondary" href="#/">See all categories</a>}
        />
      );
    } else if (catalogTotal === 0) {
      page = (
        <EmptyState title="No supplies are listed right now">
          Blueprints HQ updates the list as donations arrive. Check back soon.
        </EmptyState>
      );
    } else {
      page = <Landing catalog={catalog} total={catalogTotal} />;
    }

    main = (
      <div className="shop">
        {wide && inventory.status === 'done' && (
          <aside className="shop__tree">
            <CategoryTree
              catalog={catalog}
              activeSlug={category && !query ? category.slug : null}
              total={catalogTotal}
              onNavigate={() => setRawQuery('')}
            />
          </aside>
        )}
        <div className="shop__main">
          {inventory.status === 'done' && inventory.error && (
            <div className="stale" role="status">
              <p>
                Couldn’t refresh the list, so this is the copy saved on this device
                {inventory.savedAt ? ` on ${formatDateTime(new Date(inventory.savedAt).toISOString())}` : ''}.
              </p>
              <button type="button" className="linklike" onClick={reload} disabled={refreshing}>
                {refreshing ? 'Trying again…' : 'Try again'}
              </button>
            </div>
          )}
          {inventory.status === 'done' && !inventory.fresh && !inventory.error && slow && (
            <p className="stale" role="status">Showing the list saved on this device while the server wakes up.</p>
          )}
          {page}
        </div>
      </div>
    );
  }

  const detailItem = route.view === 'item' ? productForRow.get(route.id) : null;
  const closeOverlay = () => closeTo(basePath);

  return (
    <>
      <ProductIconSprite />
      <a className="skip-link" href="#main" onClick={(e) => {
        e.preventDefault();
        document.getElementById('main').focus();
      }}>Skip to content</a>
      <Header
        view={base.view}
        lineCount={cart.lines.length}
        onOpenSlip={() => navigate('/slip')}
        onOpenCategories={!wide && inCatalog && inventory.status === 'done' ? () => setCatsOpen(true) : null}
        query={rawQuery}
        onQuery={onQuery}
        total={catalogTotal}
        siteName={SITE_NAME}
      />
      <main id="main" tabIndex={-1} className="main">
        {main}
      </main>
      <footer className="footer">
        <p>
          Can’t find what you need? <a href={`mailto:${CONTACT_EMAIL}`}>Email us at {CONTACT_EMAIL}</a>
        </p>
      </footer>

      {catsOpen && !wide && (
        <Dialog onClose={() => setCatsOpen(false)} labelledBy="cats-title" variant="left" className="cats-drawer">
          <div className="drawer__bar">
            <h2 id="cats-title" className="drawer__title">Categories</h2>
            <button type="button" className="icon-btn" onClick={() => setCatsOpen(false)} aria-label="Close categories" data-autofocus>
              <Icon name="close" />
            </button>
          </div>
          <CategoryTree
            catalog={catalog}
            activeSlug={category ? category.slug : null}
            total={catalogTotal}
            onNavigate={() => {
              setRawQuery('');
              setCatsOpen(false);
            }}
          />
        </Dialog>
      )}

      {route.view === 'slip' && (
        <Dialog onClose={closeOverlay} labelledBy="slip-title" variant="side" className="slip-drawer">
          <RequestSlip
            lines={cart.lines}
            totalUnits={cart.totalUnits}
            org={org}
            notice={slipNotice}
            onDismissNotice={() => setSlipNotice(null)}
            onQuantity={onQuantity}
            onRemove={onRemove}
            onOpenItem={(id) => {
              const product = productsById.get(id);
              if (product) navigate(`/item/${product.row}`, { replace: true });
            }}
            onReview={() => navigate('/review', { replace: true })}
            onClear={cart.clear}
            onClose={closeOverlay}
          />
        </Dialog>
      )}

      {route.view === 'item' && inventory.status === 'done' && (
        <ItemDetail
          item={detailItem}
          missing={!detailItem}
          onHold={detailItem ? detailItem.onHold : false}
          quantity={detailItem ? cart.quantityOf(detailItem.id) : 0}
          onQuantity={(n) => onQuantity(detailItem, n)}
          onClose={closeOverlay}
        />
      )}

      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="toast">
            <p>{toast.message}</p>
            {toast.undo && (
              <button type="button" className="toast__action" onClick={toast.undo}>Undo</button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function routePath(r) {
  if (r.view === 'category') return `/c/${r.slug}${r.type ? `/${r.type}` : ''}`;
  if (r.view === 'requests') return '/requests';
  if (r.view === 'hq') return '/hq';
  if (r.view === 'checkout') return '/review';
  if (r.view === 'sent') return `/sent/${r.id}`;
  return '/';
}
