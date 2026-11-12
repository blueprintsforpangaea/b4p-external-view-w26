import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiError, getAvailability, getSupplies, submitRequest } from './api';
import { iconFor, ProductIconSprite, typeLabelFor } from './catalogIcons';
import DataSource, { showDataSource } from './components/DataSource';
import Dialog from './components/Dialog';
import Header from './components/Header';
import Home from './components/Home';
import Inventory from './components/Inventory';
import ItemDetail from './components/ItemDetail';
import RequestSlip from './components/RequestSlip';
import { EmptyState, ErrorState, SkeletonTable, WakingNotice } from './components/States';
import { closeTo, navigate, useDebounced, useHashRoute } from './hooks';
import { allocateFefo, applyAvailability, canRequest, formatDateTime, groupProducts, normalizeInventory, searchForms } from './inventory';
import { clearInventoryCache, readInventoryCache, writeInventoryCache } from './inventoryCache';
import { buildIndex } from './suggest';
import useCart, { MAX_LINES } from './useCart';
import useAccount from './useAccount';
import useOrg from './useOrg';
import './styles.css';

const SITE_NAME = 'Blueprints Supply Requests';
const CONTACT_EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(process.env.REACT_APP_CONTACT_EMAIL || '')
  ? process.env.REACT_APP_CONTACT_EMAIL
  : 'contact@b4pglobal.org';
