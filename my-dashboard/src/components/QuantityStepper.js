import { useEffect, useId, useState } from 'react';
import Icon from './Icons';
import { capQuantity } from '../useCart';

// [-] n [+] that edits the request directly. 0 removes the line.
export default function QuantityStepper({ value, max, onChange, itemName, compact = false }) {
  const [draft, setDraft] = useState(String(value));
  const id = useId();
  useEffect(() => setDraft(String(value)), [value]);

  const limit = max == null ? undefined : max;
  const atMax = limit != null && value >= limit;

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === '') {
      setDraft(String(value));
      return;
    }
    const next = capQuantity(trimmed, limit);
    onChange(next);
    setDraft(String(next || value));
  };

  return (
    <div className={`stepper${compact ? ' stepper--compact' : ''}`}>
      <button
        type="button"
        className="stepper__btn"
        onClick={() => onChange(value - 1)}
        aria-label={value <= 1 ? `Remove ${itemName} from request` : `One fewer ${itemName}`}
      >
        <Icon name="minus" size={18} />
      </button>
      <label className="visually-hidden" htmlFor={id}>Quantity of {itemName}</label>
      <input
        id={id}
        className="stepper__input num"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
      <button
        type="button"
        className="stepper__btn"
        onClick={() => onChange(value + 1)}
        disabled={atMax}
        aria-label={atMax ? `All ${limit} ${itemName} are in your request` : `One more ${itemName}`}
      >
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}
