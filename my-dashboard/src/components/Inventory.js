import { memo, useMemo, useState } from 'react';
import { applyBaseFilters, collate, daysUntil } from '../inventory';
import RequestControl from './RequestControl';
import { Availability, availabilityOf, Expiry } from './Status';
import { EmptyState } from './States';

const STEP = 150; // rows before "Show more"
const AVAILABILITY = [
  ['available', 'Available', (k) => k === 'available'],
  ['limited', 'Limited quantity', (k) => k === 'limited'],
  ['unconfirmed', 'Quantity not confirmed', (k) => k === 'unconfirmed'],
  ['none', 'Not available', (k) => k === 'none' || k === 'reserved' || k === 'expired'],
];

const EXPIRATION = [
  ['30', 'Expires within 30 days', (d) => d != null && d >= 0 && d <= 30],
  ['90', 'Expires within 90 days', (d) => d != null && d >= 0 && d < 90],
  ['180', 'Expires within 6 months', (d) => d != null && d >= 0 && d <= 182],
  ['later', 'Not expiring soon', (d) => d != null && d >= 90],
  ['none', 'No expiration date recorded', (d) => d == null],
  ['expired', 'Expired', (d) => d != null && d < 0],
];

const byName = (a, b) => collate(a.name, b.name);
const SORTS = [
  ['name', 'Name (A to Z)', byName],
  ['name-desc', 'Name (Z to A)', (a, b) => byName(b, a)],
  ['qty', 'Quantity (most first)', (a, b) => (b.quantity ?? -1) - (a.quantity ?? -1) || byName(a, b)],
  ['qty-asc', 'Quantity (fewest first)', (a, b) => (a.quantity ?? Infinity) - (b.quantity ?? Infinity) || byName(a, b)],
  ['exp', 'Expiration (soonest first)', (a, b) => (a.expiry || '9').localeCompare(b.expiry || '9') || byName(a, b)],
  ['exp-desc', 'Expiration (latest first)', (a, b) => (b.expiry || '').localeCompare(a.expiry || '') || byName(a, b)],
];