const OVERLAYS = ['item', 'slip'];
const SECTIONS = ['inventory', 'how-it-works', 'contact']; // ids on the main page; #/<id> jumps there
function newClientId() {
  const c = window.crypto;
  if (c && c.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

const TITLES = {
  requests: 'My requests', checkout: 'Review your request', sent: 'Request submitted',
  signin: 'Sign in', reset: 'Choose a new password', password: 'Change your password',
  team: 'Team dashboard', 'team-signin': 'Blueprints team sign in',
};
const AUTH_VIEWS = ['signin', 'team-signin', 'reset', 'password'];
// Only the main page ships in the main bundle; every other page loads when it's opened.
const SignIn = lazy(() => import('./components/SignIn').then((m) => ({ default: m.SignIn })));
const CheckoutForm = lazy(() => import('./components/CheckoutForm'));
const Confirmation = lazy(() => import('./components/Confirmation'));
const MyRequests = lazy(() => import('./components/MyRequests'));
// The Blueprints team pages are for members only, so clinics never download them.
const ResetPassword = lazy(() => import('./components/Password').then((m) => ({ default: m.ResetPassword })));
const ChangePassword = lazy(() => import('./components/Password').then((m) => ({ default: m.ChangePassword })));
const TeamDashboard = lazy(() => import('./components/TeamDashboard'));

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
          : 'The supply list has data this page can’t read. Try again later, or email the Blueprints team.';
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
  const hashRoute = useHashRoute();
  const { inventory, slow, refreshing, holds, reload, reloadHolds } = useInventory();
  const [savedOrg, setOrg] = useOrg();
  const auth = useAccount();
  // REACT_APP_AUTH_PREVIEW=off keeps today's guest checkout (the existing tests use it).
  const authOn = process.env.REACT_APP_AUTH_PREVIEW !== 'off';
  const account = authOn ? auth.account : null;
  // A signed-in clinic's list is saved under their email (see useCart).
  const cart = useCart(account ? account.email : null);
  const { signedIn, signOut } = auth;
  // Blueprints team members are accounts with role "hq" (the team dashboard is theirs).
  const teamMember = auth.account && auth.account.role === 'hq' ? auth.account : null;
  // Signed in: the clinic comes from the account, not from what was typed.
  const org = useMemo(() => (account ? { name: account.org, email: account.email } : savedOrg), [account, savedOrg]);
  // One page for everyone: #/, the old #/supplies and #/c/... addresses, and the section links.
  const route = hashRoute.view === 'home' || hashRoute.view === 'catalog' ? { view: 'landing', home: true } : hashRoute;
  // The dashboard is for Blueprints members: anyone else goes to the team sign-in.
  useEffect(() => {
    if (hashRoute.view === 'team' && !teamMember) navigate('/team/signin', { replace: true });
    if (hashRoute.view === 'team-signin' && teamMember) navigate('/team', { replace: true });
    // Request history needs an account, so with sign-in off there is none to show.
    if (hashRoute.view === 'requests' && !authOn) navigate('/supplies', { replace: true });
  }, [hashRoute.view, teamMember, authOn]);

  const [rawQuery, setRawQuery] = useState('');
  // Typing stays instant; results follow at lower priority.
  const query = useDeferredValue(useDebounced(rawQuery.trim(), 100));
  const [slipNotice, setSlipNotice] = useState(null);
  const [toast, setToast] = useState(null);
  const [lastSent, setLastSent] = useState(null);
  const attemptRef = useRef(null);

  // Overlays (item details, request drawer) sit on top of the last page.
  const baseRef = useRef(OVERLAYS.includes(route.view) ? { view: 'catalog' } : route);
  if (!OVERLAYS.includes(route.view)) baseRef.current = route;
  const base = baseRef.current;
  const basePath = routePath(base);
  // Leaving the supplies page ends the search (the other filters live on that page and reset too).
  useEffect(() => setRawQuery(''), [basePath]);

  const items = inventory.items;
  // One row per product (name + maker); its lots (sheet rows) are inside.
  const products = useMemo(() => groupProducts(items, holds), [items, holds]);
  const stats = useMemo(() => [
    [products.filter(canRequest).length, 'Supply types available'],
    [new Set(products.map((p) => p.subcategory)).size, 'Categories'],
  ], [products]);
  // What the search box suggests: every supply name and category in the list.
  const suggestIndex = useMemo(() => buildIndex(
    products.map((p) => p.name),
    [...new Set(products.map((p) => p.subcategory))],
  ), [products]);
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const productForRow = useMemo(() => {
    const map = new Map();
    for (const p of products) for (const lot of p.lots) map.set(lot.id, p);
    return map;
  }, [products]);

  // Once fresh inventory arrives, re-check what's saved on the request.
  // Also when a saved list is swapped in at sign-in or sign-out.
  const { reconcile, loads: cartLoads } = cart;
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
  }, [inventory.fresh, productsById, productForRow, reconcile, cartLoads]);

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
      setToast({ message: `Your list is full. It can include up to ${MAX_LINES} different supplies.` });
    }
  }, [setQuantity, offerUndo]);

  const onRemove = useCallback((id) => {
    offerUndo(id);
    remove(id);
  }, [offerUndo, remove]);

  // New pages start at the top; overlays leave the page where it was.
  const baseKey = `${base.view}/${base.home ? 'home' : ''}`;
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [baseKey]);

  // #/inventory, #/how-it-works, #/contact (and the old #/supplies, #/c/...) scroll to that part of
  // the page, also when arriving from another page or once the list has loaded. Not when a supply's
  // details or Your list close over it, and not twice for one address: going back fires both
  // popstate and hashchange, and a second jump would throw the page back to the top of the list.
  // Plain #inventory links (no slash) are rewritten to #/inventory first: going back to a plain
  // #id makes the browser itself jump to that element and drop focus, which is the same glitch.
  const lastJump = useRef({ hash: null, view: null, status: null });
  useEffect(() => {
    let hash = window.location.hash;
    if (/^#(inventory|how-it-works|contact)$/.test(hash)) {
      hash = `#/${hash.slice(1)}`;
      window.history.replaceState(window.history.state, '', hash);
    }
    const prev = lastJump.current;
    lastJump.current = { hash, view: hashRoute.view, status: inventory.status };
    if (OVERLAYS.includes(prev.view) || OVERLAYS.includes(hashRoute.view)) return;
    if (prev.hash === hash && prev.status === inventory.status) return;
    const id = /^#\/(supplies|c\/)/.test(hash) ? 'inventory' : hash.slice(2);
    const el = SECTIONS.includes(id) && document.getElementById(id);
    if (el) el.scrollIntoView();
  }, [hashRoute, inventory.status]);

  useEffect(() => {
    const title = TITLES[base.view] || '';
    document.title = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
  }, [base.view]);

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
      throw new ApiError(`This request covers ${payload.length} separate batches, and one request can include ${MAX_LINES}. Remove a few supplies and send them in a second request.`);
    }
    // One id per distinct request: a retry after a timeout resends the same id, so the server
    // returns the first request instead of creating a duplicate.
    const body = { org_name: orgValues.name, org_email: orgValues.email, items: payload };
    const key = JSON.stringify(body);
    if (!attemptRef.current || attemptRef.current.key !== key) attemptRef.current = { key, id: newClientId() };
    let res;
    try {
      res = await submitRequest({ ...body, client_request_id: attemptRef.current.id }, { onSlow });
    } catch (err) {
      if (err.status === 409) reloadHolds(); // someone took some of these first: show what's left now
      throw err;
    }
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
    navigate('/sent', { replace: true });
  };

  const onSignedIn = (next) => (acc, { welcome } = {}) => {
    signedIn(acc);
    const lead = welcome ? 'You’re all set. ' : '';
    setToast({ message: `${lead}Signed in as ${acc.org}.` });
    if (next !== undefined) navigate(next === 'review' ? '/review' : next === 'requests' ? '/requests' : '/supplies', { replace: true });
  };
  const onSignOut = () => {
    signOut();
    setToast({ message: 'You’ve signed out. Your list is saved for when you sign in again on this device.' });
    if (base.view === 'requests' || base.view === 'checkout') navigate('/supplies');
  };

  const openItem = useCallback((id) => navigate(`/item/${id}`), []);
  const tableProps = useMemo(() => ({ quantities, onQuantity, onOpenItem: openItem }), [quantities, onQuantity, openItem]);

  let main;
  if (base.view === 'signin') {
    main = account ? (
      <EmptyState level={1} title={`You’re signed in as ${account.org}`} action={<a className="btn btn--primary" href="#/supplies">Browse supplies</a>}>
        Signed in with {account.email}.
      </EmptyState>
    ) : <SignIn next={base.next} onSignedIn={onSignedIn(base.next)} contactEmail={CONTACT_EMAIL} />;
  } else if (base.view === 'landing') {
    let list;
    if (inventory.status === 'error') {
      list = <ErrorState title="Couldn’t load the supply list" message={inventory.error} onRetry={reload} />;
    } else if (inventory.status === 'loading') {
      list = (
        <>
          {slow && <WakingNotice />}
          <span className="visually-hidden" role="status">Loading supplies</span>
          <SkeletonTable />
        </>
      );
    } else if (products.length === 0) {
      list = (
        <EmptyState title="No supplies are listed right now">
          The Blueprints team updates the list as donations arrive. Check back soon.
        </EmptyState>
      );
    } else {
      list = (
        <Inventory
          products={products}
          query={query}
          updated={inventory.savedAt ? formatDateTime(new Date(inventory.savedAt).toISOString()) : null}
          onRefresh={reload}
          refreshing={refreshing}
          {...tableProps}
        />
      );
    }
    main = (
      <Home clinic={account ? account.org : null} search={rawQuery} onSearch={setRawQuery} suggestIndex={suggestIndex} contactEmail={CONTACT_EMAIL} signIn={authOn}
        stats={inventory.status === 'done' && products.length ? stats : null}>
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
        {list}
      </Home>
    );
  } else if (base.view === 'reset') {
    main = (
      <ResetPassword token={base.token} contactEmail={CONTACT_EMAIL} onSignedIn={(acc) => {
        signedIn(acc);
        setToast({ message: `Your new password is saved. Signed in as ${acc.org}.` });
        navigate('/', { replace: true }); // the link works once: don't leave it in the address bar
      }} />
    );
  } else if (base.view === 'password') {
    main = account
      ? <ChangePassword account={account} onDone={() => { setToast({ message: 'Your password is changed.' }); navigate('/'); }} />
      : <SignIn onSignedIn={onSignedIn()} contactEmail={CONTACT_EMAIL} />;
  } else if (base.view === 'team-signin' || base.view === 'team') {
    main = (
      <Suspense fallback={<p className="hint" role="status">Loading…</p>}>
        {base.view === 'team' && teamMember
          ? <TeamDashboard member={teamMember} onSignOut={() => { signOut(); navigate('/team/signin'); }} />
          : <SignIn team contactEmail={CONTACT_EMAIL} onSignedIn={(acc) => { signedIn(acc); navigate('/team', { replace: true }); }} />}
      </Suspense>
    );
  } else if (authOn && base.view === 'requests' && !account) {
    main = <SignIn next="requests" onSignedIn={onSignedIn()} contactEmail={CONTACT_EMAIL} />;
  } else if (authOn && base.view === 'checkout' && !account && cart.lines.length) {
    main = <SignIn next="review" lineCount={cart.lines.length} onSignedIn={onSignedIn()} contactEmail={CONTACT_EMAIL} />;
  } else if (base.view === 'requests') {
    main = (
      <MyRequests
        org={org}
        account={account}
        onEmailChange={(email) => setOrg({ ...org, email })}
        highlightId={lastSent && lastSent.id}
        onBrowse={() => navigate('/supplies')}
      />
    );
  } else if (base.view === 'checkout') {
    main = cart.lines.length ? (
      <CheckoutForm lines={cart.lines} products={productsById} totalUnits={cart.totalUnits} org={org} account={account} onSignOut={onSignOut} onSubmit={handleSubmit} onBack={() => closeTo('/supplies')} />
    ) : (
      <EmptyState
        level={1}
        title="Your list is empty"
        action={<button type="button" className="btn btn--primary" onClick={() => navigate('/supplies')}>Browse supplies</button>}
      >
        Add supplies from the list, then come back here to submit your request.
      </EmptyState>
    );
  } else if (base.view === 'sent') {
    main = (
      <Confirmation
        sent={lastSent}
        onBrowse={() => navigate('/supplies')}
        onViewRequests={authOn ? () => navigate('/requests') : null}
      />
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
        units={cart.totalUnits}
        onOpenSlip={() => navigate('/slip')}
        account={account}
        onSignOut={onSignOut}
        authPage={AUTH_VIEWS.includes(base.view)}
        showSignIn={authOn}
      />
      <main id="main" tabIndex={-1} className="main">
        <Suspense fallback={<p className="hint" role="status">Loading…</p>}>{main}</Suspense>
      </main>
      <footer className="footer">
        <p className="footer__about">
          Blueprints for Pangaea · Medical supply requests. Listings are for information only, are not a
          reservation or guarantee of availability, and are not medical advice.
        </p>
        <p className="footer__help">
          Need help? Email <a className="footer__email" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
        {authOn && <p className="footer__team">
          {teamMember
            ? <a href="#/team">Blueprints team dashboard</a>
            : <a href="#/team/signin">Blueprints team sign in</a>}
        </p>}
        {showDataSource() && <DataSource />}
      </footer>

      {route.view === 'slip' && (
        <Dialog onClose={closeOverlay} labelledBy="slip-title" variant="side" className="slip-drawer">
          <RequestSlip
            lines={cart.lines}
            products={productsById}
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
          row={Number(route.id)}
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
  if (r.home) return '/';
  if (r.view === 'requests') return '/requests';
  if (r.view === 'signin') return `/signin${r.next ? `/${r.next}` : ''}`;
  if (r.view === 'team') return '/team';
  if (r.view === 'team-signin') return '/team/signin';
  if (r.view === 'checkout') return '/review';
  if (r.view === 'sent') return '/sent';
  if (r.view === 'password') return '/password';
  if (r.view === 'reset') return `/reset/${r.token}`;
  return '/';
}
