import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Home from './Home';

const STATS = [[12, 'Supply types available'], [3, 'Categories', 'A hint']];

test('the main page: welcome, notice, totals, search and inventory, steps and contact, in that order', () => {
  render(
    <Home stats={STATS} contactEmail="help@example.org" onSearch={() => {}}>
      <p>the list</p>
    </Home>,
  );
  expect(screen.getByRole('heading', { level: 1, name: 'Welcome, clinic' })).toHaveFocus();
  const inventory = screen.getByRole('region', { name: 'Supply inventory' });
  expect(within(inventory).getByRole('combobox', { name: 'Search supplies' })).toBeInTheDocument(); // right above the list
  expect(screen.getByRole('link', { name: 'Find supplies' })).toHaveAttribute('href', '#/inventory');
  expect(screen.getByRole('link', { name: 'How requesting works' })).toHaveAttribute('href', '#/how-it-works');
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '#/signin');
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
    'Please read before requesting', 'Supply inventory', 'How to request supplies', 'Contact B4P',
  ]);
  const totals = screen.getByRole('region', { name: 'Inventory totals' });
  expect(within(totals).getByText('12')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Supply inventory' })).getByText('the list')).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
  expect(screen.getByRole('link', { name: 'help@example.org' })).toHaveAttribute('href', 'mailto:help@example.org');
});

test('a signed-in clinic is welcomed by name and doesn’t see the Sign in button', () => {
  render(<Home clinic="Riverside Community Clinic" onSearch={() => {}} />);
  expect(screen.getByRole('heading', { level: 1, name: 'Welcome, Riverside Community Clinic' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Inventory totals' })).not.toBeInTheDocument(); // no totals until the list loads
});

test('typing searches; the Search button jumps to the inventory', () => {
  const onSearch = jest.fn();
  render(<Home onSearch={onSearch} />);
  const jump = jest.fn();
  document.getElementById('inventory').scrollIntoView = jump;
  userEvent.type(screen.getByRole('combobox', { name: 'Search supplies' }), 'g');
  expect(onSearch).toHaveBeenCalledWith('g');
  userEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(jump).toHaveBeenCalled();
});

test('with sign-in off, nothing asks the clinic to sign in', () => {
  render(<Home signIn={false} onSearch={() => {}} />);
  expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
  expect(screen.getByText(/Give your clinic’s name and work email/)).toBeInTheDocument();
});
