import { render, screen } from '@testing-library/react';
import { Availability, availabilityOf, Expiry, Status } from './Status';

const inDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.each([
  [{ quantity: 50 }, 'available', 'Available'],
  [{ quantity: 10 }, 'limited', 'Limited quantity'],
  [{ quantity: null }, 'unconfirmed', 'Quantity not confirmed'],
  [{ quantity: 0 }, 'none', 'Not available'],
  [{ quantity: 5, onHold: true }, 'reserved', 'Reserved'],
  [{ quantity: 5, expiryState: 'expired' }, 'expired', 'Expired'],
])('availability of %j is %s', (item, kind, label) => {
  expect(availabilityOf(item)).toEqual({ kind, label });
  const { container } = render(<Availability item={item} />);
  expect(container.firstChild).toHaveClass(`badge--${kind}`);
  expect(container.firstChild).toHaveTextContent(label);
});

test.each([
  [inDays(-3), 'Expired'],
  [inDays(10), 'Expires within 30 days'],
  [inDays(60), 'Expires within 90 days'],
  [inDays(400), 'Not expiring soon'],
])('expiry %s reads "%s" under the date', (date, note) => {
  render(<Expiry date={date} />);
  expect(screen.getByText(note)).toBeInTheDocument();
});

test('no date reads "Not recorded" with no note; Status shows nothing for a missing supply', () => {
  const { container } = render(<><Expiry date="" /><Status item={undefined} /></>);
  expect(container).toHaveTextContent(/^Not recorded$/);
});
