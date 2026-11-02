import { useCallback, useState } from 'react';
import { readJSON, writeJSON } from './storage';

export const ORG_KEY = 'b4p.org.v1';

// The clinic's name and email, asked once at checkout and remembered.
export default function useOrg() {
  const [org, setOrgState] = useState(() => {
    const saved = readJSON(ORG_KEY, null);
    return {
      name: typeof saved?.name === 'string' ? saved.name : '',
      email: typeof saved?.email === 'string' ? saved.email : '',
    };
  });

  const setOrg = useCallback((next) => {
    const value = { name: String(next.name || '').trim(), email: String(next.email || '').trim() };
    setOrgState(value);
    writeJSON(ORG_KEY, value);
  }, []);

  return [org, setOrg];
}
