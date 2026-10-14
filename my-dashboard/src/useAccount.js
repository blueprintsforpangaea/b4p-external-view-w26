import { useCallback, useState } from 'react';
import { readJSON, writeJSON } from './storage';

// MOCKUP: the real version asks GET /auth/me and the session lives in an
// HttpOnly cookie. Here the signed-in account is kept in localStorage.
const KEY = 'b4p.mock.session.v1';

export default function useAccount() {
  const [account, setAccount] = useState(() => {
    const saved = readJSON(KEY, null);
    return saved && typeof saved.email === 'string' && typeof saved.org === 'string' ? saved : null;
  });

  const signedIn = useCallback((next) => {
    setAccount(next);
    writeJSON(KEY, next);
  }, []);

  const signOut = useCallback(() => {
    setAccount(null);
    writeJSON(KEY, null);
  }, []);

  return { account, signedIn, signOut };
}
