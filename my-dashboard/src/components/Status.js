import { daysUntil, formatExpiry } from '../inventory';

// The availability badge and the expiry date with its note, in the chapter inventory site's
// style. One place, so the table, phone cards, supply detail, Your list and the review page match.

const LIMITED_AT = 10; // this many units or fewer reads "Limited quantity"

export function availabilityOf(p) {
  if (p.expiryState === 'expired') return { kind: 'expired', label: 'Expired' };
  if (p.onHold) return { kind: 'reserved', label: 'Reserved' };
  if (p.quantity == null) return { kind: 'unconfirmed', label: 'Quantity not confirmed' };
  if (p.quantity === 0) return { kind: 'none', label: 'Not available' };
  if (p.quantity <= LIMITED_AT) return { kind: 'limited', label: 'Limited quantity' };
  return { kind: 'available', label: 'Available' };
}

// A shape as well as a colour, so the label still reads in grey or for colour-blind eyes.
const MARK = { available: '●', limited: '◐', unconfirmed: '?', none: '–', reserved: '■', expired: '–' };

export function Availability({ item }) {
  const a = availabilityOf(item);
  return (
    <span className={`badge badge--${a.kind}`}>
      <span className="badge__mark" aria-hidden="true">{MARK[a.kind]}</span>{a.label}
    </span>
  );
}

// [kind, label] for the note under a date, or null when there's no date.
export function expiryNote(iso) {
  const d = daysUntil(iso);
  if (d == null) return null;
  if (d < 0) return ['expired', 'Expired'];
  if (d <= 30) return ['soon', 'Expires within 30 days'];
  if (d < 90) return ['soon', 'Expires within 90 days'];
  return ['ok', 'Not expiring soon'];
}

// "Jul 19, 2026" with its note under it, or "Not recorded".
export function Expiry({ date }) {
  const note = expiryNote(date);
  return (
    <span className="expiry">
      {date ? formatExpiry(date) : 'Not recorded'}
      {note && <span className={`exp exp--${note[0]}`}>{note[1]}</span>}
    </span>
  );
}

// Both, for places with one line per supply (Your list, the review page). Nothing for a supply
// that's no longer in the list.
export function Status({ item }) {
  if (!item) return null;
  return (
    <span className="status">
      <Availability item={item} />
      <Expiry date={item.expiry} />
    </span>
  );
}
