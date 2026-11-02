import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, getAccounts, getAllRequests, makeResetLink, setRequestStatus } from '../api';
import { formatDateTime, groupRequests } from '../inventory';
import Icon from './Icons';
import { EmptyState, ErrorState } from './States';

// The Blueprints team dashboard (#/team): which clinics asked for what, with status changes, and
// clinic accounts with a password reset link for anyone locked out. Status rules and the per-clinic
// grouping come from the HQ review page in team PR #9; every change is still checked by the server.

// Mirrors _check_transition in main.py: forward only; Deny/Cancel only before shipping.
export const ACTIONS = {
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

export const STATUSES = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'review', label: 'Under review', match: (s) => s === 'Under Review' },
  { id: 'approved', label: 'Approved', match: (s) => s === 'Approved' },
  { id: 'shipped', label: 'Shipped', match: (s) => s === 'Shipped' || s === 'Delivered' },
  { id: 'denied', label: 'Denied or cancelled', match: (s) => s === 'Denied' || s === 'Cancelled' },
];

const STATUS_LABEL = { 'Under Review': 'Under review' };

// groupRequests() is built for one clinic, so it drops who sent each request; add it back.
export function withOrgs(rows) {
  const orgs = new Map();
  for (const r of rows || []) {
    const id = String(r['Request ID'] || '').trim();
    if (id && !orgs.has(id)) orgs.set(id, { name: String(r['Org Name'] || '').trim(), email: String(r['Org Email'] || '').trim() });
  }
  return groupRequests(rows)
    .map((g) => ({ ...g, org: orgs.get(g.id) || { name: '', email: '' }, units: g.lines.reduce((n, l) => n + (l.quantity || 0), 0) }))
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

// One row per clinic: how many requests, how many units in all, and when it last asked.
export function clinicSummary(groups) {
  const by = new Map();
  for (const g of groups) {
    const key = g.org.name || g.org.email || 'Unnamed clinic';
    const row = by.get(key) || { clinic: key, email: g.org.email, requests: 0, units: 0, last: '' };
    row.requests += 1;
    row.units += g.units;
    if (String(g.timestamp) > row.last) row.last = String(g.timestamp);
    by.set(key, row);
  }
  return [...by.values()].sort((a, b) => b.last.localeCompare(a.last));
}

export function filterGroups(groups, { status = 'all', clinic = '' } = {}) {
  const s = STATUSES.find((x) => x.id === status) || STATUSES[0];
  return groups.filter((g) => s.match(g.status) && (!clinic || (g.org.name || g.org.email || 'Unnamed clinic') === clinic));
}

function Requests({ onSignedOut }) {
  const [state, setState] = useState({ status: 'loading', groups: [], error: null });
  const [status, setStatus] = useState('all');
  const [clinic, setClinic] = useState('');
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      setState({ status: 'done', groups: withOrgs(await getAllRequests()), error: null });
    } catch (err) {
      if (err.status === 401 || err.status === 403) return onSignedOut();
      setState((s) => ({ ...s, status: 'error', error: err.message }));
    }
  }, [onSignedOut]);
  useEffect(() => { load(); }, [load]);

  const act = async (g, a) => {
    if (a.confirm && !window.confirm(`${a.label} ${g.id} from ${g.org.name || 'this clinic'}? The clinic will be emailed.`)) return;
    setBusy(g.id);
    setActionError(null);
    try {
      await setRequestStatus(g.id, a.status);
      await load();
    } catch (err) {
      if (err.status === 401) return onSignedOut();
      setActionError(`${g.id}: ${err instanceof ApiError ? err.message : 'That didn’t work. Try again.'}`);
    } finally {
      setBusy(null);
    }
  };

  const summary = useMemo(() => clinicSummary(state.groups), [state.groups]);
  const shown = useMemo(() => filterGroups(state.groups, { status, clinic }), [state.groups, status, clinic]);

  if (state.status === 'error') return <ErrorState title="Couldn’t load requests" message={state.error} onRetry={load} />;

  return (
    <>
      <section aria-labelledby="clinics-title" className="team__section">
        <h2 id="clinics-title" className="section-title">Clinics</h2>
        {summary.length === 0 ? (
          <p className="hint">{state.status === 'loading' ? 'Loading…' : 'No requests yet.'}</p>
        ) : (
          <div className="team__scroll">
            <table className="team-table">
              <thead><tr><th scope="col">Clinic</th><th scope="col" className="n">Requests</th><th scope="col" className="n">Units</th><th scope="col">Last request</th></tr></thead>
              <tbody>
                {summary.map((c) => (
                  <tr key={c.clinic}>
                    <th scope="row"><button type="button" className="linklike" onClick={() => setClinic(c.clinic)}>{c.clinic}</button></th>
                    <td className="n num">{c.requests}</td>
                    <td className="n num">{c.units.toLocaleString('en-US')}</td>
                    <td>{formatDateTime(c.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="requests-title" className="team__section">
        <div className="team__head">
          <h2 id="requests-title" className="section-title">Requests</h2>
          <button type="button" className="btn btn--secondary btn--sm" onClick={load} disabled={state.status === 'loading'}>
            <Icon name="refresh" size={16} /> Refresh
          </button>
        </div>
        <div className="team__filters">
          <div className="team__chips" role="group" aria-label="Filter by status">
            {STATUSES.map((s) => (
              <button key={s.id} type="button" className={`chip${status === s.id ? ' chip--on' : ''}`} aria-pressed={status === s.id} onClick={() => setStatus(s.id)}>
                {s.label} <span className="num">{filterGroups(state.groups, { status: s.id, clinic }).length}</span>
              </button>
            ))}
          </div>
          <label className="team__select">
            <span>Clinic</span>
            <select value={clinic} onChange={(e) => setClinic(e.target.value)}>
              <option value="">All clinics</option>
              {summary.map((c) => <option key={c.clinic} value={c.clinic}>{c.clinic}</option>)}
            </select>
          </label>
        </div>
        {actionError && <p className="field__error" role="alert">{actionError}</p>}
        {state.status === 'done' && shown.length === 0 ? (
          <EmptyState title="Nothing here">No requests match these filters.</EmptyState>
        ) : (
          <div className="team__scroll">
            <table className="team-table team-table--requests" aria-busy={state.status === 'loading'}>
              <thead>
                <tr><th scope="col">Clinic</th><th scope="col">Date</th><th scope="col">Supplies</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Change status</span></th></tr>
              </thead>
              <tbody>
                {shown.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <strong>{g.org.name || 'Unnamed clinic'}</strong>
                      {g.org.email && <><br /><a href={`mailto:${g.org.email}`}>{g.org.email}</a></>}
                      <br /><span className="team__id num">{g.id}</span>
                    </td>
                    <td>{formatDateTime(g.timestamp)}</td>
                    <td>
                      <ul className="team__items">
                        {g.lines.map((l, i) => <li key={i}><span>{l.name}</span> <span className="num">× {l.quantity ?? '–'}</span></li>)}
                      </ul>
                    </td>
                    <td><span className={`team__status team__status--${String(g.status).toLowerCase().replace(/\s+/g, '-')}`}>{STATUS_LABEL[g.status] || g.status}</span></td>
                    <td className="team__actions">
                      {(ACTIONS[g.status] || []).map((a) => (
                        <button key={a.status} type="button" className={`btn btn--sm btn--${a.kind}`} disabled={busy === g.id} onClick={() => act(g, a)}>
                          {a.label}
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// Accounts, with a one-time reset link (24 hours) for anyone who forgot their password. Nothing is
// emailed: the team member copies the link and sends it however suits the clinic. Making a new
// link cancels the previous one; the old password keeps working until the link is used.
function Accounts({ onSignedOut }) {
  const [state, setState] = useState({ status: 'loading', rows: [], error: null });
  const [find, setFind] = useState('');
  const [links, setLinks] = useState({}); // email -> {link, hours} | {error}
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      setState({ status: 'done', rows: await getAccounts(), error: null });
    } catch (err) {
      if (err.status === 401 || err.status === 403) return onSignedOut();
      setState((s) => ({ ...s, status: 'error', error: err.message }));
    }
  }, [onSignedOut]);
  useEffect(() => { load(); }, [load]);

  const reset = async (email) => {
    setBusy(email);
    try {
      const { token, hours } = await makeResetLink(email);
      const link = `${window.location.origin}${window.location.pathname}#/reset/${token}`;
      setLinks((l) => ({ ...l, [email]: { link, hours } }));
    } catch (err) {
      if (err.status === 401 || err.status === 403) return onSignedOut();
      setLinks((l) => ({ ...l, [email]: { error: err instanceof ApiError ? err.message : 'That didn’t work. Try again.' } }));
    } finally {
      setBusy(null);
    }
  };
  const copy = (text) => navigator.clipboard && navigator.clipboard.writeText(text).catch(() => {});

  const q = find.trim().toLowerCase();
  const rows = q ? state.rows.filter((a) => `${a.org_name} ${a.email}`.toLowerCase().includes(q)) : state.rows;
  if (state.status === 'error') return <ErrorState title="Couldn’t load accounts" message={state.error} onRetry={load} />;

  return (
    <section aria-labelledby="accounts-title" className="team__section">
      <h2 id="accounts-title" className="section-title">Accounts</h2>
      <p className="hint">Someone forgot their password? Make a reset link and send it to them by email or text. It works once, for 24 hours.</p>
      <div className="field team__find">
        <label htmlFor="account-find">Find an account</label>
        <input id="account-find" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Clinic or email" />
      </div>
      {rows.length === 0 ? (
        <p className="hint">{state.status === 'loading' ? 'Loading…' : q ? 'No account matches.' : 'No accounts yet.'}</p>
      ) : (
        <div className="team__scroll">
          <table className="team-table">
            <thead><tr><th scope="col">Clinic</th><th scope="col">Email</th><th scope="col">Last sign-in</th><th scope="col">Password</th></tr></thead>
            <tbody>
              {rows.map((a) => {
                const made = links[a.email];
                return (
                  <tr key={a.email}>
                    <th scope="row">{a.org_name}{a.role === 'hq' && <span className="hint"> (team)</span>}</th>
                    <td>{a.email}</td>
                    <td>{a.last_login_at ? formatDateTime(a.last_login_at) : 'Never'}{a.locked && <span className="hint"> · locked for now</span>}</td>
                    <td>
                      {made && made.link ? (
                        <div className="team__link">
                          <label className="visually-hidden" htmlFor={`link-${a.email}`}>Reset link for {a.email}</label>
                          <input id={`link-${a.email}`} readOnly value={made.link} onFocus={(e) => e.target.select()} />
                          <button type="button" className="btn btn--secondary btn--sm" onClick={() => copy(made.link)}>Copy</button>
                        </div>
                      ) : (
                        <button type="button" className="btn btn--secondary btn--sm" disabled={busy === a.email} onClick={() => reset(a.email)}>
                          {busy === a.email ? 'Making link…' : 'Reset password'}
                        </button>
                      )}
                      {made && made.error && <p className="form-error" role="alert">{made.error}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function TeamDashboard({ member, onSignOut }) {
  const titleRef = useRef(null);
  useEffect(() => titleRef.current && titleRef.current.focus(), []);

  return (
    <div className="team">
      <div className="team__top">
        <div>
          <h1 className="page-title" tabIndex={-1} ref={titleRef}>Blueprints team</h1>
          <p className="hint">Signed in as <strong>{member.email}</strong></p>
        </div>
        <button type="button" className="btn btn--secondary" onClick={onSignOut}>Sign out</button>
      </div>
      <Requests onSignedOut={onSignOut} />
      <Accounts onSignedOut={onSignOut} />
    </div>
  );
}
