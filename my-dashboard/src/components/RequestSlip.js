import { MAX_LINES } from '../useCart';
import Icon from './Icons';
import Progress from './Progress';
import QuantityStepper from './QuantityStepper';

const today = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// The request (cart), shown in a right-hand drawer.
export default function RequestSlip({ lines, totalUnits, org, notice, onDismissNotice, onQuantity, onRemove, onOpenItem, onReview, onClear, headingId = 'slip-title', onClose }) {
  const empty = lines.length === 0;
  return (
    <section className="slip" aria-labelledby={headingId}>
      <div className="slip__band">
        <h2 id={headingId} className="slip__title">Your list</h2>
        <span className="slip__date">{today()}</span>
        {onClose && (
          <button type="button" className="icon-btn slip__close" onClick={onClose} aria-label="Close your list" data-autofocus>
            <Icon name="close" />
          </button>
        )}
      </div>
      <Progress step={2} />
      <div className="slip__from">
        <span className="slip__label">From</span>
        <span className={org.name ? 'slip__org' : 'slip__org slip__org--blank'}>
          {org.name || 'Added when you send'}
        </span>
      </div>

      {notice && (
        <div className="slip__notice" role="status">
          <p>{notice}</p>
          <button type="button" className="linklike" onClick={onDismissNotice}>Dismiss</button>
        </div>
      )}

      {empty ? (
        <p className="slip__empty">
          Nothing here yet. Choose <strong>Add to list</strong> next to any supply and it will appear here.
        </p>
      ) : (
        <ol className="slip__lines">
          {lines.map((line, i) => (
            <li key={line.id} className="slip__line">
              <span className="slip__no num" aria-hidden="true">{i + 1}</span>
              <div className="slip__item">
                <button type="button" className="linklike slip__name" onClick={() => onOpenItem(line.id)}>
                  {line.name}
                </button>
                <span className="slip__avail num">
                  {line.max != null ? `${line.max.toLocaleString('en-US')} in stock` : 'Quantity not listed'}
                  {line.lotCount > 1 ? `, from ${line.lotCount} batches` : ''}
                </span>
              </div>
              <div className="slip__qty">
                <QuantityStepper value={line.quantity} max={line.max} onChange={(n) => onQuantity(line, n)} itemName={line.name} compact />
                <button type="button" className="linklike slip__remove" onClick={() => onRemove(line.id)}>
                  Remove<span className="visually-hidden"> {line.name}</span>
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {!empty && (
        <div className="slip__foot">
          <p className="slip__total">
            <span className="num">{lines.length}</span> {lines.length === 1 ? 'supply' : 'supplies'},{' '}
            <span className="num">{totalUnits.toLocaleString('en-US')}</span> {totalUnits === 1 ? 'unit' : 'units'}
          </p>
          {lines.length >= MAX_LINES && (
            <p className="slip__limit">This request is full. It can include up to {MAX_LINES} different supplies.</p>
          )}
          <button type="button" className="btn btn--primary btn--block" onClick={onReview}>
            Review and send
          </button>
          <button type="button" className="linklike slip__clearall" onClick={onClear}>Clear all</button>
        </div>
      )}
    </section>
  );
}
