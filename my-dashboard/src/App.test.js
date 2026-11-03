import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { INVENTORY_KEY, writeInventoryCache } from './inventoryCache';
import { CART_KEY } from './useCart';
import { ORG_KEY } from './useOrg';

// Integration tests for the McMaster-style catalog: the real App with fetch mocked.
// All rows are synthetic.

const supply = (row, over) => ({
  'Manufacturer Name': 'Example Maker', Category: 'ST/N', Subcategory: 'Wound Care & Bandages',
  General: 'gauze pad', Name: `Item ${row}`, 'Lot Number': `L${row}`, Notes: '', Quantity: '10',
  'Date of Expiration': '2030-01-01', 'Pallet Number': '1', 'Box Number': '2', Review: 'No',
  _sheet_row: row, ...over,
});

const SUPPLIES = [
  supply(2, { Name: 'Gauze pads 4x4', Quantity: '2' }),
  supply(3, { Name: 'Synthetic 10ml Syringe', General: '10ml syringe', Subcategory: 'Needles & Syringes', Quantity: '40' }),
  supply(4, { Name: 'Old saline bag', General: 'saline bag', Subcategory: 'IV Supplies', Quantity: '5', 'Date of Expiration': '2020-01-01' }),
  supply(5, { Name: 'Nitrile gloves', General: 'nitrile exam glove', Subcategory: 'Gloves', Quantity: '1,200', Review: 'Yes' }),
  supply(6, { Name: 'Unknown', General: 'gauze roll', Subcategory: '', Quantity: '7' }),
  supply(7, { Name: 'Empty syringe box', General: '3ml syringe', Subcategory: 'Needles & Syringes', Quantity: '0' }),
  supply(8, { Name: '', General: '', Notes: '', Subcategory: '', Quantity: '3' }), // unlabelled: hidden
];

const RID = 'REQ-1760000000-a1b2c3';

function response(status, body) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

let handlers;
let posts;
let calls;

function installFetch() {
  posts = [];
  calls = [];
  handlers = {
    supplies: () => response(200, SUPPLIES),
    availability: () => response(200, []),
    submit: () => response(200, { request_id: RID, status: 'Under Review' }),
    mine: () => response(200, []),
  };
  global.fetch = jest.fn((url, init = {}) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    calls.push({ path, init });
    if (path === '/api/supplies') return handlers.supplies();
    if (path === '/inventory/availability') return handlers.availability();
    if (path === '/requests' && init.method === 'POST') {
      posts.push(JSON.parse(init.body));
      return handlers.submit();
    }
    if (path.startsWith('/requests?email=')) return handlers.mine(decodeURIComponent(path.split('=')[1]));
    return Promise.reject(new Error(`unexpected fetch ${path}`));
  });
}

function setWide(wide) {
  window.matchMedia = jest.fn((query) => {
    const m = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: m ? wide && Number(m[1]) <= 1280 : false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
    };
  });
}

function go(hash) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

const at = (hash) => window.history.replaceState(null, '', `/${hash}`);
const rowFor = (name) => screen.getByRole('button', { name: new RegExp(`^${name}$`) }).closest('tr');
const addButton = (name) => screen.getByRole('button', { name: new RegExp(`^Add ${name} to request$`, 'i') });
const headerRequest = () => within(screen.getByRole('banner')).getByRole('button', { name: /your list/i });

// Waits for a row button by name, or (default) for the page's h1.
async function renderAt(hash, waitFor = 'h1') {
  at(hash);
  const utils = render(<App />);
  if (waitFor === 'h1') await screen.findByRole('heading', { level: 1 });
  else if (waitFor) await screen.findByRole('button', { name: waitFor });
  return utils;
}

let consoleError;
beforeEach(() => {
  window.localStorage.clear();
  at('');
  installFetch();
  setWide(true);
  window.scrollTo = jest.fn();
  Element.prototype.scrollIntoView = jest.fn();
  consoleError = jest.spyOn(console, 'error');
});

afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled(); // React warnings are bugs too
  consoleError.mockRestore();
  delete global.fetch;
});




