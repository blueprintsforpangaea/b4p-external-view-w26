import { useRef, useState } from 'react';
import Icon from './Icons';
import Progress from './Progress';
import { WakingNotice } from './States';

export const EMAIL_RE = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;

export function validateOrg({ name, email }) {
  const errors = {};
  if (!name.trim()) errors.name = 'Enter your clinic or organization name.';
  else if (name.trim().length > 200) errors.name = 'Keep the name under 200 characters.';
  if (!email.trim()) errors.email = 'Enter an email address so our team can reach you.';
  else if (!EMAIL_RE.test(email.trim()) || email.trim().length > 254) errors.email = 'Enter a valid email address, like name@clinic.org.';
  return errors;
}

export default function CheckoutForm({ lines, totalUnits, org, account, onSignOut, onSubmit, onBack }) {
  const [values, setValues] = useState({ name: org.name, email: org.email });
  const [touched, setTouched] = useState({});
  const [serverFields, setServerFields] = useState({});
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [slow, setSlow] = useState(false);
  const inFlight = useRef(false);
  const nameRef = useRef(null);
  const emailRef = useRef(null);

  const errors = validateOrg(values);
  const shown = {
    name: (touched.name && errors.name) || serverFields.name,
    email: (touched.email && errors.email) || serverFields.email,
  };
  const reviewCount = lines.filter((l) => l.needsReview).length;

  const update = (field) => (e) => {
    setValues((v) => ({ ...v, [field]: e.target.value }));
    setServerFields((s) => ({ ...s, [field]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (inFlight.current) return;
    setTouched({ name: true, email: true });
    if (errors.name) return nameRef.current.focus();
    if (errors.email) return emailRef.current.focus();
    inFlight.current = true;
    setSending(true);
    setSlow(false);
    setError(null);
    try {
      await onSubmit({ name: values.name.trim(), email: values.email.trim() }, () => setSlow(true));
    } catch (err) {
      const fields = err.fields || {};
      setServerFields({ name: fields.org_name, email: fields.org_email });
      setError(err.message || 'The request could not be submitted. Try again.');
      inFlight.current = false;
      setSending(false);
    }
  };

  return (
    <div className="checkout">
      <button type="button" className="back" onClick={onBack}>
        <Icon name="back" size={18} /> Back to supplies
      </button>
      <Progress step={3} />
      <h1 className="page-title">Review your request</h1>
      <div className="checkout__stack">
        <section className="checkout__summary" aria-labelledby="summary-title">
          <div className="checkout__summary-head">
            <h2 id="summary-title" className="section-title">Supplies requested</h2>
            <button type="button" className="linklike" onClick={onBack}>Change</button>
          </div>
          <ol className="summary">
            {lines.map((l) => (
              <li key={l.id}>
                <span className="summary__name">
                  {l.name}
                  {l.lotCount > 1 && <span className="summary__lots">From {l.lotCount} batches, soonest use-by date first</span>}
                </span>
                <span className="summary__qty num">{l.quantity.toLocaleString('en-US')}</span>
              </li>
            ))}
          </ol>
          <p className="summary__total">
            Total <span className="num">{totalUnits.toLocaleString('en-US')}</span> {totalUnits === 1 ? 'unit' : 'units'}
          </p>
          {reviewCount > 0 && (
            <p className="hint">
              Our team checks {reviewCount === 1 ? 'one of these supplies' : `${reviewCount} of these supplies`} by hand before shipping, so approval may take a little longer.
            </p>
          )}
        </section>

        <form className="checkout__form" onSubmit={handleSubmit} noValidate>
          <h2 className="section-title">Sending as</h2>
          {account ? (
            <div className="sending-as">
              <dl>
                <div><dt>Clinic</dt><dd>{account.org}</dd></div>
                <div><dt>Updates go to</dt><dd>{account.email}</dd></div>
              </dl>
              <p className="hint">
                We email this address when your request is approved and when it ships.{' '}
                Not {account.org}? <button type="button" className="linklike sending-as__switch" onClick={onSignOut}>Sign out</button>
              </p>
            </div>
          ) : (<>
          <p className="hint">We remember these on this device so you don’t have to type them again.</p>
          <div className={`field${shown.name ? ' field--error' : ''}`}>
            <label htmlFor="org-name">Clinic or organization name</label>
            <input
              ref={nameRef}
              id="org-name"
              type="text"
              autoComplete="organization"
              maxLength={200}
              value={values.name}
              onChange={update('name')}
              onBlur={() => setTouched((t) => ({ ...t, name: true }))}
              aria-invalid={!!shown.name}
              aria-describedby={shown.name ? 'org-name-error' : undefined}
            />
            {shown.name && <p className="field__error" id="org-name-error">{shown.name}</p>}
          </div>
          <div className={`field${shown.email ? ' field--error' : ''}`}>
            <label htmlFor="org-email">Email</label>
            <input
              ref={emailRef}
              id="org-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={254}
              value={values.email}
              onChange={update('email')}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              aria-invalid={!!shown.email}
              aria-describedby={shown.email ? 'org-email-error org-email-hint' : 'org-email-hint'}
            />
            <p className="field__hint" id="org-email-hint">We’ll email a confirmation here. Use the same email to look up your requests later.</p>
            {shown.email && <p className="field__error" id="org-email-error">{shown.email}</p>}
          </div>
          </>)}

          {error && (
            <div className="form-error" role="alert">
              <Icon name="alert" size={20} />
              <p>{error}</p>
            </div>
          )}
          {sending && slow && <WakingNotice />}

          <button type="submit" className="btn btn--primary btn--block btn--send" disabled={sending} aria-disabled={sending} aria-describedby="send-note">
            {sending ? 'Sending request…' : 'Send request'}
          </button>
          <p className="checkout__note" id="send-note">Nothing ships until our team reviews it. We’ll email you.</p>
        </form>
      </div>
    </div>
  );
}
