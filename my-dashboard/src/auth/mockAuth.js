// MOCKUP ONLY. Stands in for the /auth/* endpoints in docs/AUTH_PLAN.md so the
// screens can be reviewed before the backend exists. Nothing here is secure:
// accounts live in this file and in this browser's localStorage.
import { readJSON, writeJSON } from '../storage';
import { cleanEmail } from './validate';

export const DEMO = {
  email: 'clinic@riverside.org',
  password: 'riverside-demo-2026',
  invite: 'demo-invite',
};

const SEED = {
  'clinic@riverside.org': { org: 'Riverside Community Clinic', name: 'Ana Morales', password: DEMO.password },
  'closed@example.org': { org: 'Example Clinic', name: 'Closed Account', password: 'closed-account-1', disabled: true },
};

const INVITES = {
  'demo-invite': { email: 'nurse@hillside.org', org: 'Hillside Health Center', name: 'Joseph Okafor', expires: Date.now() + 6 * 86400000 },
  'expired-invite': { email: 'late@clinic.org', org: 'Lakeview Clinic', name: '', expires: Date.now() - 86400000 },
};

const ACCOUNTS_KEY = 'b4p.mock.accounts.v1';
const ATTEMPTS_KEY = 'b4p.mock.attempts.v1';
export const MAX_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

const wait = (ms = 600) => new Promise((r) => setTimeout(r, ms));
const accounts = () => ({ ...SEED, ...readJSON(ACCOUNTS_KEY, {}) });

export class AuthError extends Error {
  constructor(message, { code, until, left, email } = {}) {
    super(message);
    this.code = code;
    this.until = until;
    this.left = left;
    this.email = email;
  }
}

function publicAccount(email, a) {
  return { email, org: a.org, name: a.name, role: 'clinic' };
}

export async function signIn({ email, password }) {
  await wait();
  const key = cleanEmail(email);
  const attempts = readJSON(ATTEMPTS_KEY, {});
  const entry = attempts[key] || { count: 0, until: 0 };
  if (entry.until > Date.now()) {
    throw new AuthError('locked', { code: 'locked', until: entry.until });
  }
  const account = accounts()[key];
  if (!account || account.password !== password) {
    const count = entry.until && entry.until <= Date.now() ? 1 : entry.count + 1;
    const until = count >= MAX_ATTEMPTS ? Date.now() + LOCK_MINUTES * 60000 : 0;
    writeJSON(ATTEMPTS_KEY, { ...attempts, [key]: { count: until ? 0 : count, until } });
    if (until) throw new AuthError('locked', { code: 'locked', until });
    // Same error whether the email exists or not. (The screens write their own messages.)
    throw new AuthError('mismatch', { code: 'mismatch', left: MAX_ATTEMPTS - count });
  }
  if (account.disabled) {
    throw new AuthError('disabled', { code: 'disabled' });
  }
  writeJSON(ATTEMPTS_KEY, { ...attempts, [key]: undefined });
  return publicAccount(key, account);
}

export async function lookupInvite(token) {
  await wait(300);
  const invite = INVITES[token];
  if (!invite) throw new AuthError('invalid', { code: 'invalid' });
  if (invite.expires < Date.now()) throw new AuthError('expired', { code: 'expired', email: invite.email });
  if (accounts()[invite.email]) throw new AuthError('used', { code: 'used', email: invite.email });
  return { email: invite.email, org: invite.org, name: invite.name };
}

export async function acceptInvite(token, { password }) {
  const invite = await lookupInvite(token);
  await wait();
  const saved = readJSON(ACCOUNTS_KEY, {});
  writeJSON(ACCOUNTS_KEY, { ...saved, [invite.email]: { org: invite.org, name: invite.name, password } });
  return publicAccount(invite.email, invite);
}

// Always "sent", so the page doesn't reveal which emails have accounts.
export async function requestReset() {
  await wait();
  return { ok: true };
}

