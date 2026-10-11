import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { API_BASE } from '../api';
import HQReview, { HQ_TOKEN_KEY } from './HQReview';

// All rows are synthetic.
const line = (id, status, over) => ({
  'Request ID': id, 'Org Name': 'Riverside Clinic', 'Org Email': 'staff@riverside.example',
  'Item Name': 'Gauze pads', Category: 'Wound Care', 'Quantity Requested': '4', Status: status,
  Timestamp: '2026-10-10T15:00:00+00:00', 'Review Flag': 'FALSE', ...over,
});

const R1 = 'REQ-1760000001-aaa111';
const R2 = 'REQ-1760000002-bbb222';
const R3 = 'REQ-1760000003-ccc333';

let rows;
let calls;

function respond(status, body) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  window.localStorage.clear();
  rows = [
    line(R1, 'Under Review'),
    line(R1, 'Under Review', { 'Item Name': 'Saline bag', 'Quantity Requested': '2' }),
    line(R2, 'Approved', { 'Org Name': 'Hilltop Health', 'Org Email': 'hq@hilltop.example' }),
    line(R3, 'Shipped'),
  ];
  calls = [];
  global.fetch = jest.fn((url, init = {}) => {
    calls.push({ url, init });
    const token = init.headers && init.headers['X-HQ-Token'];
    if (token !== 'good-token') return respond(401, { detail: 'Invalid HQ token.' });
    if (init.method === 'PATCH') {
      const id = decodeURIComponent(url.split('/requests/')[1].split('/')[0]);
      const { status } = JSON.parse(init.body);
      rows = rows.map((r) => (r['Request ID'] === id ? { ...r, Status: status } : r));
      return respond(200, { request_id: id, status });
    }
    return respond(200, rows);
  });
  window.confirm = jest.fn(() => true);
});

afterEach(() => {
  delete global.fetch;
});

async function signIn(token = 'good-token') {
  await userEvent.type(screen.getByLabelText('HQ access token'), token);
  await userEvent.click(screen.getByRole('button', { name: 'Open review' }));
}

const card = (id) => screen.getByRole('heading', { name: id }).closest('li');

test('asks for the token, then lists requests that need review with who sent them', async () => {
  render(<HQReview />);
  expect(fetch).not.toHaveBeenCalled();
  await signIn();

  await screen.findByRole('heading', { name: R1 });
  expect(calls[0].url).toBe(`${API_BASE}/requests`);
  expect(calls[0].init.headers['X-HQ-Token']).toBe('good-token');
  expect(within(card(R1)).getByText('Riverside Clinic')).toBeInTheDocument();
  expect(within(card(R1)).getByRole('link', { name: 'staff@riverside.example' })).toHaveAttribute('href', 'mailto:staff@riverside.example');
  // default filter is "Needs review": only R1
  expect(screen.queryByRole('heading', { name: R2 })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Needs review 1/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /All 3/ })).toBeInTheDocument();
  expect(JSON.parse(window.localStorage.getItem(HQ_TOKEN_KEY))).toBe('good-token');
});

test('offers only the moves the server allows for each status', async () => {
  render(<HQReview />);
  await signIn();
  await screen.findByRole('heading', { name: R1 });
  await userEvent.click(screen.getByRole('button', { name: /All 3/ }));

  const names = (id) => within(card(id)).queryAllByRole('button').map((b) => b.textContent);
  expect(names(R1)).toEqual(['Approve', 'Deny']);
  expect(names(R2)).toEqual(['Mark shipped', 'Cancel']);
  expect(names(R3)).toEqual(['Mark delivered']);
});

test('approving sends the status with the token, refreshes, and tells the catalog', async () => {
  const onStatusChanged = jest.fn();
  render(<HQReview onStatusChanged={onStatusChanged} />);
  await signIn();
  await screen.findByRole('heading', { name: R1 });

  await userEvent.click(within(card(R1)).getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: R1 })).not.toBeInTheDocument());

  const patch = calls.find((c) => c.init.method === 'PATCH');
  expect(patch.url).toBe(`${API_BASE}/requests/${R1}/status`);
  expect(JSON.parse(patch.init.body)).toEqual({ status: 'Approved' });
  expect(patch.init.headers['X-HQ-Token']).toBe('good-token');
  expect(onStatusChanged).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: /Approved 2/ })).toBeInTheDocument();
});

test('deny asks first and does nothing if HQ backs out', async () => {
  window.confirm = jest.fn(() => false);
  render(<HQReview />);
  await signIn();
  await screen.findByRole('heading', { name: R1 });

  await userEvent.click(within(card(R1)).getByRole('button', { name: 'Deny' }));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Riverside Clinic'));
  expect(calls.some((c) => c.init.method === 'PATCH')).toBe(false);
});

test('a wrong token is forgotten with a clear message', async () => {
  render(<HQReview />);
  await signIn('bad-token');
  expect(await screen.findByText(/That token was not accepted/)).toBeInTheDocument();
  expect(screen.getByLabelText('HQ access token')).toBeInTheDocument();
  expect(JSON.parse(window.localStorage.getItem(HQ_TOKEN_KEY))).toBe('');
});

test('a token saved earlier is reused, and Sign out forgets it', async () => {
  window.localStorage.setItem(HQ_TOKEN_KEY, JSON.stringify('good-token'));
  render(<HQReview />);
  await screen.findByRole('heading', { name: R1 });
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(screen.getByLabelText('HQ access token')).toBeInTheDocument();
  expect(JSON.parse(window.localStorage.getItem(HQ_TOKEN_KEY))).toBe('');
});
