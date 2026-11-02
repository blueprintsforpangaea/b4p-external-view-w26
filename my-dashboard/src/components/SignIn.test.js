import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignIn } from './SignIn';

const CONTACT = 'contact@b4pglobal.org';
const PW = 'blue river clinic door';

// A fake server. `domain` is what the email domain check answers ('ok' by default); that check
// isn't counted in `calls`. Sign-up answers 409 for `taken`; sign-in accepts only PW.
function mockServer({ domain = 'ok', taken = 'old@clinic.org', role = 'clinic' } = {}) {
  const calls = [];
  jest.spyOn(global, 'fetch').mockImplementation((url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    const json = (status, data) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) });
    if (url.includes('/api/auth/check-email')) return json(200, { result: domain });
    calls.push([url.replace(/^.*?(\/api\/)/, '$1'), body, opts.credentials]);
    if (url.endsWith('/api/auth/signup')) {
      return body.email === taken
        ? json(409, { detail: 'That email already has an account. Sign in instead.' })
        : json(200, { email: body.email, org_name: body.org_name, role: 'clinic' });
    }
    if (url.endsWith('/api/auth/login')) {
      return body.password === PW
        ? json(200, { email: body.email, org_name: 'Riverside Clinic', role })
        : json(401, { detail: 'Wrong email or password. After 5 wrong tries in a row the account is locked for 15 minutes.' });
    }
    if (url.endsWith('/api/auth/logout')) return json(200, { ok: true });
    return json(404, {});
  });
  return calls;
}

afterEach(() => jest.restoreAllMocks());

const create = () => userEvent.click(screen.getByRole('button', { name: 'Create an account' }));
function fillNew({ email = 'ana@riverside.org', org = 'Riverside Clinic', pw = PW, again = PW } = {}) {
  userEvent.type(screen.getByLabelText('Work email'), email);
  if (org) userEvent.type(screen.getByLabelText('Clinic name'), org);
  userEvent.type(screen.getByLabelText('Choose a password'), pw);
  userEvent.type(screen.getByLabelText('Type the password again'), again);
}
const submitNew = () => userEvent.click(screen.getByRole('button', { name: 'Create account' }));

test('create an account: email, clinic name and a password, then signed in straight away', async () => {
  const calls = mockServer();
  const onSignedIn = jest.fn();
  render(<SignIn onSignedIn={onSignedIn} contactEmail={CONTACT} />);
  create();
  expect(screen.getByRole('heading', { level: 1, name: 'Create your account' })).toHaveFocus();
  fillNew({ email: ' Ana@Riverside.org ' });
  submitNew();
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(
    { email: 'ana@riverside.org', org: 'Riverside Clinic', role: 'clinic' }, { welcome: true }));
  expect(calls).toEqual([['/api/auth/signup', { email: 'ana@riverside.org', org_name: 'Riverside Clinic', password: PW }, 'include']]);
  expect(screen.queryByText(/code/i)).not.toBeInTheDocument(); // no codes anywhere
});

test('the form says what is missing or wrong before anything is sent', () => {
  const calls = mockServer();
  render(<SignIn onSignedIn={jest.fn()} contactEmail={CONTACT} />);
  create();
  fillNew({ email: 'ana@riverside', org: '', pw: 'short', again: 'short' });
  submitNew();
  expect(screen.getByText(/doesn’t look like an email address/)).toBeInTheDocument();
  expect(screen.getByText('Enter your clinic’s name.')).toBeInTheDocument();
  expect(screen.getByText(/at least 10 characters/)).toBeInTheDocument();
  expect(calls).toEqual([]);
});

test('the two passwords must match', async () => {
  const calls = mockServer({ domain: 'ok' });
  render(<SignIn onSignedIn={jest.fn()} contactEmail={CONTACT} />);
  create();
  fillNew({ email: 'ana@match-test.org', again: 'blue river clinic doer' });
  submitNew();
  expect(screen.getByText('The two passwords don’t match.')).toBeInTheDocument();
  await act(async () => {}); // let the domain check (started on leaving the email box) finish
  expect(calls).toEqual([]);
});

test('an email that already has an account is told to sign in, with a button for it', async () => {
  mockServer();
  render(<SignIn onSignedIn={jest.fn()} contactEmail={CONTACT} />);
  create();
  fillNew({ email: 'old@clinic.org' });
  submitNew();
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/already has an account/);
  expect(screen.getByLabelText('Work email')).toHaveFocus();
  userEvent.click(within(alert).getByRole('button', { name: 'Sign in' }));
  expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
});

