import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangePassword, ResetPassword } from './Password';

const NEW = 'a brand new password';
const json = (status, data) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) });

afterEach(() => jest.restoreAllMocks());

function setNew(pw = NEW, again = NEW) {
  userEvent.type(screen.getByLabelText('New password'), pw);
  userEvent.type(screen.getByLabelText('Type it again'), again);
}

test('a reset link: choose a new password and you are signed in', async () => {
  const sent = [];
  jest.spyOn(global, 'fetch').mockImplementation((url, opts) => {
    sent.push([url.replace(/^.*?(\/api\/)/, '$1'), JSON.parse(opts.body)]);
    return json(200, { email: 'ana@riverside.org', org_name: 'Riverside Clinic', role: 'clinic' });
  });
  const onSignedIn = jest.fn();
  render(<ResetPassword token="tok-123" onSignedIn={onSignedIn} contactEmail="help@b4p.org" />);
  setNew();
  userEvent.click(screen.getByRole('button', { name: 'Save and sign in' }));
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith({ email: 'ana@riverside.org', org: 'Riverside Clinic', role: 'clinic' }));
  expect(sent).toEqual([['/api/auth/password/reset', { token: 'tok-123', password: NEW }]]);
});

test('a used or expired link says who to ask', async () => {
  jest.spyOn(global, 'fetch').mockImplementation(() => json(400, { detail: 'This reset link has expired or was already used. Ask the Blueprints team for a new one.' }));
  render(<ResetPassword token="tok-123" onSignedIn={jest.fn()} contactEmail="help@b4p.org" />);
  setNew();
  userEvent.click(screen.getByRole('button', { name: 'Save and sign in' }));
  expect(await screen.findByText(/expired or was already used/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'help@b4p.org' })).toBeInTheDocument();
});

test('the new password is checked before sending: long enough, and typed the same twice', () => {
  const fetchSpy = jest.spyOn(global, 'fetch');
  render(<ResetPassword token="tok-123" onSignedIn={jest.fn()} contactEmail="help@b4p.org" />);
  setNew('short', 'short');
  userEvent.click(screen.getByRole('button', { name: 'Save and sign in' }));
  expect(screen.getByText(/at least 10 characters/)).toBeInTheDocument();
  userEvent.clear(screen.getByLabelText('New password'));
  userEvent.clear(screen.getByLabelText('Type it again'));
  setNew(NEW, `${NEW}!`);
  userEvent.click(screen.getByRole('button', { name: 'Save and sign in' }));
  expect(screen.getByText('The two passwords don’t match.')).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('change password needs the current one', async () => {
  const sent = [];
  jest.spyOn(global, 'fetch').mockImplementation((url, opts) => {
    const body = JSON.parse(opts.body);
    sent.push(body);
    return body.current_password === 'old password!!' ? json(200, { ok: true }) : json(403, { detail: 'Your current password isn’t right.' });
  });
  const onDone = jest.fn();
  render(<ChangePassword account={{ email: 'ana@riverside.org', org: 'Riverside Clinic', role: 'clinic' }} onDone={onDone} />);
  setNew();
  userEvent.click(screen.getByRole('button', { name: 'Change password' }));
  expect(screen.getByText('Enter your current password.')).toBeInTheDocument();
  userEvent.type(screen.getByLabelText('Current password'), 'wrong one!!');
  userEvent.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByText(/current password isn’t right/)).toBeInTheDocument();
  userEvent.clear(screen.getByLabelText('Current password'));
  userEvent.type(screen.getByLabelText('Current password'), 'old password!!');
  userEvent.click(screen.getByRole('button', { name: 'Change password' }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(sent.at(-1)).toEqual({ current_password: 'old password!!', new_password: NEW });
});
