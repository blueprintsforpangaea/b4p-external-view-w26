import { Fragment, memo, useState } from 'react';
import { ProductIcon } from '../catalogIcons';
import { badgesFor, formatExpiry, formatMonth, stockLabel } from '../inventory';
import Badges from './Badges';
import RequestControl from './RequestControl';

const batches = (n) => `${n} ${n === 1 ? 'batch' : 'batches'}`;

// The sheet's generic name, unless it just repeats the row or group name.
function showGeneral(item, group) {
  const bare = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '').replace(/e$/, '');
  const g = bare(item.general || '');
  return !!g && g !== bare(item.name) && g !== bare(group.label);
}

const qty = (n) => (n == null ? '–' : n.toLocaleString('en-US'));

// One product row (plus its lot breakdown when open). Memoised: changing one
// stepper re-renders only that row, not the other few hundred.
const ProductRow = memo(function ProductRow({ p, group, quantity, onQuantity, onOpenItem }) {
  const [expanded, setExpanded] = useState(false);
  const many = p.lots.length > 1;
  const lotsId = `lots-${p.row}`;
  return (
    <Fragment>
      <tr className="item-row" data-row={p.row}>
        <td className="spec__supply">
          <button type="button" className="linklike item-row__name" onClick={() => onOpenItem(p.row)}>
            {p.name}
          </button>
          {showGeneral(p, group) && <span className="item-row__general">{p.general}</span>}
          <Badges badges={badgesFor(p, p.onHold)} />
        </td>
        <td className="spec__maker" data-label="Maker">{p.manufacturer || '–'}</td>
        <td className="spec__lot num" data-label={many ? undefined : 'Batch'} title={many ? undefined : p.lot || undefined}>
          {many ? (
            <button
              type="button"
              className="linklike lots-toggle"
              aria-expanded={expanded}
              aria-controls={lotsId}
              onClick={() => setExpanded((v) => !v)}
            >
              {batches(p.lots.length)}
            </button>
          ) : (p.lot || '–')}
        </td>
        <td className="spec__exp num" title={p.expiry ? formatExpiry(p.expiry) : undefined}>
          {/* Month only in the table; the batch breakdown and detail show the full date. */}
          {!p.expiry ? '–' : `Use by ${formatMonth(p.expiry)}`}
        </td>
        <td className="spec__stock num">
          {p.onHold ? 'On hold' : stockLabel(p.quantity)}
        </td>
        <td className="spec__qty">
          <RequestControl item={p} quantity={quantity} onChange={(n) => onQuantity(p, n)} compact />
        </td>
      </tr>
      {many && expanded && (
        <tr className="lots-row" id={lotsId}>
          <td colSpan={6}>
            <table className="lots">
              <caption className="visually-hidden">Batches of {p.name}</caption>
              <thead>
                <tr>
                  <th scope="col">Batch</th>
                  <th scope="col">Box</th>
                  <th scope="col">Use by</th>
                  <th scope="col" className="lots__qty">In stock</th>
                </tr>
              </thead>
              <tbody>
                {p.lots.map((l) => (
                  <tr key={l.id}>
                    <td>{l.lot || '–'}</td>
                    <td>{l.box ? `Box ${l.box}` : '–'}</td>
                    <td>{l.expiry ? formatExpiry(l.expiry) : '–'}</td>
                    <td className="lots__qty">{qty(l.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </Fragment>
  );
});

// One product type: drawing once in the header, then a dense spec table with
// one row per product (A–Z). `quantities` is the cart as a Map(product id -> qty).
function TypeTable({ group, quantities, onQuantity, onOpenItem, limit, headingLevel = 2 }) {
  const Heading = `h${headingLevel}`;
  const rows = limit ? group.items.slice(0, limit) : group.items;
  const headingId = `type-${group.slug}${group.category ? `-${group.category.slug}` : ''}${group.alsoMatched ? '-also' : ''}`;
  return (
    <section className="type" id={headingId} aria-labelledby={`${headingId}-h`} tabIndex={-1}>
      <div className="type__head">
        <span className="type__art"><ProductIcon type={group.icon} size={32} /></span>
        <Heading className="type__title" id={`${headingId}-h`}>
          {group.label} <span className="type__count num">{group.items.length.toLocaleString('en-US')}</span>
        </Heading>
        {group.category && <span className="type__cat">in {group.category.name}</span>}
      </div>
      <table className="spec">
        <thead>
          <tr>
            <th scope="col" className="spec__supply">Supply</th>
            <th scope="col" className="spec__maker">Maker</th>
            <th scope="col" className="spec__lot">Batch</th>
            <th scope="col" className="spec__exp">Use by</th>
            <th scope="col" className="spec__stock">In stock</th>
            <th scope="col" className="spec__qty"><span className="visually-hidden">Quantity to request</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <ProductRow
              key={p.id}
              p={p}
              group={group}
              quantity={quantities.get(p.id) || 0}
              onQuantity={onQuantity}
              onOpenItem={onOpenItem}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

// Skip re-rendering a whole section unless one of its own rows' quantities changed.
function sameSection(a, b) {
  if (a.group !== b.group || a.limit !== b.limit || a.onQuantity !== b.onQuantity || a.onOpenItem !== b.onOpenItem) return false;
  if (a.quantities === b.quantities) return true;
  const rows = a.limit ? a.group.items.slice(0, a.limit) : a.group.items;
  return rows.every((p) => a.quantities.get(p.id) === b.quantities.get(p.id));
}

export default memo(TypeTable, sameSection);
