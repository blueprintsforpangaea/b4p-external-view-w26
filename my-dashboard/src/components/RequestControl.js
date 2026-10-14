import { useEffect, useRef, useState } from 'react';
import { canRequest } from '../inventory';
import Icon from './Icons';
import QuantityStepper from './QuantityStepper';

const ADDED_MS = 1800; // matches the added-tag animation in styles.css

// "Add to list" until the item is in the request, then a stepper. When the stepper
// goes back to 0 while focused, focus moves to the Add button that replaces it.
export default function RequestControl({ item, quantity, onChange, compact }) {
  const addRef = useRef(null);
  const stepperFocused = useRef(false);
  // After Add, a green "Added" sits over the new stepper for a moment, then fades into it
  // (the toast region announces it too).
  const [justAdded, setJustAdded] = useState(false);
  useEffect(() => {
    if (!justAdded) return undefined;
    const t = setTimeout(() => setJustAdded(false), ADDED_MS);
    return () => clearTimeout(t);
  }, [justAdded]);

  useEffect(() => {
    if (!quantity && stepperFocused.current && addRef.current) {
      stepperFocused.current = false;
      addRef.current.focus();
    }
  }, [quantity]);

  if (!canRequest(item)) {
    return (
      <p className="request-control__blocked">
        {item.expiryState === 'expired' ? 'Expired, can’t be requested' : item.onHold ? 'On hold' : 'Out of stock'}
      </p>
    );
  }
  if (!quantity) {
    return (
      <button
        ref={addRef}
        type="button"
        className="btn btn--secondary btn--add"
        onClick={() => {
          onChange(1);
          setJustAdded(true);
        }}
        aria-label={`Add ${item.name} to request`}
      >
        Add to list
      </button>
    );
  }
  return (
    <div
      className="request-control"
      onFocus={() => { stepperFocused.current = true; }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) stepperFocused.current = false;
      }}
    >
      <div className="request-control__stepper">
        <QuantityStepper
          value={quantity}
          max={item.quantity}
          onChange={onChange}
          itemName={item.name}
          compact={compact}
        />
        {justAdded && (
          <span className="request-control__added" aria-hidden="true"><Icon name="check" size={18} /> Added</span>
        )}
      </div>
    </div>
  );
}
