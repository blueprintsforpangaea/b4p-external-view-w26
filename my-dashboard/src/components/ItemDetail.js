import { badgesFor, daysUntil, formatExpiry, stockLabel } from '../inventory';
import Badges from './Badges';
import Dialog from './Dialog';
import Icon from './Icons';
import RequestControl from './RequestControl';
import { ProductIcon } from '../catalogIcons';

// Notes often repeat across lots; show each distinct note once.
function notesOf(product) {
  return [...new Set(product.lots.map((l) => l.notes).filter(Boolean))];
}

function expiryText(item) {
  if (!item.expiry) return 'No use-by date listed';
  const days = daysUntil(item.expiry);
  const date = formatExpiry(item.expiry);
  if (days < 0) return `Expired on ${date}`;
  if (days === 0) return `Expires today, ${date}`;
  if (days < 90) return `${date}, in ${days} day${days === 1 ? '' : 's'}`;
  return date;
}

export default function ItemDetail({ item, onHold, quantity, onQuantity, onClose, missing }) {
  return (
    <Dialog onClose={onClose} labelledBy="item-detail-title" variant="side" className="detail">
      <div className="detail__bar">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details" data-autofocus>
          <Icon name="close" />
        </button>
      </div>
      {missing ? (
        <div className="detail__content">
          <h2 id="item-detail-title" className="detail__title">This supply isn’t in the list anymore</h2>
          <p>It may have been shipped or removed. Close this panel to keep browsing.</p>
        </div>
      ) : (
        <div className="detail__content">
          <div className="detail__art"><ProductIcon type={item.icon} size={96} /></div>
          <p className="detail__sub">{item.subcategory}, {item.type}</p>
          <h2 id="item-detail-title" className="detail__title">{item.name}</h2>
          <p className="detail__stock num">{stockLabel(item.quantity)}</p>
          <Badges badges={badgesFor(item, onHold)} />
          {onHold && (
            <p className="detail__note">Other clinics have already asked for all of this. You can still request it; our team will let you know what we can send.</p>
          )}
          {item.needsReview && (
            <p className="detail__note">Our team checks this supply by hand before it ships, so approval may take a little longer.</p>
          )}
          <div className="detail__action">
            <RequestControl item={item} quantity={quantity} onChange={onQuantity} />
          </div>
          <dl className="facts">
            <div><dt>Type</dt><dd>{item.general || 'Not listed'}</dd></div>
            <div><dt>Maker</dt><dd>{item.manufacturer || 'Not listed'}</dd></div>
            <div><dt>{item.lots.length > 1 ? 'Earliest use by' : 'Use by'}</dt><dd>{expiryText(item)}</dd></div>
            <div><dt>Warehouse category</dt><dd>{item.category || 'Not listed'}</dd></div>
          </dl>
          <h3 className="detail__h3">
            {item.lots.length > 1 ? `${item.lots.length} batches, soonest to expire first` : 'Batch'}
          </h3>
          <table className="lots lots--detail">
            <thead>
              <tr>
                <th scope="col">Batch</th>
                <th scope="col">Box</th>
                <th scope="col">Use by</th>
                <th scope="col" className="lots__qty">In stock</th>
              </tr>
            </thead>
            <tbody>
              {item.lots.map((l) => (
                <tr key={l.id} className={l.expiryState === 'expired' ? 'lots__expired' : undefined}>
                  <td className="num">{l.lot || '–'}</td>
                  <td className="num">{l.box ? `Box ${l.box}` : '–'}</td>
                  <td className="num">{l.expiry ? formatExpiry(l.expiry) : '–'}{l.expiryState === 'expired' && ' (expired)'}</td>
                  <td className="lots__qty num">{l.quantity == null ? '–' : l.quantity.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {notesOf(item).length > 0 && (
            <>
              <h3 className="detail__h3">Notes</h3>
              {notesOf(item).map((n) => <p key={n} className="detail__notes">{n}</p>)}
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
