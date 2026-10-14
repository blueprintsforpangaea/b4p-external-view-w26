import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Guide from './Guide';

test('the guide lists every step and how to reach our team', () => {
  render(<Guide contactEmail="contact@b4pglobal.org" signedIn={false} />);
  expect(screen.getByRole('heading', { level: 1, name: 'How to request supplies' })).toHaveFocus();
  for (const title of ['Set up your account', 'Sign in', 'Find a supply', 'Choose how many', 'Check your list', 'Send it', 'Follow your request']) {
    expect(screen.getByRole('heading', { level: 2, name: new RegExp(title) })).toBeInTheDocument();
  }
  expect(screen.getAllByRole('link', { name: 'contact@b4pglobal.org' }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole('link', { name: 'Start a request' })[0]).toHaveAttribute('href', '#/');
});

test('signed-in clinics don’t see the Sign in button', () => {
  render(<Guide contactEmail="contact@b4pglobal.org" signedIn />);
  expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
});

test('every step has a screenshot with a description', () => {
  render(<Guide contactEmail="contact@b4pglobal.org" signedIn={false} />);
  const shots = screen.getAllByRole('img');
  expect(shots.length).toBeGreaterThanOrEqual(10);
  for (const img of shots) expect(img.getAttribute('alt').length).toBeGreaterThan(30);
  expect(screen.getByRole('img', { name: /red box around the blue Send request button/ })).toBeInTheDocument();
  expect(screen.getByText('In short')).toBeInTheDocument();
});
