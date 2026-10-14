import { cleanEmail, emailError, passwordChecks, validateNewPassword, validateSignIn } from './validate';

test('emails are trimmed and lowercased before checking', () => {
  expect(cleanEmail('  Ana@Clinic.ORG ')).toBe('ana@clinic.org');
  expect(emailError(' ana@clinic.org ')).toBeNull();
});

test('sign-in needs a real-looking email and a password', () => {
  expect(validateSignIn({ email: '', password: '' })).toEqual({ email: expect.any(String), password: expect.any(String) });
  expect(validateSignIn({ email: 'ana@clinic', password: 'x' }).email).toMatch(/email address/);
  expect(validateSignIn({ email: 'ana@clinic.org', password: 'x'.repeat(129) }).password).toMatch(/128/);
  expect(validateSignIn({ email: 'ana@clinic.org', password: 'anything' })).toEqual({});
});

test('new passwords: length, not the email, not common', () => {
  const ok = (p) => passwordChecks(p, 'ana.morales@clinic.org').every((c) => c.ok);
  expect(ok('short')).toBe(false);
  expect(ok('ana.morales-2026')).toBe(false);
  expect(ok('password123')).toBe(false);
  expect(ok('aaaaaaaaaaaa')).toBe(false);
  expect(ok('river bend supplies')).toBe(true);
});

test('the two passwords must match', () => {
  const base = { email: 'ana@clinic.org', password: 'river bend supplies' };
  expect(validateNewPassword({ ...base, confirm: 'river bend' }).confirm).toMatch(/match/);
  expect(validateNewPassword({ ...base, confirm: base.password })).toEqual({});
});
