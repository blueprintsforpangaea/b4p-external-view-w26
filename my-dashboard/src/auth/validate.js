// Checks run in the browser before anything is sent. The server repeats them;
// these exist so clinic staff see a clear message right away.

export const MAX_EMAIL = 254;
export const EMAIL_RE = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;

// What people paste often has spaces or capitals around it.
export function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function emailError(value) {
  const email = cleanEmail(value);
  if (!email) return 'Enter your work email.';
  if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) return 'That doesn’t look like an email address. Check it looks like name@clinic.org.';
  return null;
}

// Mail providers clinic staff mistype most. A domain one or two letters off one of
// these is almost always a typo, so we offer the fix (we never change it ourselves).
const COMMON_DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'live.com', 'msn.com', 'proton.me'];
// Real providers that sit close to those; never "corrected".
const REAL_DOMAINS = ['mail.com', 'ymail.com', 'gmx.com', 'me.com', 'mac.com', 'live.ca', 'aim.com'];
const TLD_FIXES = { con: 'com', cmo: 'com', ocm: 'com', comm: 'com', vom: 'com', xom: 'com', ogr: 'org', rog: 'org', orgg: 'org', nte: 'net', ent: 'net' };

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

// "ana@gmial.com" -> "ana@gmail.com"; null when the address looks fine.
export function emailTypo(value) {
  const email = cleanEmail(value);
  if (emailError(email)) return null;
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  let domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const tld = domain.slice(dot + 1);
  if (TLD_FIXES[tld]) domain = `${domain.slice(0, dot)}.${TLD_FIXES[tld]}`;
  if (!COMMON_DOMAINS.includes(domain) && !REAL_DOMAINS.includes(domain)) {
    const close = COMMON_DOMAINS.find((d) => editDistance(domain, d) <= (d.length > 8 ? 2 : 1));
    if (close) domain = close;
  }
  const fixed = `${local}@${domain}`;
  return fixed === email ? null : fixed;
}

// The same limits as the server (app/auth.py). No rules about symbols or capitals: length is
// what makes a password hard to guess, and a few words together are easy to remember.
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 128;

export function passwordError(value) {
  if (!value) return 'Enter a password.';
  if (value.length < MIN_PASSWORD) {
    return `Use at least ${MIN_PASSWORD} characters. A few words together works well, like “blue river clinic door”.`;
  }
  if (value.length > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters.`;
  return null;
}
