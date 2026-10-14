import { useCallback, useEffect, useRef, useState } from 'react';
import { getMyRequests } from '../api';
import { formatDateTime, groupRequests, STATUS_STEPS, statusInfo, suppliesLabel } from '../inventory';
import { EMAIL_RE } from './CheckoutForm';
import Icon from './Icons';
import { EmptyState, ErrorState, WakingNotice } from './States';

function StatusTrack({ status }) {
  const info = statusInfo(status);
  if (info.stopped) {
    return (
      <p className="req__stopped">
        <Icon name="alert" size={20} /> <strong>{info.label}.</strong> Email the Blueprints team if you have questions about this request.
      </p>
    );
  }
  return (
    <>
      <p className="req__status">
        <Icon name={info.step >= 3 ? 'check' : 'clock'} size={18} /> {info.label}
      </p>
      <ol className="track" aria-label={`Status: ${info.label}`}>
        {STATUS_STEPS.map((label, i) => {
          const state = i < info.step ? 'done' : i === info.step ? 'current' : 'todo';
          return (
            <li key={label} className={`track__step track__step--${state}`} aria-current={i === info.step ? 'step' : undefined}>
              <span className="track__dot" aria-hidden="true">{state === 'done' && <Icon name="check" size={12} />}</span>
              <span className="track__label">
                {label}
                <span className="visually-hidden">{state === 'done' ? ', done' : state === 'current' ? ', current step' : ', not yet'}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

export default function MyRequests({ org, account, onEmailChange, highlightId, onBrowse }) {
  const [email, setEmail] = useState(org.email);
  const [lookedUp, setLookedUp] = useState(org.email && EMAIL_RE.test(org.email) ? org.email : '');
  const [state, setState] = useState({ status: 'idle', groups: [], error: null });
  const [slow, setSlow] = useState(false);
  const [emailError, setEmailError] = useState(null);
  const seq = useRef(0);

  const load = useCallback(async (address) => {
    const mine = ++seq.current;
    setSlow(false);
    setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      const rows = await getMyRequests(address, { cache: 'no-cache', onSlow: () => mine === seq.current && setSlow(true) });
      if (mine !== seq.current) return;
      setState({ status: 'done', groups: groupRequests(rows), error: null });
    } catch (err) {
      if (mine !== seq.current) return;
      setState((s) => ({ ...s, status: 'error', error: err.message }));
    }
  }, []);

  useEffect(() => {
    if (lookedUp) load(lookedUp);
    return () => {
      seq.current += 1;
    };
  }, [lookedUp, load]);

  const onLookup = (e) => {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setEmailError('Enter the email address you used when sending your request.');
      return;
    }
    setEmailError(null);
    onEmailChange(value);
    if (value.toLowerCase() === lookedUp.toLowerCase()) load(value);
    else setLookedUp(value);
  };

  const loading = state.status === 'loading';

  return (
    <div className="requests">
      <h1 className="page-title">My requests</h1>
      {account ? (
        <div className="requests__who">
          <p>Requests sent by <strong>{account.org}</strong> from {account.email}.</p>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => load(account.email)} disabled={loading}>
            <Icon name="refresh" size={18} /> Refresh
          </button>
        </div>
      ) : (
      <form className="lookup" onSubmit={onLookup} noValidate>
        <div className={`field${emailError ? ' field--error' : ''}`}>
          <label htmlFor="lookup-email">Email used for your requests</label>
          <div className="lookup__row">
            <input
              id="lookup-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!emailError}
              aria-describedby={emailError ? 'lookup-error' : undefined}
            />
            <button type="submit" className="btn btn--secondary" disabled={loading}>
              {lookedUp && email.trim().toLowerCase() === lookedUp.toLowerCase() ? <><Icon name="refresh" size={18} /> Refresh</> : 'Show requests'}
            </button>
          </div>
          {emailError && <p className="field__error" id="lookup-error">{emailError}</p>}
        </div>
      </form>
      )}

      {loading && slow && <WakingNotice />}
      {loading && state.groups.length === 0 && (
        <div className="req-skeleton" aria-hidden="true">
          <div className="skeleton skeleton--block" />
          <div className="skeleton skeleton--block" />
        </div>
      )}
      {loading && <span className="visually-hidden" role="status">Loading your requests</span>}

      {state.status === 'error' && (
        <ErrorState title="Couldn’t load your requests" message={state.error} onRetry={() => load(lookedUp)} />
      )}

      {state.status === 'done' && state.groups.length === 0 && (
        <EmptyState
          title="No requests for this email yet"
          action={<button type="button" className="btn btn--primary" onClick={onBrowse}>Browse supplies</button>}
        >
          {account
            ? 'When your clinic sends a request, it shows up here with its status.'
            : `Requests sent with ${lookedUp} will show up here. If you used a different address, enter it above.`}
        </EmptyState>
      )}

      {!lookedUp && state.status === 'idle' && (
        <p className="hint">Enter the email you used when sending a request to see its status.</p>
      )}

      {state.groups.length > 0 && state.status !== 'error' && (
        <ul className="req-list" aria-busy={loading}>
          {state.groups.map((g) => {
            const units = g.lines.reduce((s, l) => s + (l.quantity || 0), 0);
            return (
              <li key={g.id} className={`req${g.id === highlightId ? ' req--new' : ''}`}>
                <div className="req__head">
                  <h2 className="req__id num">{g.id}</h2>
                  <p className="req__date">Sent {formatDateTime(g.timestamp)}</p>
                </div>
                <StatusTrack status={g.status} />
                <details className="req__items">
                  <summary>
                    {suppliesLabel(g.lines.length, g.lotCount)}, {units.toLocaleString('en-US')} {units === 1 ? 'unit' : 'units'}
                  </summary>
                  <ul>
                    {g.lines.map((l, i) => (
                      <li key={i}>
                        <span>{l.name}</span>
                        <span className="num">{l.quantity ?? ''}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