// A spreadsheet of what's on screen. Cells that start like a formula are prefixed so
// Excel and Sheets show them as text.
function downloadCsv(rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  const table = [
    ['Supply', 'Maker', 'Category', 'Quantity', 'Availability', 'Expiration'],
    ...rows.map((p) => [p.name, p.manufacturer, p.subcategory, p.quantity, availabilityOf(p).label, p.expiry]),
  ];
  const url = URL.createObjectURL(new Blob([table.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'b4p-supplies.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// One supply. Memoised: changing one quantity re-renders only that row.
const Row = memo(function Row({ p, quantity, onQuantity, onOpenItem }) {
  const a = availabilityOf(p);
  return (
    <tr className={`item-row${a.kind === 'expired' ? ' item-row--expired' : ''}`}>
      <th scope="row" className="spec__supply">
        {a.kind === 'expired'
          ? <span className="item-row__name">{p.name}</span>
          : <button type="button" className="linklike item-row__name" onClick={() => onOpenItem(p.row)}>{p.name}</button>}
        {p.manufacturer && <span className="item-row__general">{p.manufacturer}</span>}
        {a.kind === 'reserved' && (
          <span className="item-row__note">Reserved: other clinics have already asked for all of this, so it can’t be requested right now.</span>
        )}
      </th>
      <td data-label="Category">{p.subcategory}</td>
      <td className="spec__stock num" data-label="Quantity">
        {p.quantity == null ? 'Not confirmed' : <><strong>{p.quantity.toLocaleString('en-US')}</strong> units</>}
      </td>
      <td data-label="Availability"><Availability item={p} /></td>
      <td className="spec__exp" data-label="Expiration"><Expiry date={p.expiry} /></td>
      <td className="spec__qty">
        <RequestControl item={p} quantity={quantity} onChange={(n) => onQuantity(p, n)} compact />
      </td>
    </tr>
  );
});

function Select({ id, label, value, onChange, children }) {
  return (
    <div className="finder__field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </div>
  );
}

// The inventory: when it was updated, the filters, then every matching supply in one table.
// `products` can be requested; `expired` are shown greyed when "Hide expired items" is off.
export default function Inventory({ products, expired, query, quantities, onQuantity, onOpenItem, updated, onRefresh, refreshing }) {
  const [category, setCategory] = useState('');
  const [availability, setAvailability] = useState('');
  const [expiration, setExpiration] = useState('');
  const [sort, setSort] = useState('name');
  const [hideExpired, setHideExpired] = useState(true);
  const [limit, setLimit] = useState(STEP);

  const all = useMemo(() => applyBaseFilters([...products, ...expired], {}), [products, expired]);
  const categories = useMemo(() => [...new Set(all.map((p) => p.subcategory))].sort(collate), [all]);
  // Choosing "Expired" in Expiration shows expired items even with the box ticked.
  const withExpired = !hideExpired || expiration === 'expired';

  const visible = useMemo(() => {
    const avail = AVAILABILITY.find((o) => o[0] === availability);
    const exp = EXPIRATION.find((o) => o[0] === expiration);
    const order = SORTS.find((o) => o[0] === sort)[2];
    return applyBaseFilters(withExpired ? all : products, { query }).filter((p) => (
      (!category || p.subcategory === category)
      && (!avail || avail[2](availabilityOf(p).kind))
      && (!exp || exp[2](daysUntil(p.expiry)))
    )).sort(order);
  }, [all, products, withExpired, query, category, availability, expiration, sort]);

  const key = `${query}|${category}|${availability}|${expiration}|${sort}|${withExpired}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setLimit(STEP);
  }
  const total = withExpired ? all.length : products.length;
  const count = visible.length;
  const clear = () => { setCategory(''); setAvailability(''); setExpiration(''); };

  return (
    <>
      <p className="inv__updated">
        {updated && <>Last updated {updated} </>}
        <button type="button" className="btn btn--secondary btn--sm" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </p>

      <fieldset className="finder">
        <legend className="finder__legend">Narrow the list</legend>
        <Select id="f-category" label="Category" value={category} onChange={setCategory}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select id="f-availability" label="Availability" value={availability} onChange={setAvailability}>
          <option value="">Any availability</option>
          {AVAILABILITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select id="f-expiration" label="Expiration" value={expiration} onChange={setExpiration}>
          <option value="">Any expiration</option>
          {EXPIRATION.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select id="f-sort" label="Sort by" value={sort} onChange={setSort}>
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <label className="finder__check">
          <input type="checkbox" checked={hideExpired} onChange={(e) => setHideExpired(e.target.checked)} />
          Hide expired items
        </label>
      </fieldset>

      <div className="inv__bar">
        <p className="finder__count" role="status">
          Showing <span className="num">{Math.min(limit, count).toLocaleString('en-US')}</span> of{' '}
          <span className="num">{count.toLocaleString('en-US')}</span> {count === 1 ? 'listing' : 'listings'}
          {count < total && <> (from <span className="num">{total.toLocaleString('en-US')}</span>)</>}
        </p>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => downloadCsv(visible)} disabled={!count}>
          Download this list (CSV)
        </button>
      </div>

      {count === 0 ? (
        <EmptyState
          title="Nothing matches"
          action={<button type="button" className="btn btn--secondary" onClick={clear}>Clear filters</button>}
        >
          Try a shorter word, like “syringe” instead of a part number, or clear the filters.
        </EmptyState>
      ) : (
        <>
          <table className="spec inv__table">
            <thead>
              <tr>
                <th scope="col" className="spec__supply">Supply</th>
                <th scope="col" className="inv__cat">Category</th>
                <th scope="col" className="spec__stock">Quantity</th>
                <th scope="col" className="inv__avail">Availability</th>
                <th scope="col" className="spec__exp">Expiration</th>
                <th scope="col" className="spec__qty"><span className="visually-hidden">Request</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, limit).map((p) => (
                <Row key={p.id} p={p} quantity={quantities.get(p.id) || 0} onQuantity={onQuantity} onOpenItem={onOpenItem} />
              ))}
            </tbody>
          </table>
          {limit < count && (
            <div className="more">
              <button type="button" className="btn btn--secondary" onClick={() => setLimit((n) => n + STEP)}>
                Show more
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
