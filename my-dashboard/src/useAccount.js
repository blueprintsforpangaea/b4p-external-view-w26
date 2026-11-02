import { useCallback, useEffect, useState } from 'react';
import { accountMe, logOut } from './api';
import { readJSON, writeJSON } from './storage';

// The signed-in account: {email, org, role} ("clinic" or "hq" for the Blueprints team). The session
// itself is an HttpOnly cookie the page can't read; this copy only lets the header show who is
// signed in at once, and GET /api/auth/me confirms it (or signs out) when the page opens.
const KEY = 'b4p.account.v3';

const valid = (s) => (s && typeof s.email === 'string' && typeof s.org === 'string'
  && (s.role === 'clinic' || s.role === 'hq') ? s : null);

// The server's {email, org_name, role} as the page uses it.
export const fromServer = (me) => valid({ email: me.email, org: me.org_name, role: me.role });

export default function useAccount() {
  const [account, setAccount] = useState(() => valid(readJSON(KEY, null)));

  // Ask the server once per visit: the cookie may have expired, or a password reset ended it.
  // Only when this browser was signed in: for everyone else the answer is a known "no" (a 401
  // that would only add an error line to the browser console).
  const wasSignedIn = !!account;
  useEffect(() => {
    if (!wasSignedIn) return undefined;
    let live = true;
    accountMe()
      .then((me) => {
        if (!live) return;
        const next = fromServer(me);
        writeJSON(KEY, next);
        setAccount(next);
      })
      .catch((err) => {
        if (live && err.status === 401) {
          writeJSON(KEY, null);
          setAccount(null);
        }
      });
    return () => { live = false; };
  }, [wasSignedIn]);

  const signedIn = useCallback((next) => {
    writeJSON(KEY, next);
    setAccount(next);
  }, []);

  const signOut = useCallback(() => {
    logOut().catch(() => {}); // the cookie is cleared by the server; the page forgets now either way
    writeJSON(KEY, null);
    setAccount(null);
  }, []);

  return { account, signedIn, signOut };
}