test('sign in, and a wrong password says so without saying more', async () => {
  const calls = mockServer();
  const onSignedIn = jest.fn();
  render(<SignIn onSignedIn={onSignedIn} contactEmail={CONTACT} />);
  userEvent.type(screen.getByLabelText('Work email'), 'ana@riverside.org');
  userEvent.type(screen.getByLabelText('Password'), 'not it at all');
  userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText(/Wrong email or password/)).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toHaveFocus(); // ready to try again, not lost at the top
  userEvent.clear(screen.getByLabelText('Password'));
  userEvent.type(screen.getByLabelText('Password'), PW);
  userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith({ email: 'ana@riverside.org', org: 'Riverside Clinic', role: 'clinic' }, { welcome: false }));
  expect(calls.map((c) => c[0])).toEqual(['/api/auth/login', '/api/auth/login']);
  expect(screen.getByText(/Forgot your password\?/)).toBeInTheDocument();
});

test('Show reveals the password so people can check it', () => {
  mockServer();
  render(<SignIn onSignedIn={jest.fn()} contactEmail={CONTACT} />);
  const box = screen.getByLabelText('Password');
  expect(box).toHaveAttribute('type', 'password');
  userEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(box).toHaveAttribute('type', 'text');
});

test('offers a fix for a mistyped email', () => {
  mockServer();
  render(<SignIn onSignedIn={jest.fn()} contactEmail={CONTACT} />);
  userEvent.type(screen.getByLabelText('Work email'), 'ana@gmial.com');
  userEvent.click(screen.getByRole('button', { name: 'Use this' }));
  expect(screen.getByLabelText('Work email')).toHaveValue('ana@gmail.com');
});

// Each test uses its own domain: answers are remembered for the visit.
test('a new account with a domain that doesn’t exist gets a warning first; clicking again goes ahead', async () => {
  const calls = mockServer({ domain: 'no-domain' });
  render(<SignIn onSignedIn={jest.fn()} contactEmail={CONTACT} />);
  create();
  fillNew({ email: 'ana@clinc-typo.org' });
  submitNew();
  expect(await screen.findByText(/couldn’t find the email domain “clinc-typo.org”/)).toBeInTheDocument();
  expect(screen.getByText(/click Create account again/)).toBeInTheDocument();
  expect(calls).toEqual([]);
  submitNew();
  await waitFor(() => expect(calls.map((c) => c[0])).toEqual(['/api/auth/signup']));
});

test('leaving the email box warns about a temporary inbox (new accounts only)', async () => {
  mockServer({ domain: 'disposable' });
  render(<SignIn onSignedIn={jest.fn()} contactEmail={CONTACT} />);
  create();
  userEvent.type(screen.getByLabelText('Work email'), 'x@mailinator.com');
  userEvent.tab();
  expect(await screen.findByText(/temporary inbox/)).toBeInTheDocument();
});

test('if the domain check can’t run, the account is still made', async () => {
  const calls = mockServer();
  jest.spyOn(global, 'fetch').mockImplementationOnce(() => Promise.reject(new TypeError('offline')));
  const onSignedIn = jest.fn();
  render(<SignIn onSignedIn={onSignedIn} contactEmail={CONTACT} />);
  create();
  fillNew({ email: 'ana@another-clinic.org' });
  submitNew();
  await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
  expect(calls.map((c) => c[0])).toEqual(['/api/auth/signup']);
});

test('the team page lets only team accounts in', async () => {
  const calls = mockServer({ role: 'clinic' });
  const onSignedIn = jest.fn();
  render(<SignIn team onSignedIn={onSignedIn} contactEmail={CONTACT} />);
  expect(screen.queryByRole('button', { name: 'Create an account' })).not.toBeInTheDocument();
  userEvent.type(screen.getByLabelText('Work email'), 'ana@riverside.org');
  userEvent.type(screen.getByLabelText('Password'), PW);
  userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText(/isn’t a Blueprints team account/)).toBeInTheDocument();
  expect(onSignedIn).not.toHaveBeenCalled();
  expect(calls.map((c) => c[0])).toEqual(['/api/auth/login', '/api/auth/logout']); // not left half signed in
});
