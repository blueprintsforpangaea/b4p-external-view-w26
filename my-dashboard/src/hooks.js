import { useEffect, useState } from 'react';

export function useDebounced(value, delay = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function useMediaQuery(query) {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else mql.removeListener(onChange);
    };
  }, [query]);
  return matches;
}

// Routes: #/ (home)  #/supplies  #/requests  #/item/<row>  #/slip  #/review  #/sent  #/signin[/review|/requests]
//         #/reset/<token> (team-made password reset link)  #/password (change it, signed in)
//         #/team (Blueprints team dashboard)  #/team/signin
// Old addresses still land somewhere sensible: #/guide and #/how-it-works go home, #/c/... to the
// supplies, #/forgot and #/welcome/... (the password screens) to sign-in.
export function parseHash(hash) {
  const path = String(hash || '').replace(/^#/, '').replace(/^\/+/, '');
  const [view, param] = path.split('/');
  if (view === 'requests') return { view: 'requests' };
  if (view === 'signin') return { view: 'signin', next: ['review', 'requests'].includes(param) ? param : null };
  if (view === 'forgot' || view === 'welcome') return { view: 'signin', next: null };
  // A password reset link from the Blueprints team: #/reset/<token>. The token stays in the
  // fragment, which browsers never send to a server.
  if (view === 'reset') return /^[A-Za-z0-9_-]{20,200}$/.test(param || '') ? { view: 'reset', token: param } : { view: 'signin', next: null };
  if (view === 'password') return { view: 'password' };
  if (view === 'team') return param === 'signin' ? { view: 'team-signin' } : { view: 'team' };
  if (view === 'supplies' || view === 'c') return { view: 'catalog' };
  if (view === 'review' || view === 'checkout') return { view: 'checkout' };
  if (view === 'slip') return { view: 'slip' };
  if (view === 'sent') return { view: 'sent' };
  if (view === 'item' && /^\d+$/.test(param || '')) return { view: 'item', id: Number(param) };
  return { view: 'home' };
}

const ROUTE_EVENT = 'b4p:route';

export function useHashRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    window.addEventListener(ROUTE_EVENT, onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
      window.removeEventListener(ROUTE_EVENT, onChange);
    };
  }, []);
  return route;
}

// Entries we push are marked so "close" can go back instead of stacking history.
export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (window.location.hash === target) return;
  if (replace) window.history.replaceState(window.history.state, '', target);
  else window.history.pushState({ b4p: true }, '', target);
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

// Close an overlay route (item sheet, slip sheet): back if we opened it, else replace.
export function closeTo(path = '/') {
  if (window.history.state && window.history.state.b4p) window.history.back();
  else navigate(path, { replace: true });
}
