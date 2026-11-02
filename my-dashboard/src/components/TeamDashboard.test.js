import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeamDashboard, { clinicSummary, filterGroups, withOrgs } from './TeamDashboard';

const row = (id, org, email, status, item, qty, ts) => ({
  'Request ID': id, 'Org Name': org, 'Org Email': email, Status: status, 'Item Name': item, 'Quantity Requested': String(qty), Timestamp: ts,
});
const ROWS = [
  row('REQ-1', 'Riverside Clinic', 'r@x.org', 'Under Review', 'Gauze pads', 4, '2026-10-20T10:00:00Z'),
  row('REQ-1', 'Riverside Clinic', 'r@x.org', 'Under Review', 'Exam gloves', 2, '2026-10-20T10:00:00Z'),
  row('REQ-2', 'Hillside Health', 'h@x.org', 'Approved', 'Syringes', 10, '2026-10-22T10:00:00Z'),
  row('REQ-3', 'Riverside Clinic', 'r@x.org', 'Shipped', 'Masks', 5, '2026-10-24T10:00:00Z'),
];

afterEach(() => {
  jest.restoreAllMocks();
  window.localStorage.clear();
});

test('requests are grouped with their clinic, items and units', () => {
  const groups = withOrgs(ROWS);
  expect(groups.map((g) => g.id)).toEqual(['REQ-3', 'REQ-2', 'REQ-1']);
  const r1 = groups.find((g) => g.id === 'REQ-1');
  expect(r1.org).toEqual({ name: 'Riverside Clinic', email: 'r@x.org' });
  expect(r1.units).toBe(6);
  expect(r1.lines).toEqual([{ name: 'Gauze pads', quantity: 4 }, { name: 'Exam gloves', quantity: 2 }]);
});

test('the per-clinic summary counts requests, units and the last request', () => {
  expect(clinicSummary(withOrgs(ROWS))).toEqual([
    { clinic: 'Riverside Clinic', email: 'r@x.org', requests: 2, units: 11, last: '2026-10-24T10:00:00Z' },
    { clinic: 'Hillside Health', email: 'h@x.org', requests: 1, units: 10, last: '2026-10-22T10:00:00Z' },
  ]);
});

test('filters by status and by clinic', () => {
  const groups = withOrgs(ROWS);
  expect(filterGroups(groups, { status: 'review' }).map((g) => g.id)).toEqual(['REQ-1']);
  expect(filterGroups(groups, { clinic: 'Riverside Clinic' }).map((g) => g.id)).toEqual(['REQ-3', 'REQ-1']);
  expect(filterGroups(groups, { status: 'shipped', clinic: 'Hillside Health' })).toEqual([]);
});

const ACCOUNTS = [
  { email: 'r@x.org', org_name: 'Riverside Clinic', role: 'clinic', created_at: '2026-10-20T10:00:00Z', last_login_at: '', locked: false },
  { email: 'h@x.org', org_name: 'Hillside Health', role: 'clinic', created_at: '2026-10-21T10:00:00Z', last_login_at: '2026-10-22T10:00:00Z', locked: true },
];

// A fake server: requests, accounts and reset links. The session is a cookie, so no headers.
function fakeServer() {
  const calls = [];
  jest.spyOn(global, 'fetch').mockImplementation((url, opts = {}) => {
    calls.push([url, opts.method || 'GET', opts.headers, opts.credentials]);
    const json = (data) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
    if (url.endsWith('/api/team/accounts')) return json(ACCOUNTS);
    if (url.endsWith('/api/team/accounts/reset-link')) return json({ token: 'T'.repeat(43), hours: 24 });
    return json(opts.method === 'PATCH' ? { ok: true } : ROWS);
  });
  return calls;
}

const MEMBER = { email: 'rchokha@umich.edu', org: 'Blueprints for Pangaea', role: 'hq' };

test('the dashboard lists requests and changes a status through the server', async () => {
  const calls = fakeServer();
  render(<TeamDashboard member={MEMBER} onSignOut={jest.fn()} />);
  await waitFor(() => expect(screen.getAllByRole('table')).toHaveLength(3));
  const table = screen.getAllByRole('table')[1];
  expect(within(table).getByText('Hillside Health')).toBeInTheDocument();
  expect(calls[0][3]).toBe('include'); // the session cookie goes with every call

  userEvent.selectOptions(screen.getByLabelText('Clinic'), 'Riverside Clinic');
  expect(within(table).queryByText('Hillside Health')).not.toBeInTheDocument();
  userEvent.click(screen.getByRole('button', { name: /^Under review/ }));
  userEvent.click(within(table).getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(calls.some(([url, method]) => method === 'PATCH' && url.endsWith('/requests/REQ-1/status'))).toBe(true));
});

test('accounts: find one, make a 24-hour reset link and copy it', async () => {
  const calls = fakeServer();
  const writeText = jest.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  render(<TeamDashboard member={MEMBER} onSignOut={jest.fn()} />);
  const accounts = await screen.findByRole('region', { name: 'Accounts' });
  await within(accounts).findByText('Hillside Health');
  expect(within(accounts).getByText(/locked for now/)).toBeInTheDocument();
  userEvent.type(within(accounts).getByLabelText('Find an account'), 'river');
  expect(within(accounts).queryByText('Hillside Health')).not.toBeInTheDocument();
  userEvent.click(within(accounts).getByRole('button', { name: 'Reset password' }));
  const link = await within(accounts).findByLabelText('Reset link for r@x.org');
  expect(link.value).toMatch(/#\/reset\/T{43}$/);
  const sent = calls.find(([url]) => url.endsWith('/reset-link'));
  expect(sent[1]).toBe('POST');
  userEvent.click(within(accounts).getByRole('button', { name: 'Copy' }));
  expect(writeText).toHaveBeenCalledWith(link.value);
});
