import { useEffect, useRef, useState } from 'react';
import { suppliesLabel } from '../inventory';
import Icon from './Icons';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(el);
    return ok;
  }
}

export default function Confirmation({ requestId, sent, onBrowse, onViewRequests }) {
  const [copied, setCopied] = useState(null);
  const headingRef = useRef(null);
  useEffect(() => headingRef.current.focus(), []);
  const email = sent && sent.email;

  const onCopy = async () => {
    setCopied((await copyText(requestId)) ? 'ok' : 'fail');
  };

  return (
    <div className="confirm">
      <div className="confirm__mark" aria-hidden="true"><Icon name="check" size={28} /></div>
      <h1 className="page-title" tabIndex={-1} ref={headingRef}>Request submitted</h1>
      {sent && (
        <p className="confirm__lead">
          {sent.orgName} asked for {suppliesLabel(sent.lineCount, sent.lotCount)}, {sent.totalUnits.toLocaleString('en-US')} {sent.totalUnits === 1 ? 'unit' : 'units'} in all.
        </p>
      )}
      <div className="confirm__id">
        <span className="confirm__id-label">Request ID</span>
        <span className="confirm__id-value num">{requestId}</span>
        <button type="button" className="btn btn--secondary btn--sm no-print" onClick={onCopy}>
          <Icon name={copied === 'ok' ? 'check' : 'copy'} size={18} /> {copied === 'ok' ? 'Copied' : 'Copy'}
        </button>
        <span className="visually-hidden" role="status">{copied === 'ok' ? 'Request ID copied' : ''}</span>
        {copied === 'fail' && <p className="field__error">Couldn’t copy automatically. Select the ID and copy it by hand.</p>}
      </div>

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
          <strong>Track it any time</strong> in My requests, using the same email address.
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
