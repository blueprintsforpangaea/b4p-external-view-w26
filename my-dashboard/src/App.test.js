import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

describe('landing', () => {
  test('lists every category with how many kinds, type links, and no photos', async () => {
    at('#/');
    const { container } = render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Supplies for partner clinics' })).toBeInTheDocument();
    const landing = document.querySelector('.landing');
    const syringes = within(landing).getByRole('link', { name: /Needles & Syringes/ });
    expect(syringes).toHaveAttribute('href', '#/c/needles-and-syringes');
    expect(syringes.closest('h2')).toHaveTextContent(/Needles & Syringes\s*\d+ kinds? of supplies/);
    expect(within(landing).getByRole('link', { name: /Other supplies/ })).toBeInTheDocument();
    expect(container.querySelectorAll('a[href^="#/c/needles-and-syringes/"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });

  test('unlabelled rows are hidden (no footnote any more)', async () => {
    await renderAt('#/');
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'cardinal' } });
    await screen.findByRole('heading', { level: 1, name: /Results for/ });
    expect(screen.queryByText('Unnamed supply')).not.toBeInTheDocument();
    expect(document.querySelectorAll('tr.item-row[data-row="8"]')).toHaveLength(0);
  });
});

describe('category page', () => {
  test('h1, type tiles, one table per type, rows with stock', async () => {
    await renderAt('#/c/needles-and-syringes', /^Synthetic 10ml Syringe$/);
    expect(screen.getByRole('heading', { level: 1, name: 'Needles & Syringes' })).toBeInTheDocument();
    const tiles = screen.getByRole('list', { name: 'Types of Needles & Syringes' });
    expect(within(tiles).getAllByRole('link').length).toBeGreaterThan(0);
    const row = rowFor('Synthetic 10ml Syringe');
    expect(row).toHaveAttribute('data-row', '3');
    expect(within(row).getByText('40 in stock')).toBeInTheDocument();
    expect(row.closest('table')).toHaveClass('spec');
    expect(screen.queryByRole('button', { name: /^Gauze pads 4x4$/ })).not.toBeInTheDocument();
  });

  test('clicking a category on the landing page navigates to it', async () => {
    at('#/');
    render(<App />);
    await screen.findByRole('heading', { level: 1 });
    userEvent.click(within(document.querySelector('.landing')).getByRole('link', { name: /Needles & Syringes/ }));
    go('#/c/needles-and-syringes'); // jsdom does not follow hash links by itself
    expect(await screen.findByRole('heading', { level: 1, name: 'Needles & Syringes' })).toBeInTheDocument();
  });

  test('zero-stock rows cannot be added', async () => {
    await renderAt('#/c/needles-and-syringes', /^Synthetic 10ml Syringe$/);
    expect(rowFor('Empty syringe box').querySelector('.spec__qty')).toHaveTextContent('Out of stock');
    expect(within(rowFor('Empty syringe box')).queryByRole('button', { name: /^Add/ })).not.toBeInTheDocument();
  });

  test('In stock only and Hide expiring soon filters', async () => {
    const soon = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
    handlers.supplies = () => response(200, [...SUPPLIES, supply(60, { Name: 'Soon gauze', 'Date of Expiration': soon })]);
    await renderAt('#/c/needles-and-syringes', /^Synthetic 10ml Syringe$/);
    userEvent.click(screen.getByLabelText('In stock only'));
    expect(screen.queryByRole('button', { name: /^Empty syringe box$/ })).not.toBeInTheDocument();
    go('#/c/wound-care-and-bandages');
    await screen.findByRole('button', { name: /^Soon gauze$/ });
    expect(within(rowFor('Soon gauze')).getByText('Expires soon')).toBeInTheDocument();
    userEvent.click(screen.getByLabelText('Hide expiring soon'));
    expect(screen.queryByRole('button', { name: /^Soon gauze$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Gauze pads 4x4$/ })).toBeInTheDocument();
  });

  test('a type link focuses that type section', async () => {
    await renderAt('#/c/needles-and-syringes', /^Synthetic 10ml Syringe$/);
    const tile = within(screen.getByRole('list', { name: 'Types of Needles & Syringes' })).getAllByRole('link')[0];
    const hash = tile.getAttribute('href');
    go(hash);
    const slug = hash.split('/').pop();
    await waitFor(() => expect(document.getElementById(`type-${slug}`)).toHaveFocus());
  });

  test('unknown category slug falls back gracefully', async () => {
    at('#/c/not-a-category');
    render(<App />);
    expect(await screen.findByRole('link', { name: 'See all categories' })).toBeInTheDocument();
  });
});

describe('search', () => {
  test('instant search shows matching rows; unlabelled rows never appear', async () => {
    await renderAt('#/');
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'syringe' } });
    expect(await screen.findByRole('heading', { level: 1, name: 'Results for “syringe”' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Synthetic 10ml Syringe$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Gauze pads 4x4$/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Unnamed supply')).not.toBeInTheDocument();
  });

  test('a supply matching only through its category is listed after a heading, not dropped', async () => {
    handlers.supplies = () => response(200, [...SUPPLIES, supply(9, { Name: 'Alcohol prep pads', General: 'alcohol prep', Subcategory: 'Needles & Syringes', Quantity: '9' })]);
    await renderAt('#/');
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'syringe' } });
    expect(await screen.findByRole('heading', { level: 2, name: 'Also in matching categories' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Alcohol prep pads$/ })).toBeInTheDocument();
    const heading = screen.getByRole('heading', { level: 2, name: 'Also in matching categories' });
    const own = screen.getByRole('button', { name: /^Synthetic 10ml Syringe$/ });
    expect(own.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('no results offers Clear search, which returns to the catalog', async () => {
    await renderAt('#/');
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'zzzz' } });
    expect(await screen.findByText('No supplies match “zzzz”')).toBeInTheDocument();
    userEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Clear search' }));
    expect(screen.getByLabelText('What do you need?')).toHaveValue('');
    expect(await screen.findByRole('heading', { level: 1, name: 'Supplies for partner clinics' })).toBeInTheDocument();
  });

  test('the total counts only listed supplies', async () => {
    await renderAt('#/');
    const tree = screen.getByRole('navigation', { name: 'Categories' });
    expect(within(tree).getByRole('link', { name: /All categories/ })).toHaveTextContent(/All categories\s*5$/); // not the expired or unlabelled rows
  });

  test('the search box is only on the supply pages', async () => {
    await renderAt('#/requests', null);
    await screen.findByRole('heading', { level: 1, name: 'My requests' });
    expect(screen.queryByLabelText('What do you need?')).not.toBeInTheDocument();
    expect(within(screen.getByRole('banner')).queryByRole('searchbox')).not.toBeInTheDocument();
  });
});

