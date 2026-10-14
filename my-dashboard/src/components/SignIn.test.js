import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEMO } from '../auth/mockAuth';
import { SignIn, Welcome } from './SignIn';

const CONTACT = 'contact@b4pglobal.org';
beforeEach(() => window.localStorage.clear());

const fill = (email, password) => {
  userEvent.clear(screen.getByLabelText('Email'));
  userEvent.type(screen.getByLabelText('Email'), email);
  userEvent.type(screen.getByLabelText('Password'), password);
  userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
};

test('checks the email before sending anything', () => {
  const onSignedIn = jest.fn();
  render(<SignIn onSignedIn={onSignedIn} contactEmail={CONTACT} />);
  fill('ana@clinic', 'whatever');
  expect(screen.getByText(/doesn’t look like an email address/)).toBeInTheDocument();
  expect(screen.getByLabelText('Email')).toHaveFocus();
  expect(onSignedIn).not.toHaveBeenCalled();
});

test('signs in with a trimmed, lowercased email', async () => {
  const onSignedIn = jest.fn();
  render(<SignIn onSignedIn={onSignedIn} contactEmail={CONTACT} />);
  fill('  Clinic@Riverside.ORG ', DEMO.password);
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(expect.objectContaining({ email: DEMO.email })), { timeout: 2000 });
});

test('a wrong password clears the field and says so, then five misses pause sign-in', async () => {
  render(<SignIn onSignedIn={jest.fn()} contactEmail={CONTACT} />);
  fill(DEMO.email, 'not-the-password');
  expect(await screen.findByText('That email and password don’t match.', {}, { timeout: 2000 })).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toHaveValue('');
  expect(screen.queryByText('Enter your password.')).not.toBeInTheDocument();
  for (let i = 0; i < 4; i += 1) {
    userEvent.type(screen.getByLabelText('Password'), `wrong-${i}`);
    userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('button', { name: 'Sign in' }, { timeout: 2000 }); // done sending
  }
  expect(await screen.findByText('Too many tries.', {}, { timeout: 2000 })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
});

test('invite setup shows the clinic and blocks weak or mismatched passwords', async () => {
  const onSignedIn = jest.fn();
  render(<Welcome token={DEMO.invite} onSignedIn={onSignedIn} contactEmail={CONTACT} />);
  expect(await screen.findByText('Hillside Health Center', {}, { timeout: 2000 })).toBeInTheDocument();
  userEvent.type(screen.getByLabelText('New password'), 'password123');
  userEvent.type(screen.getByLabelText('Confirm password'), 'password12');
  userEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
  expect(screen.getByText(/not a common password/)).toBeInTheDocument();
  expect(screen.getByText('The two passwords don’t match.')).toBeInTheDocument();
  expect(onSignedIn).not.toHaveBeenCalled();
});

test('an expired invite says how to get a new one', async () => {
  render(<Welcome token="expired-invite" onSignedIn={jest.fn()} contactEmail={CONTACT} />);
  expect(await screen.findByText('This invite link has expired', {}, { timeout: 2000 })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Email us for a new link' })).toBeInTheDocument();
});
