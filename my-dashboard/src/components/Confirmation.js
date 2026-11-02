import { useEffect, useRef } from 'react';
import { suppliesLabel } from '../inventory';
import Icon from './Icons';

export default function Confirmation({ sent, onBrowse, onViewRequests }) {
  const headingRef = useRef(null);
  useEffect(() => headingRef.current.focus(), []);
  const email = sent && sent.email;

  return (
    <div className="confirm">
      <div className="confirm__mark" aria-hidden="true"><Icon name="check" size={28} /></div>
      <h1 className="page-title" tabIndex={-1} ref={headingRef}>Request submitted</h1>
      {sent && (
        <p className="confirm__lead">
          {sent.orgName} asked for {suppliesLabel(sent.lineCount, sent.lotCount)}, {sent.totalUnits.toLocaleString('en-US')} {sent.totalUnits === 1 ? 'unit' : 'units'} in all.
        </p>
      )}
      {email && (
        <p className="confirm__email">
          <Icon name="mail" size={20} />
          <span>A confirmation email is on its way to <strong>{email}</strong>.</span>
        </p>
      )}

      {sent && sent.lines && (
        <section className="confirm__summary" aria-labelledby="confirm-summary-title">
          <h2 id="confirm-summary-title" className="section-title">Supplies requested</h2>
          <ol className="summary">
            {sent.lines.map((l) => (
              <li key={l.id}>
                <span className="summary__name">{l.name}</span>
                <span className="summary__qty num">{l.quantity.toLocaleString('en-US')}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <h2 className="section-title">What happens next</h2>
      <ol className="steps">
        <li>
          <strong>Our team reviews your request.</strong> You’ll usually hear back within 48 hours.
        </li>
        <li>
          <strong>You get an email when it’s approved</strong>, and again when it ships.
        </li>
        <li>
          <strong>Check on it any time</strong> under My requests.
        </li>
      </ol>

      <div className="confirm__actions no-print">
        <button type="button" className="btn btn--primary" onClick={onBrowse}>Request more supplies</button>
        <button type="button" className="btn btn--secondary" onClick={onViewRequests}>View my requests</button>
        <button type="button" className="btn btn--secondary" onClick={() => window.print()}>Print</button>
      </div>
    </div>
  );
}