describe('request drawer', () => {
  test('the header says the list is empty, then shows the count', async () => {
    await renderAt('#/c/gloves', /^Nitrile gloves$/);
    expect(headerRequest()).toHaveTextContent(/^Your list is empty$/);
    userEvent.click(addButton('Nitrile gloves'));
    expect(headerRequest()).toHaveTextContent('Your list (1)');
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
    expect(headerRequest()).toHaveTextContent('Your list (1)');
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
    await renderAt('#/');
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
    await renderAt('#/');
    expect(headerRequest()).toHaveTextContent('Your list (1)');
  });

  test('a 101st supply is refused with a toast', async () => {
    const many = Array.from({ length: 101 }, (_, i) => supply(i + 2, { Name: `Bulk item ${i + 2}`, Quantity: '50' }));
    handlers.supplies = () => response(200, many);
    window.localStorage.setItem(CART_KEY, JSON.stringify(
      many.slice(0, 100).map((r) => ({ id: r._sheet_row, name: r.Name, quantity: 1, max: 50 })),
    ));
    at('#/');
    render(<App />);
    fireEvent.change(await screen.findByLabelText('What do you need?'), { target: { value: 'item 102' } });
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
    await renderAt('#/');
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
    await renderAt('#/');
    expect(calls.find((c) => c.path === '/api/supplies').init.cache).toBeUndefined();
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(INVENTORY_KEY)).rows).toHaveLength(SUPPLIES.length));
  });

  test('refresh failure keeps the saved copy and offers Try again', async () => {
    saved();
    handlers.supplies = () => Promise.reject(new TypeError('Failed to fetch'));
    await renderAt('#/');
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
    await renderAt('#/');
    expect(screen.getByRole('heading', { level: 1, name: 'Supplies for partner clinics' })).toBeInTheDocument();
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

  test('submit -> confirmation -> My requests with status', async () => {
    await toReview();
    fill('  Riverside Clinic ', 'Staff@Riverside.org');
    userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('heading', { name: 'Request submitted' })).toHaveFocus();
    expect(screen.getByText(RID)).toBeInTheDocument();
    expect(window.location.hash).toBe(`#/sent/${RID}`);
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

    handlers.mine = () => response(200, [
      { 'Request ID': RID, 'Item Name': 'Synthetic 10ml Syringe', 'Quantity Requested': '1', Status: 'Approved', Timestamp: '2026-10-09T12:00:00+00:00' },
    ]);
    userEvent.click(screen.getByRole('button', { name: 'View my requests' }));
    expect(await screen.findByRole('heading', { name: RID })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Status: Approved' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path.startsWith('/requests?email=')).every((c) => c.init.cache === 'no-cache')).toBe(true);
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
    expect(within(row).getByRole('button', { name: '2 batches' })).toHaveAttribute('aria-expanded', 'false');
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

  test.each(['#/sent/<b>x</b>', '#/sent/hello%20world', '#/sent/%E0%A4%A'])('forged %s shows the catalog', async (hash) => {
    await renderAt(hash, null);
    expect(await screen.findByRole('heading', { level: 1, name: 'Supplies for partner clinics' })).toBeInTheDocument();
  });
});

describe('loading and errors', () => {
  test('API down with no saved copy: error and working retry', async () => {
    handlers.supplies = () => Promise.reject(new TypeError('Failed to fetch'));
    at('#/');
    render(<App />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load the supply list');
    handlers.supplies = () => response(200, SUPPLIES);
    userEvent.click(within(alert).getByRole('button', { name: /Try again/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Supplies for partner clinics' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/api/supplies').pop().init.cache).toBe('no-cache');
  });

  test('slow first load explains the cold start', async () => {
    jest.useFakeTimers();
    try {
      let release;
      handlers.supplies = () => new Promise((r) => { release = r; });
      at('#/');
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

describe('phone width', () => {
  beforeEach(() => setWide(false));

  test('Categories drawer opens, lists categories, closes with Escape', async () => {
    await renderAt('#/');
    userEvent.click(screen.getByRole('button', { name: /Categories/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Categories' });
    expect(within(drawer).getByRole('link', { name: /Needles & Syringes/ })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Close categories' })).toHaveFocus();
    userEvent.keyboard('{esc}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('no bottom bar; the header button opens the drawer', async () => {
    await renderAt('#/c/needles-and-syringes', /^Synthetic 10ml Syringe$/);
    userEvent.click(addButton('Synthetic 10ml Syringe'));
    expect(document.querySelector('.slipbar')).toBeNull();
    userEvent.click(headerRequest());
    expect(await screen.findByRole('dialog', { name: 'Your list' })).toBeInTheDocument();
  });
});

// Requested 2026-10-09 (user): alphabetical everywhere, expired items hidden entirely,
// "Low stock" instead of "Only N left", every type tile shown, contact footer, new name.
describe('ordering, expiry and wording', () => {
  const texts = (els) => els.map((e) => e.textContent.replace(/\s*\d[\d,]*\s*$/, '').trim());
  const isSorted = (list) => list.every((x, i) => i === 0 || list[i - 1].localeCompare(x, 'en', { sensitivity: 'base' }) <= 0);

  const MORE = [
    ...SUPPLIES,
    supply(40, { Name: 'Zinc tape', General: 'medical tape', Quantity: '9' }),
    supply(41, { Name: 'abdominal pad', General: 'abdominal pad', Quantity: '9' }),
    supply(42, { Name: 'Bandage roll', General: 'bandage roll', Quantity: '9' }),
    supply(43, { Name: 'Saline flush', General: 'saline flush syringe', Subcategory: 'IV Supplies', 'Date of Expiration': '2020-02-01', Quantity: '4', 'Lot Number': 'OLD' }),
    supply(44, { Name: 'Saline flush', General: 'saline flush syringe', Subcategory: 'IV Supplies', 'Date of Expiration': '2029-02-01', Quantity: '6', 'Lot Number': 'NEW' }),
  ];
  beforeEach(() => { handlers.supplies = () => response(200, MORE); });

  test('landing categories and the tree are alphabetical', async () => {
    await renderAt('#/');
    expect(isSorted(texts([...document.querySelectorAll('.landing h2 a')]))).toBe(true);
    expect(isSorted(texts([...document.querySelectorAll('.tree a[href^="#/c/"]')]))).toBe(true);
  });

  test('type tiles, type sections and rows are alphabetical, and every tile is shown', async () => {
    await renderAt('#/c/wound-care-and-bandages', /^Zinc tape$/);
    const tiles = [...document.querySelectorAll('ul.tiles a.tile .tile__name')];
    expect(isSorted(texts(tiles))).toBe(true);
    expect(screen.queryByRole('button', { name: /Show all .* types/ })).not.toBeInTheDocument();
    expect(isSorted(texts([...document.querySelectorAll('section.type h2')]))).toBe(true);
    for (const table of document.querySelectorAll('table.spec')) {
      expect(isSorted([...table.querySelectorAll('tr.item-row .item-row__name')].map((b) => b.textContent))).toBe(true);
    }
  });

  test('search results are alphabetical', async () => {
    await renderAt('#/');
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'a' } });
    await screen.findByRole('heading', { level: 1, name: 'Results for “a”' });
    for (const table of document.querySelectorAll('table.spec')) {
      expect(isSorted([...table.querySelectorAll('tr.item-row .item-row__name')].map((b) => b.textContent))).toBe(true);
    }
  });

  test('expired items are absent everywhere: category, search, landing counts, drawer', async () => {
    await renderAt('#/c/iv-supplies', /^Saline flush$/);
    expect(screen.queryByRole('button', { name: /^Old saline bag$/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument();
    // the multi-lot product only offers its unexpired lot
    const row = rowFor('Saline flush');
    expect(within(row).getByText('6 in stock')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /lots/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'saline' } });
    await screen.findByRole('heading', { level: 1, name: 'Results for “saline”' });
    expect(screen.queryByRole('button', { name: /^Old saline bag$/ })).not.toBeInTheDocument();
    go('#/item/4'); // deep link to an expired row
    expect(await screen.findByText(/isn’t in the list anymore/)).toBeInTheDocument();
  });

  test('a category whose items are all expired is not listed', async () => {
    handlers.supplies = () => response(200, [...SUPPLIES, supply(50, { Name: 'Old mask', Subcategory: 'Masks & Face Shields', 'Date of Expiration': '2019-01-01' })]);
    await renderAt('#/');
    expect(document.querySelector('a[href="#/c/masks-and-face-shields"]')).toBeNull();
  });

  test('low stock says "Low stock", never "Only N left"', async () => {
    await renderAt('#/c/wound-care-and-bandages', /^Gauze pads 4x4$/);
    expect(within(rowFor('Gauze pads 4x4')).getByText('Low stock')).toBeInTheDocument();
    expect(screen.queryByText(/Only \d+ left/)).not.toBeInTheDocument();
  });

  test('footer shows the contact email instead of data-gap notes; new site name', async () => {
    await renderAt('#/');
    const link = within(screen.getByRole('contentinfo')).getByRole('link', { name: /contact@b4pglobal\.org/ });
    expect(link).toHaveAttribute('href', 'mailto:contact@b4pglobal.org');
    expect(screen.queryByText(/unlabelled/)).not.toBeInTheDocument();
    expect(document.title).toMatch(/Blueprints Supply Requests/);
  });
});

describe('round 3: progressive rows, titles', () => {
  const many = Array.from({ length: 150 }, (_, i) => supply(100 + i, {
    Name: `Pad ${String(i).padStart(3, '0')}`, General: 'gauze pad', Quantity: '5',
  }));

  test('a big category renders the first rows at once and the rest soon after', async () => {
    handlers.supplies = () => response(200, many);
    at('#/c/wound-care-and-bandages');
    render(<App />);
    await screen.findByRole('button', { name: /^Pad 000$/ });
    const first = document.querySelectorAll('tr.item-row').length;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(150);
    await waitFor(() => expect(document.querySelectorAll('tr.item-row')).toHaveLength(150), { timeout: 4000 });
    expect(screen.getByRole('button', { name: /^Pad 149$/ })).toBeInTheDocument();
  });

  test('a deep link to a type renders all of its rows immediately', async () => {
    handlers.supplies = () => response(200, many);
    at('#/c/wound-care-and-bandages');
    const { unmount } = render(<App />);
    await screen.findByRole('button', { name: /^Pad 000$/ });
    const typeHref = document.querySelector('a.tile').getAttribute('href');
    unmount();
    at(typeHref);
    render(<App />);
    await screen.findByRole('button', { name: /^Pad 000$/ });
    expect(document.querySelectorAll('tr.item-row')).toHaveLength(150);
  });

  test('page titles carry the site name', async () => {
    await renderAt('#/c/gloves', /^Nitrile gloves$/);
    expect(document.title).toBe('Gloves | Blueprints Supply Requests');
    go('#/requests');
    await screen.findByRole('heading', { level: 1, name: 'My requests' });
    expect(document.title).toBe('My requests | Blueprints Supply Requests');
  });

  test('matching-type tiles in search name their category', async () => {
    await renderAt('#/');
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'glove' } });
    await screen.findByRole('heading', { level: 1, name: 'Results for “glove”' });
    const tile = document.querySelector('a.tile');
    expect(tile.querySelector('.tile__cat')).toHaveTextContent(/^in Gloves$/);
    expect(tile.querySelector('.tile__count').textContent).not.toMatch(/in /);
  });

  test('category-page tiles never show a category line', async () => {
    await renderAt('#/c/gloves', /^Nitrile gloves$/);
    expect(document.querySelectorAll('a.tile').length).toBeGreaterThan(0);
    expect(document.querySelector('a.tile .tile__cat')).toBeNull();
  });
});

describe('landing tiles', () => {
  test('every page has a one-click help email at the top', async () => {
    await renderAt('#/');
    const help = within(screen.getByRole('banner')).getByRole('link', { name: 'Get help: email contact@b4pglobal.org' });
    expect(help).toHaveAttribute('href', 'mailto:contact@b4pglobal.org?subject=Help%20with%20a%20supply%20request');
  });

  const many = Array.from({ length: 9 }, (_, i) => supply(200 + i, {
    Name: `Wound thing ${i}`, General: ['gauze pad', 'medical tape', 'bandage roll', 'abdominal pad', 'wound dressing', 'skin protectant', 'tubular bandage', 'casting material', 'adhesive bandage'][i],
  }));
  beforeEach(() => {
    handlers.supplies = () => response(200, [...SUPPLIES, ...many]);
  });

  const card = () => document.querySelector('.landing section.cat a[href="#/c/wound-care-and-bandages"]').closest('section');

  test('a tile is one link to its category, shows 6 kinds, and links to the rest', async () => {
    await renderAt('#/');
    const c = card();
    const title = within(c).getByRole('heading', { level: 2 });
    expect(within(title).getAllByRole('link')).toHaveLength(1);
    expect(title).toHaveTextContent(/Wound Care & Bandages\s*\d+ kinds of supplies/);
    expect(within(c.querySelector('ul')).getAllByRole('link')).toHaveLength(6);
    const all = within(c).getByRole('link', { name: /^See all \d+ kinds in Wound Care & Bandages/ });
    expect(all).toHaveAttribute('href', '#/c/wound-care-and-bandages');
    expect(c.querySelector('.cat__n, .cat__count')).toBeNull(); // no small counts next to each kind
  });

  test('tiles with 6 or fewer kinds have no "See all" link', async () => {
    await renderAt('#/');
    const gloves = document.querySelector('.landing a[href="#/c/gloves"]').closest('section');
    expect(within(gloves).queryByRole('link', { name: /See all/ })).not.toBeInTheDocument();
  });

  test('no Expand all; the category list is beside the tiles', async () => {
    await renderAt('#/');
    expect(screen.queryByRole('button', { name: /Expand all|Show all/ })).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Categories' })).toBeInTheDocument();
  });

  test('the big search box shows results', async () => {
    await renderAt('#/');
    userEvent.type(screen.getByLabelText('What do you need?'), 'glove');
    userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Results for “glove”' })).toBeInTheDocument();
  });

  test('first-timers get a link to the guide, and there is one step bar', async () => {
    await renderAt('#/');
    expect(screen.getByRole('link', { name: /First time here\?/ })).toHaveAttribute('href', '#/how-it-works');
    expect(screen.getAllByRole('list', { name: 'Steps to request supplies' })).toHaveLength(1);
  });

  test('with the list open, only the list shows a step bar', async () => {
    await renderAt('#/c/gloves', /^Nitrile gloves$/);
    userEvent.click(addButton('Nitrile gloves'));
    userEvent.click(headerRequest());
    await screen.findByRole('dialog', { name: 'Your list' });
    const bars = screen.getAllByRole('list', { name: 'Steps to request supplies' });
    expect(bars).toHaveLength(1);
    expect(within(bars[0]).getByText('Check your list').closest('li')).toHaveAttribute('aria-current', 'step');
  });
});
