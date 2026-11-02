import { cleanEmail, emailError, emailTypo, passwordError } from './validate';

test('emails are trimmed and lowercased before checking', () => {
  expect(cleanEmail('  Ana@Clinic.ORG ')).toBe('ana@clinic.org');
  expect(emailError(' ana@clinic.org ')).toBeNull();
});

test('common email typos get a suggestion; real addresses don’t', () => {
  expect(emailTypo('ana@gmial.com')).toBe('ana@gmail.com');
  expect(emailTypo('Ana@Gmail.con')).toBe('ana@gmail.com');
  expect(emailTypo('ana@hotmal.com')).toBe('ana@hotmail.com');
  expect(emailTypo('ana@riverside.ogr')).toBe('ana@riverside.org');
  for (const ok of ['ana@gmail.com', 'ana@mail.com', 'ana@ymail.com', 'ana@riverside.org', 'ana@clinic.co', 'ana@clinic']) {
    expect(emailTypo(ok)).toBeNull();
  }
});

test('passwords: 10 to 128 characters, nothing else required', () => {
  expect(passwordError('')).toMatch(/Enter a password/);
  expect(passwordError('short one')).toMatch(/at least 10/);
  expect(passwordError('blue river clinic door')).toBeNull();
  expect(passwordError('aaaaaaaaaa')).toBeNull(); // no symbol or capital rules
  expect(passwordError('x'.repeat(129))).toMatch(/at most 128/);
});