describe('request drawer', () => {
  test('the header says the list is empty, then shows the count', async () => {
    await renderAt('#/c/gloves', /^Nitrile gloves$/);
    expect(headerRequest()).toHaveAccessibleName('Your list, empty');
    userEvent.click(addButton('Nitrile gloves'));
    expect(headerRequest()).toHaveAccessibleName('Your list, 1 supply');
  });

  test('Add to list shows "Added" over the stepper briefly', async () => {
    await renderAt('#/c/gloves', /^Nitrile gloves$/);
    jest.useFakeTimers();
    try {
      userEvent.click(addButton('Nitrile gloves'));
      const row = rowFor('Nitrile gloves');
      expect(within(row).getByText('Added')).toBeInTheDocument();
      act(() => { jest.advanceTimersByTime(3000); });
      expect(within(row).queryByText('Added')).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('Add becomes a stepper capped at stock; header shows the count', async () => {
    await renderAt('#/c/wound-care-and-bandages', /^Gauze pads 4x4$/);
    userEvent.click(addButton('Gauze pads 4x4'));
    const row = rowFor('Gauze pads 4x4');
    userEvent.click(within(row).getByRole('button', { name: 'One more Gauze pads 4x4' }));
    expect(within(row).getByLabelText('Quantity of Gauze pads 4x4')).toHaveValue('2');
    expect(within(row).getByRole('button', { name: 'All 2 Gauze pads 4x4 are in your request' })).toBeDisabled();
    expect(headerRequest()).toHaveAccessibleName('Your list, 1 supply');
  });

  test('drawer opens from the header, focuses Close, edits, and closes with Escape', async () => {
    await renderAt('#/c/needles-and-syringes', /^Synthetic 10ml Syringe$/);
    userEvent.click(addButton('Synthetic 10ml Syringe'));
    userEvent.click(headerRequest());
    const drawer = await screen.findByRole('dialog', { name: 'Your list' });
    expect(within(drawer).getByRole('button', { name: 'Close your list' })).toHaveFocus();
    userEvent.click(within(drawer).getByRole('button', { name: 'One more Synthetic 10ml Syringe' }));
    expect(within(drawer).getByLabelText('Quantity of Synthetic 10ml Syringe')).toHaveValue('2');
    userEvent.keyboard('{esc}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.hash).not.toBe('#/slip');
  });

  test('empty drawer explains how to add and has no Review button', async () => {
    await renderAt('#/supplies');
    userEvent.click(headerRequest());
    const drawer = await screen.findByRole('dialog', { name: 'Your list' });
    expect(within(drawer).getByText(/Nothing here yet/)).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: 'Review and send' })).not.toBeInTheDocument();
  });

  test('Remove offers Undo, which restores the line in place', async () => {
    await renderAt('#/c/needles-and-syringes', /^Synthetic 10ml Syringe$/);
    userEvent.click(addButton('Synthetic 10ml Syringe'));
    go('#/c/gloves');
    userEvent.click(await screen.findByRole('button', { name: /^Add Nitrile gloves to request$/ }));
    userEvent.click(headerRequest());
    const drawer = await screen.findByRole('dialog', { name: 'Your list' });
    userEvent.click(within(drawer).getByRole('button', { name: 'Remove Synthetic 10ml Syringe' }));
    expect(await screen.findByText('Removed Synthetic 10ml Syringe from your request.')).toBeInTheDocument();
    userEvent.click(screen.getByRole('button', { name: /Undo/ }));
    expect(JSON.parse(window.localStorage.getItem(CART_KEY)).map((l) => l.name)).toEqual(['Synthetic 10ml Syringe', 'Nitrile gloves']);
  });

  test('request survives a reload', async () => {
    const { unmount } = await renderAt('#/c/needles-and-syringes', /^Synthetic 10ml Syringe$/);
    userEvent.click(addButton('Synthetic 10ml Syringe'));
    unmount();
    await renderAt('#/supplies');
    expect(headerRequest()).toHaveAccessibleName('Your list, 1 supply');
  });

  test('a 101st supply is refused with a toast', async () => {
    const many = Array.from({ length: 101 }, (_, i) => supply(i + 2, { Name: `Bulk item ${i + 2}`, Quantity: '50' }));
    handlers.supplies = () => response(200, many);
    window.localStorage.setItem(CART_KEY, JSON.stringify(
      many.slice(0, 100).map((r) => ({ id: r._sheet_row, name: r.Name, quantity: 1, max: 50 })),
    ));
    at('#/supplies');
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Search supplies'), { target: { value: 'item 102' } });
    userEvent.click(await screen.findByRole('button', { name: /^Add Bulk item 102 to request$/ }));
    expect(await screen.findByText(/Your list is full\. It can include up to 100/)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(CART_KEY))).toHaveLength(100);
  }, 20000);

  test('saved lines that expired or vanished are removed with a notice', async () => {
    window.localStorage.setItem(CART_KEY, JSON.stringify([
      { id: 4, name: 'Old saline bag', quantity: 1 },
      { id: 99, name: 'Gone', quantity: 1 },
      { id: 3, name: 'Synthetic 10ml Syringe', quantity: 2 },
    ]));
    await renderAt('#/supplies');
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(CART_KEY)).map((l) => l.name)).toEqual(['Synthetic 10ml Syringe']));
    userEvent.click(headerRequest());
    expect(await screen.findByText(/2 supplies are no longer available/)).toBeInTheDocument();
  });
});

