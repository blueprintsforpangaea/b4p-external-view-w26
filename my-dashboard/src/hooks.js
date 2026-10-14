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

// Routes: #/  #/c/<category>[/<type>]  #/requests  #/item/<row>  #/slip  #/review  #/sent/<id>
//         #/signin[/review|/requests]  #/forgot  #/welcome/<invite token>  #/how-it-works
// Only real request IDs render on the "submitted" page (no spoofed text via links).
const REQUEST_ID_RE = /^REQ-\d+-[0-9a-z]+$/i;
const SLUG_RE = /^[a-z0-9-]{1,80}$/;
export function parseHash(hash) {
  const path = String(hash || '').replace(/^#/, '').replace(/^\/+/, '');
  const [view, param, extra] = path.split('/');
  if (view === 'requests') return { view: 'requests' };
  if (view === 'signin') return { view: 'signin', next: ['review', 'requests'].includes(param) ? param : null };
  if (view === 'forgot') return { view: 'forgot' };
  if (view === 'how-it-works') return { view: 'guide' };
  if (view === 'welcome' && /^[A-Za-z0-9_-]{1,100}$/.test(param || '')) return { view: 'welcome', token: param };
  if (view === 'review' || view === 'checkout') return { view: 'checkout' };
  if (view === 'slip') return { view: 'slip' };
  if (view === 'sent' && REQUEST_ID_RE.test(param || '')) return { view: 'sent', id: param };
  if (view === 'item' && /^\d+$/.test(param || '')) return { view: 'item', id: Number(param) };
  if (view === 'c' && SLUG_RE.test(param || '')) {
    return { view: 'category', slug: param, type: SLUG_RE.test(extra || '') ? extra : null };
  }
  return { view: 'catalog' };
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
