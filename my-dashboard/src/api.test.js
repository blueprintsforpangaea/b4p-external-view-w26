import { API_BASE, ApiError, apiRequest, getAllRequests, getAvailability, getMyRequests, getSupplies, setRequestStatus, submitRequest } from './api';
import { parseHash } from './hooks';

const json = (status, body) => Promise.resolve({
  ok: status >= 200 && status < 300,
  status,
  json: () => (body === undefined ? Promise.reject(new SyntaxError('no body')) : Promise.resolve(body)),
});

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
  delete global.fetch;
});

async function failure(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the request to fail');
}

describe('apiRequest', () => {
  test('GET returns parsed JSON from the configured base URL', async () => {
    fetch.mockReturnValue(json(200, [{ a: 1 }]));
    await expect(apiRequest('/api/supplies')).resolves.toEqual([{ a: 1 }]);
    expect(fetch.mock.calls[0][0]).toBe(`${API_BASE}/api/supplies`);
    expect(API_BASE).not.toMatch(/\/$/);
  });

  test('POST sends JSON', async () => {
    fetch.mockReturnValue(json(200, { request_id: 'REQ-1', status: 'Under Review' }));
    const payload = { org_name: 'A', org_email: 'a@b.co', items: [{ item_name: 'X', quantity: 1 }] };
    await submitRequest(payload);
    const [, init] = fetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  test('HQ calls send the token header; plain GETs send no headers', async () => {
    fetch.mockReturnValue(json(200, []));
    await getAllRequests('t0k');
    expect(fetch.mock.calls[0][0]).toBe(`${API_BASE}/requests`);
    expect(fetch.mock.calls[0][1].headers).toEqual({ 'X-HQ-Token': 't0k' });
    expect(fetch.mock.calls[0][1].cache).toBe('no-store');

    fetch.mockReturnValue(json(200, { request_id: 'REQ-1/x', status: 'Approved' }));
    await setRequestStatus('REQ-1/x', 'Approved', 't0k');
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe(`${API_BASE}/requests/REQ-1%2Fx/status`);
    expect(init.method).toBe('PATCH');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-HQ-Token': 't0k' });
    expect(JSON.parse(init.body)).toEqual({ status: 'Approved' });

    await getSupplies();
    expect(fetch.mock.calls[2][1].headers).toBeUndefined();
  });

  test('email is URL-encoded in My requests', async () => {
    fetch.mockReturnValue(json(200, []));
    await getMyRequests('a+b&c=d@x.org');
    expect(fetch.mock.calls[0][0]).toBe(`${API_BASE}/requests?email=a%2Bb%26c%3Dd%40x.org`);
  });

  test('cache option is passed to fetch only when set', async () => {
    fetch.mockReturnValue(json(200, []));
    await getSupplies();
    await getSupplies({ cache: 'no-cache' });
    await getAvailability({ cache: 'no-cache' });
    await getMyRequests('a@b.org', { cache: 'no-cache' });
    expect('cache' in fetch.mock.calls[0][1]).toBe(false);
    expect(fetch.mock.calls.slice(1).map((c) => c[1].cache)).toEqual(['no-cache', 'no-cache', 'no-cache']);
  });

  test('network failure -> friendly network error', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await failure(apiRequest('/x'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('network');
    expect(err.message).toMatch(/internet connection/);
  });

  test('timeout aborts and says the server may be starting', async () => {
    jest.useFakeTimers();
    fetch.mockImplementation((url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const p = failure(apiRequest('/x', { timeout: 1000 }));
    jest.advanceTimersByTime(1000);
    const err = await p;
    expect(err.kind).toBe('timeout');
    expect(err.message).toMatch(/starting up/);
  });

  test('onSlow fires after 5s for a cold start, and not for a fast answer', async () => {
    jest.useFakeTimers();
    let resolve;
    fetch.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const onSlow = jest.fn();
    const p = apiRequest('/x', { onSlow });
    jest.advanceTimersByTime(4999);
    expect(onSlow).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onSlow).toHaveBeenCalledTimes(1);
    resolve(await json(200, []));
    await p;

    const fast = jest.fn();
    fetch.mockReturnValue(json(200, []));
    await apiRequest('/x', { onSlow: fast });
    jest.advanceTimersByTime(10000);
    expect(fast).not.toHaveBeenCalled();
  });

  test('429 is explained', async () => {
    fetch.mockReturnValue(json(429, { detail: 'Too many requests. Try again in a minute.' }));
    const err = await failure(apiRequest('/requests'));
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/Wait a minute/);
  });

  test.each([500, 502, 503])('%i hides server detail', async (status) => {
    fetch.mockReturnValue(json(status, { detail: 'psycopg OperationalError at 10.0.0.1' }));
    const err = await failure(apiRequest('/x'));
    expect(err.status).toBe(status);
    expect(err.message).not.toMatch(/psycopg|10\.0\.0\.1/);
  });

  test('non-JSON error body (plain "Internal Server Error") is handled', async () => {
    fetch.mockReturnValue(json(500, undefined));
    const err = await failure(apiRequest('/x'));
    expect(err.message).toMatch(/server ran into a problem/);
  });

  test('400 shows short server detail', async () => {
    fetch.mockReturnValue(json(400, { detail: 'Request rejected.' }));
    expect((await failure(apiRequest('/x'))).message).toBe('Request rejected.');
  });

  test('422 maps fields and item problems to plain language', async () => {
    fetch.mockReturnValue(json(422, { detail: [
      { loc: ['body', 'org_email'], msg: 'Value error, invalid email address' },
      { loc: ['body', 'items', 0, 'quantity'], msg: 'Input should be less than or equal to 10000' },
    ] }));
    const err = await failure(submitRequest({}));
    expect(err.fields).toEqual({ org_email: expect.stringMatching(/valid email/) });
    expect(err.message).toMatch(/between 1 and 10,000/);
  });

  test('422 too many items', async () => {
    fetch.mockReturnValue(json(422, { detail: [{ loc: ['body', 'items'], msg: 'List should have at most 100 items' }] }));
    expect((await failure(submitRequest({}))).message).toMatch(/up to 100/);
  });

  test('422 only on fields asks to check them', async () => {
    fetch.mockReturnValue(json(422, { detail: [{ loc: ['body', 'org_name'], msg: 'x' }] }));
    const err = await failure(submitRequest({}));
    expect(err.message).toBe('Check the highlighted fields.');
    expect(err.fields.org_name).toMatch(/organization name/);
  });

  test('422 with a string detail or odd shape still gives a message', async () => {
    fetch.mockReturnValue(json(422, { detail: [{}] }));
    expect((await failure(submitRequest({}))).message).toMatch(/not accepted/);
  });
});

describe('parseHash', () => {
  test.each([
    ['', { view: 'catalog' }],
    ['#/', { view: 'catalog' }],
    ['#/requests', { view: 'requests' }],
    ['#/checkout', { view: 'checkout' }],
    ['#/slip', { view: 'slip' }],
    ['#/item/42', { view: 'item', id: 42 }],
    ['#/item/abc', { view: 'catalog' }],
    ['#/item/', { view: 'catalog' }],
    ['#/sent/REQ-1760000000-123', { view: 'sent', id: 'REQ-1760000000-123' }],
    ['#/sent/', { view: 'catalog' }],
    ['#/nope', { view: 'catalog' }],
    ['#requests', { view: 'requests' }],
    ['#/hq', { view: 'hq' }],
  ])('%s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });

  test('a malformed percent-escape in the URL does not crash the app', () => {
    expect(() => parseHash('#/sent/%E0%A4%A')).not.toThrow();
  });
});