describe('saved inventory copy', () => {
  const saved = () => writeInventoryCache({
    supplies: SUPPLIES, availability: [{ sheet_row: 3, availability_status: 'Requested', remaining: 0 }],
  });

  test('renders the saved copy at once, then revalidates with no-cache', async () => {
    saved();
    let release;
    handlers.supplies = () => new Promise((r) => { release = r; });
    at('#/c/needles-and-syringes');
    render(<App />);
    expect(screen.getByRole('button', { name: /^Synthetic 10ml Syringe$/ })).toBeInTheDocument(); // synchronous
    const held = within(rowFor('Synthetic 10ml Syringe'));
    expect(held.getAllByText('On hold').length).toBeGreaterThan(0); // badge, and the blocked control
    expect(held.queryByRole('button', { name: /^Add Synthetic 10ml Syringe to request$/ })).not.toBeInTheDocument();
    const refresh = calls.find((c) => c.path === '/api/supplies');
    expect(refresh.init.cache).toBe('no-cache');
    await act(async () => release(await response(200, SUPPLIES)));
  });

  test('first visit (no saved copy) does not force no-cache', async () => {
    await renderAt('#/supplies');
    expect(calls.find((c) => c.path === '/api/supplies').init.cache).toBeUndefined();
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(INVENTORY_KEY)).rows).toHaveLength(SUPPLIES.length));
  });

  test('refresh failure keeps the saved copy and offers Try again', async () => {
    saved();
    handlers.supplies = () => Promise.reject(new TypeError('Failed to fetch'));
    await renderAt('#/supplies');
    expect(await screen.findByText(/Couldn’t refresh the list, so this is the copy saved on this device/)).toBeInTheDocument();
    handlers.supplies = () => response(200, SUPPLIES);
    userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(screen.queryByText(/Couldn’t refresh the list/)).not.toBeInTheDocument());
  });

  test.each([
    ['{"savedAt":"x","supplies":5}'],
    ['{bad json'],
    [JSON.stringify({ savedAt: Date.now(), supplies: [] })], // old v1 shape
    [JSON.stringify({ v: 2, savedAt: Date.now(), rows: [5, null] })],
  ])('a corrupted or outdated saved copy %s is ignored', async (raw) => {
    window.localStorage.setItem(INVENTORY_KEY, raw);
    await renderAt('#/supplies');
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome, clinic' })).toBeInTheDocument();
  });
});

async function toReview() {
  await renderAt('#/c/needles-and-syringes', /^Synthetic 10ml Syringe$/);
  userEvent.click(addButton('Synthetic 10ml Syringe'));
  go('#/c/other-supplies');
  userEvent.click(await screen.findByRole('button', { name: /^Add Gauze roll to request$/ }));
  userEvent.click(headerRequest());
  userEvent.click(within(await screen.findByRole('dialog', { name: 'Your list' })).getByRole('button', { name: 'Review and send' }));
  await screen.findByRole('heading', { name: 'Review your request' });
}

const fill = (name = 'Riverside', email = 'a@b.org') => {
  userEvent.type(screen.getByLabelText('Clinic or organization name'), name);
  userEvent.type(screen.getByLabelText('Email'), email);
};

