// Checks run in the browser before anything is sent. The server repeats them;
// these exist so clinic staff see a clear message right away.
import { EMAIL_RE } from '../components/CheckoutForm';

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 128; // matches app/auth.py
export const MAX_EMAIL = 254;

// Passwords people pick first. The server has the real list.
const COMMON = new Set([
  'password123', 'password1234', '1234567890', 'qwertyuiop', 'welcome123', 'blueprints', 'blueprints1', 'clinic1234',
]);

// What people paste often has spaces or capitals around it.
export function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function emailError(value) {
  const email = cleanEmail(value);
  if (!email) return 'Enter the email address Blueprints sent your invite to.';
  if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) return 'That doesn’t look like an email address. Check it looks like name@clinic.org.';
  return null;
}

export function validateSignIn({ email, password }) {
  const errors = {};
  const e = emailError(email);
  if (e) errors.email = e;
  if (!password) errors.password = 'Enter your password.';
  else if (password.length > MAX_PASSWORD) errors.password = `Passwords are at most ${MAX_PASSWORD} characters.`;
  return errors;
}

// Each rule is shown as a checklist while the person types.
export function passwordChecks(password, email) {
  const p = password || '';
  const lower = p.toLowerCase();
  const local = cleanEmail(email).split('@')[0];
  return [
    { id: 'length', label: `At least ${MIN_PASSWORD} characters`, ok: p.length >= MIN_PASSWORD && p.length <= MAX_PASSWORD },
    { id: 'email', label: 'Doesn’t contain your email', ok: p.length > 0 && !(local.length >= 3 && lower.includes(local)) },
    { id: 'common', label: 'Not a common password', ok: p.length > 0 && !COMMON.has(lower) && !/^(.)\1+$/.test(p) },
  ];
}

export function validateNewPassword({ password, confirm, email }) {
  const errors = {};
  const failed = passwordChecks(password, email).find((c) => !c.ok);
  if (!password) errors.password = 'Choose a password.';
  else if (password.length > MAX_PASSWORD) errors.password = `Use at most ${MAX_PASSWORD} characters.`;
  else if (failed) errors.password = `Your password needs to meet every rule: ${failed.label.toLowerCase()}.`;
  if (!confirm) errors.confirm = 'Type the password again.';
  else if (confirm !== password) errors.confirm = 'The two passwords don’t match.';
  return errors;
}
