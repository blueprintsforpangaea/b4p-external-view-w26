import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAllRequests, setRequestStatus } from '../api';
import { formatDateTime, groupRequests, statusInfo, suppliesLabel } from '../inventory';
import { readJSON, writeJSON } from '../storage';
import Icon from './Icons';
import { EmptyState, ErrorState, WakingNotice } from './States';

// HQ review page (#/hq). Not linked from the clinic UI: HQ bookmarks it and enters the
// shared HQ_API_TOKEN once. The token stays in this browser only, and every action is
// still checked by the server (require_hq + the status rules in set_request_status).

export const HQ_TOKEN_KEY = 'b4p_hq_token';

// Mirrors _check_transition in main.py: forward only; Deny/Cancel only before shipping.
const ACTIONS = {
  'Under Review': [
    { status: 'Approved', label: 'Approve', kind: 'primary' },
    { status: 'Denied', label: 'Deny', kind: 'secondary', confirm: true },
  ],
  Approved: [
    { status: 'Shipped', label: 'Mark shipped', kind: 'primary' },
    { status: 'Cancelled', label: 'Cancel', kind: 'secondary', confirm: true },
  ],
  Shipped: [{ status: 'Delivered', label: 'Mark delivered', kind: 'secondary' }],
};

const FILTERS = [
  { id: 'review', label: 'Needs review', match: (s) => s === 'Under Review' },
  { id: 'approved', label: 'Approved', match: (s) => s === 'Approved' },
  { id: 'shipped', label: 'Shipped', match: (s) => s === 'Shipped' },
  { id: 'closed', label: 'Closed', match: (s) => ['Delivered', 'Denied', 'Cancelled'].includes(s) },
  { id: 'all', label: 'All', match: () => true },
];