describe('review and confirmation', () => {
  test('validation blocks sending and focuses the first problem', async () => {
    await toReview();
    expect(window.location.hash).toBe('#/review');
    userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(screen.getByText('Enter your clinic or organization name.')).toBeInTheDocument();
    expect(screen.getByLabelText('Clinic or organization name')).toHaveFocus();
    expect(posts).toHaveLength(0);
  });

  test('submit -> confirmation (no request history while sign-in is off)', async () => {
    await toReview();
    fill('  Riverside Clinic ', 'Staff@Riverside.org');
    userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('heading', { name: 'Request submitted' })).toHaveFocus();
    // The request ID is saved in the sheet, never shown to the clinic or put in the address.
    expect(screen.queryByText(RID)).not.toBeInTheDocument();
    expect(window.location.hash).toBe('#/sent');
    expect(posts).toEqual([{
      org_name: 'Riverside Clinic',
      org_email: 'Staff@Riverside.org',
      client_request_id: expect.stringMatching(/^[A-Za-z0-9-]{8,80}$/),
      items: [
        expect.objectContaining({ item_name: 'Synthetic 10ml Syringe [Lot L3, Box 2, Pallet 1]', quantity: 1, sheet_row: 3 }),
        expect.objectContaining({ quantity: 1, sheet_row: 6, item_name: expect.stringMatching(/L6/) }),
      ],
    }]);
    expect(JSON.parse(window.localStorage.getItem(CART_KEY))).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(ORG_KEY))).toEqual({ name: 'Riverside Clinic', email: 'Staff@Riverside.org' });

    // History needs an account: nothing offers it, and its old address goes back to the supplies.
    expect(screen.queryByRole('button', { name: 'View my requests' })).not.toBeInTheDocument();
    expect(screen.queryByText(/under My requests/)).not.toBeInTheDocument();
    act(() => { window.location.hash = '#/requests'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await waitFor(() => expect(window.location.hash).not.toBe('#/requests'));
    expect(calls.some((c) => c.path.startsWith('/requests?email='))).toBe(false);
  });

  test('a line whose product vanished (stale tab) blocks submit with a message', async () => {
    await toReview();
    const lines = JSON.parse(window.localStorage.getItem(CART_KEY));
    const ghost = { ...lines[0], id: 'ghost product|nobody', name: 'Ghost product' };
    const value = JSON.stringify([...lines, ghost]);
    window.localStorage.setItem(CART_KEY, value);
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: CART_KEY, newValue: value })); });
    fill();
    userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ghost product is no longer available. Remove it from your request, then submit again.');
    expect(posts).toHaveLength(0);
    expect(JSON.parse(window.localStorage.getItem(CART_KEY))).toHaveLength(3);
  });

  test('not enough left: the server says how many, the list stays, and availability is fetched again', async () => {
    await toReview();
    fill();
    const detail = 'Not enough left for this request (another clinic may have just asked for some). Synthetic 10ml Syringe: only 2 left. Change the amounts on your list, or remove those supplies, then send again.';
    handlers.submit = () => response(409, { detail });
    const before = calls.filter((c) => c.path === '/inventory/availability').length;
    userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic 10ml Syringe: only 2 left.');
    await waitFor(() => expect(calls.filter((c) => c.path === '/inventory/availability').length).toBeGreaterThan(before));
    expect(JSON.parse(window.localStorage.getItem(CART_KEY)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Request submitted' })).not.toBeInTheDocument();
  });

  test('a retry after a failed submit reuses the same client_request_id; a new request gets a new one', async () => {
    await toReview();
    fill();
    handlers.submit = () => Promise.reject(new TypeError('Failed to fetch'));
    userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('alert');
    handlers.submit = () => response(200, { request_id: RID, status: 'Under Review' });
    userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('heading', { name: 'Request submitted' });
    expect(posts).toHaveLength(2);
    expect(posts[0].client_request_id).toMatch(/^[A-Za-z0-9-]{8,80}$/);
    expect(posts[1].client_request_id).toBe(posts[0].client_request_id);
  });

  test('an over-long category cell is cut to the server limit of 200 characters', async () => {
    handlers.supplies = () => response(200, [supply(3, { Name: 'Synthetic long category', Category: 'C'.repeat(300), Subcategory: 'Gloves', Quantity: '5' })]);
    await renderAt('#/c/gloves', /^Synthetic long category$/);
    userEvent.click(within(rowFor('Synthetic long category')).getByRole('button', { name: /^Add Synthetic long category to request$/ }));
    go('#/review');
    await screen.findByRole('heading', { name: 'Review your request' });
    fill();
    userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('heading', { name: 'Request submitted' });
    expect(posts[0].items[0].category).toHaveLength(200);
  });

  test('a multi-lot product is sent as one line per lot, earliest expiry first', async () => {
    handlers.supplies = () => response(200, [
      ...SUPPLIES,
      supply(30, { Name: 'Saline flush', General: 'saline flush syringe', Subcategory: 'IV Supplies', 'Date of Expiration': '2028-01-01', Quantity: '5', 'Lot Number': 'LATE' }),
      supply(31, { Name: 'Saline flush', General: 'saline flush syringe', Subcategory: 'IV Supplies', 'Date of Expiration': '2027-01-01', Quantity: '2', 'Lot Number': 'EARLY' }),
    ]);
    await renderAt('#/c/iv-supplies', /^Saline flush$/);
    const row = rowFor('Saline flush');
    expect(within(row).getByText('7')).toBeInTheDocument(); // both batches in one row; the detail lists them
    userEvent.click(within(row).getByRole('button', { name: /^Add Saline flush to request$/ }));
    const qty = within(row).getByLabelText('Quantity of Saline flush');
    userEvent.clear(qty);
    userEvent.type(qty, '4{enter}');
    go('#/review');
    await screen.findByRole('heading', { name: 'Review your request' });
    fill();
    userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('heading', { name: 'Request submitted' });
    expect(posts[0].items.map((i) => [i.sheet_row, i.quantity])).toEqual([[31, 2], [30, 2]]);
    // FE-13: HQ must be able to tell the two lines apart
    expect(new Set(posts[0].items.map((i) => i.item_name)).size).toBe(2);
  });

  test('double submit posts once', async () => {
    let release;
    handlers.submit = () => new Promise((r) => { release = r; });
    await toReview();
    fill();
    const send = screen.getByRole('button', { name: 'Send request' });
    fireEvent.submit(send.closest('form'));
    fireEvent.submit(send.closest('form'));
    expect(posts).toHaveLength(1);
    await act(async () => release(await response(200, { request_id: RID, status: 'Under Review' })));
    await screen.findByRole('heading', { name: 'Request submitted' });
  });

  test.each([
    [429, { detail: 'Too many requests. Try again in a minute.' }, /Wait a minute/],
    [400, { detail: 'Request rejected.' }, /Request rejected\./],
    [503, { detail: 'Inventory service busy, try again in a minute.' }, /server ran into a problem/],
  ])('server %i is shown and the request is kept', async (status, body, message) => {
    handlers.submit = () => response(status, body);
    await toReview();
    fill();
    userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(JSON.parse(window.localStorage.getItem(CART_KEY))).toHaveLength(2);
  });

  test('empty review page offers to browse', async () => {
    await renderAt('#/review', null);
    expect(await screen.findByRole('heading', { level: 1, name: 'Your list is empty' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  test.each(['#/sent/<b>x</b>', '#/sent/hello%20world', '#/sent/%E0%A4%A'])('%s shows a plain confirmation, never the address text', async (hash) => {
    await renderAt(hash, null);
    expect(await screen.findByRole('heading', { level: 1, name: 'Request submitted' })).toBeInTheDocument();
    expect(screen.queryByText(/hello|<b>/)).not.toBeInTheDocument();
  });
});

describe('loading and errors', () => {
  test('API down with no saved copy: error and working retry', async () => {
    handlers.supplies = () => Promise.reject(new TypeError('Failed to fetch'));
    at('#/supplies');
    render(<App />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load the supply list');
    handlers.supplies = () => response(200, SUPPLIES);
    userEvent.click(within(alert).getByRole('button', { name: /Try again/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, clinic' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/api/supplies').pop().init.cache).toBe('no-cache');
  });

  test('slow first load explains the cold start', async () => {
    jest.useFakeTimers();
    try {
      let release;
      handlers.supplies = () => new Promise((r) => { release = r; });
      at('#/supplies');
      render(<App />);
      act(() => { jest.advanceTimersByTime(5000); });
      expect(screen.getByText(/Waking up the server/)).toBeInTheDocument();
      await act(async () => release(await response(200, SUPPLIES)));
    } finally {
      jest.useRealTimers();
    }
  });

  test('item detail opens via hash, has no photo, closes with Escape', async () => {
    await renderAt('#/c/gloves', /^Nitrile gloves$/);
    userEvent.click(screen.getByRole('button', { name: /^Nitrile gloves$/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Nitrile gloves' });
    expect(window.location.hash).toBe('#/item/5');
    expect(within(dialog).getByText(/Our team checks this supply by hand/)).toBeInTheDocument();
    expect(dialog.querySelector('img')).toBeNull();
    userEvent.keyboard('{esc}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});


// Requested 2026-10-09 (user): alphabetical everywhere, expired items hidden entirely,
// "Low stock" instead of "Only N left", every type tile shown, contact footer, new name.



describe('one-page inventory (the chapter site layout)', () => {
  test('expired supplies are hidden until "Hide expired items" is unticked, and can’t be requested', async () => {
    await renderAt('#/supplies', /^Nitrile gloves$/);
    expect(screen.queryByText('Old saline bag')).not.toBeInTheDocument();
    userEvent.click(screen.getByRole('checkbox', { name: 'Hide expired items' }));
    const row = screen.getByText('Old saline bag').closest('tr');
    expect(within(row).getAllByText('Expired').length).toBeGreaterThan(0);
    expect(within(row).queryByRole('button', { name: /^Add/ })).not.toBeInTheDocument();
  });

  test('Availability, Expiration and Sort by narrow and order the list', async () => {
    await renderAt('#/supplies', /^Nitrile gloves$/);
    userEvent.selectOptions(screen.getByLabelText('Availability'), 'Limited quantity');
    expect(screen.getByRole('button', { name: /^Gauze pads 4x4$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Nitrile gloves$/ })).not.toBeInTheDocument();
    userEvent.selectOptions(screen.getByLabelText('Availability'), 'Any availability');
    userEvent.selectOptions(screen.getByLabelText('Expiration'), 'Expired');
    expect(screen.getByText('Old saline bag')).toBeInTheDocument(); // shown even with the box ticked
    userEvent.selectOptions(screen.getByLabelText('Expiration'), 'Any expiration');
    userEvent.selectOptions(screen.getByLabelText('Sort by'), 'Quantity (most first)');
    const names = screen.getAllByRole('rowheader').map((r) => r.firstChild.textContent);
    expect(names[0]).toBe('Nitrile gloves');
  });

  test('closing a supply’s details doesn’t jump the page: going back fires popstate and hashchange', async () => {
    const jumped = [];
    Element.prototype.scrollIntoView = jest.fn(function jump() { jumped.push(this.id); });
    await renderAt('#/supplies', /^Nitrile gloves$/);
    expect(new Set(jumped)).toEqual(new Set(['inventory'])); // arriving: to the list (again once it has loaded)
    const before = jumped.length;
    const name = screen.getByRole('button', { name: /^Nitrile gloves$/ });
    name.focus();
    userEvent.click(name);
    await screen.findByRole('dialog', { name: 'Nitrile gloves' });
    act(() => {
      window.history.replaceState(null, '', '/#/supplies'); // what the back button does…
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.dispatchEvent(new HashChangeEvent('hashchange')); // …and the browser's second event
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(jumped).toHaveLength(before); // closing doesn't jump anywhere
    expect(name).toHaveFocus();
  });

  test('a plain #inventory link becomes #/inventory, so going back to it never lets the browser jump', async () => {
    const jumped = [];
    Element.prototype.scrollIntoView = jest.fn(function jump() { jumped.push(this.id); });
    await renderAt('#inventory', /^Nitrile gloves$/);
    expect(window.location.hash).toBe('#/inventory');
    expect(jumped).toContain('inventory');
  });

  test('the old supplies address opens the one page at the inventory, with totals', async () => {
    const jumped = [];
    Element.prototype.scrollIntoView = jest.fn(function jump() { jumped.push(this.id); });
    await renderAt('#/supplies', /^Nitrile gloves$/);
    expect(jumped).toContain('inventory');
    const totals = screen.getByRole('region', { name: 'Inventory totals' });
    expect(within(totals).getByText('Supply types available')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse supplies' })).toHaveAttribute('href', '#/inventory');
  });
});