// groupRequests() is built for one clinic, so it drops who sent each request; add it back.
function withOrgs(rows) {
  const orgs = new Map();
  for (const r of rows || []) {
    const id = String(r['Request ID'] || '').trim();
    if (id && !orgs.has(id)) orgs.set(id, { name: r['Org Name'] || '', email: r['Org Email'] || '' });
  }
  return groupRequests(rows)
    .map((g) => ({ ...g, org: orgs.get(g.id) || { name: '', email: '' } }))
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

function TokenForm({ onSave, error }) {
  const [value, setValue] = useState('');
  const submit = (e) => {
    e.preventDefault();
    if (value.trim()) onSave(value.trim());
  };
  return (
    <form className="lookup" onSubmit={submit} noValidate>
      <div className={`field${error ? ' field--error' : ''}`}>
        <label htmlFor="hq-token">HQ access token</label>
        <div className="lookup__row">
          <input
            id="hq-token"
            type="password"
            autoComplete="current-password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? 'hq-token-error' : 'hq-token-hint'}
          />
          <button type="submit" className="btn btn--primary">Open review</button>
        </div>
        {error
          ? <p className="field__error" id="hq-token-error">{error}</p>
          : <p className="field__hint" id="hq-token-hint">The HQ_API_TOKEN set on the server. It is saved in this browser only.</p>}
      </div>
    </form>
  );
}

export default function HQReview({ onStatusChanged }) {
  const [token, setToken] = useState(() => readJSON(HQ_TOKEN_KEY, ''));
  const [tokenError, setTokenError] = useState(null);
  const [state, setState] = useState({ status: 'idle', groups: [], error: null });
  const [slow, setSlow] = useState(false);
  const [filter, setFilter] = useState('review');
  const [busy, setBusy] = useState(null); // request id being updated
  const [actionError, setActionError] = useState(null);

  const forgetToken = useCallback((message) => {
    writeJSON(HQ_TOKEN_KEY, '');
    setToken('');
    setTokenError(message || null);
    setState({ status: 'idle', groups: [], error: null });
  }, []);

  // 401: wrong token. 403: the server has HQ access switched off (HQ_API_TOKEN unset).
  const authProblem = useCallback((err) => {
    if (err.status === 401) { forgetToken('That token was not accepted. Check it and try again.'); return true; }
    if (err.status === 403) { forgetToken('HQ access is turned off on the server (HQ_API_TOKEN is not set).'); return true; }
    return false;
  }, [forgetToken]);

  const load = useCallback(async () => {
    if (!token) return;
    setSlow(false);
    setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      const rows = await getAllRequests(token, { onSlow: () => setSlow(true) });
      setState({ status: 'done', groups: withOrgs(rows), error: null });
    } catch (err) {
      if (!authProblem(err)) setState((s) => ({ ...s, status: 'error', error: err.message }));
    }
  }, [token, authProblem]);

  useEffect(() => { load(); }, [load]);

  const saveToken = (value) => {
    writeJSON(HQ_TOKEN_KEY, value);
    setTokenError(null);
    setToken(value);
  };

  const act = async (group, action) => {
    if (action.confirm && !window.confirm(`${action.label} ${group.id} from ${group.org.name || 'this clinic'}? The clinic will be emailed.`)) return;
    setBusy(group.id);
    setActionError(null);
    try {
      await setRequestStatus(group.id, action.status, token);
      onStatusChanged && onStatusChanged();
      await load();
    } catch (err) {
      if (!authProblem(err)) setActionError(`${group.id}: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const counts = useMemo(() => {
    const c = {};
    for (const f of FILTERS) c[f.id] = state.groups.filter((g) => f.match(g.status)).length;
    return c;
  }, [state.groups]);
  const active = FILTERS.find((f) => f.id === filter);
  const shown = state.groups.filter((g) => active.match(g.status));
  const loading = state.status === 'loading';

  return (
    <div className="requests hq">
      <div className="hq__title-row">
        <h1 className="page-title">HQ review</h1>
        {token && (
          <div className="hq__tools">
            <button type="button" className="btn btn--secondary btn--sm" onClick={load} disabled={loading}>
              <Icon name="refresh" size={16} /> Refresh
            </button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => forgetToken()}>Sign out</button>
          </div>
        )}
      </div>

      {!token ? (
        <TokenForm onSave={saveToken} error={tokenError} />
      ) : (
        <>
          <div className="hq__filters" role="group" aria-label="Filter requests by status">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`chip${filter === f.id ? ' chip--on' : ''}`}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label} <span className="num">{counts[f.id]}</span>
              </button>
            ))}
          </div>

          {actionError && <p className="field__error" role="alert">{actionError}</p>}
          {loading && slow && <WakingNotice />}
          {loading && <span className="visually-hidden" role="status">Loading requests</span>}
          {state.status === 'error' && <ErrorState title="Couldn’t load requests" message={state.error} onRetry={load} />}

          {state.status === 'done' && shown.length === 0 && (
            <EmptyState title="Nothing here">No requests with this status.</EmptyState>
          )}

          {shown.length > 0 && state.status !== 'error' && (
            <ul className="req-list" aria-busy={loading}>
              {shown.map((g) => {
                const info = statusInfo(g.status);
                const units = g.lines.reduce((s, l) => s + (l.quantity || 0), 0);
                const actions = ACTIONS[g.status] || [];
                return (
                  <li key={g.id} className="req">
                    <div className="req__head">
                      <h2 className="req__id num">{g.id}</h2>
                      <p className="req__date">Sent {formatDateTime(g.timestamp)}</p>
                    </div>
                    <p className="hq__org">
                      <strong>{g.org.name || 'Unnamed clinic'}</strong>
                      {g.org.email && <> · <a href={`mailto:${g.org.email}`}>{g.org.email}</a></>}
                    </p>
                    <p className={`hq__status${info.stopped ? ' hq__status--stopped' : ''}`}>{g.status || 'Unknown status'}</p>
                    <details className="req__items" open={g.status === 'Under Review'}>
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
                    {actions.length > 0 && (
                      <div className="hq__actions">
                        {actions.map((a) => (
                          <button
                            key={a.status}
                            type="button"
                            className={`btn btn--${a.kind} btn--sm`}
                            disabled={busy === g.id}
                            onClick={() => act(g, a)}
                          >
                            {a.label}
                          </button>
                        ))}
                        {busy === g.id && <span className="hint" role="status">Updating…</span>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
