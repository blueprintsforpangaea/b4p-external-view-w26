// Small fetch wrapper: base URL, timeout, "server is waking up" signal, and
// error messages written for clinic staff rather than developers.

export const API_BASE = (process.env.REACT_APP_API_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');

// Render's free tier sleeps; the first request after a nap can take ~50s.
const DEFAULT_TIMEOUT = 75000;
const SLOW_AFTER = 5000;

export class ApiError extends Error {
  constructor(message, { status = 0, kind = 'http', fields = {} } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind; // 'network' | 'timeout' | 'http'
    this.fields = fields; // { org_name, org_email } messages from server validation
  }
}

const FIELD_MESSAGES = {
  org_name: 'Enter your clinic or organization name.',
  org_email: 'Enter a valid email address, like name@clinic.org.',
};

// FastAPI/pydantic 422 bodies look like {detail: [{loc: [...], msg: '...'}]}.
function describeValidation(detail) {
  const fields = {};
  const messages = [];
  for (const issue of detail) {
    const loc = Array.isArray(issue.loc) ? issue.loc : [];
    const field = loc[1];
    if (field === 'org_name' || field === 'org_email') {
      fields[field] = FIELD_MESSAGES[field];
    } else if (field === 'items' && loc.length === 2) {
      messages.push('A request can include up to 100 different supplies. Remove some and send the rest in a second request.');
    } else if (field === 'items' && loc[3] === 'quantity') {
      messages.push('Each quantity must be between 1 and 10,000.');
    } else if (field === 'items') {
      messages.push('One of the supplies in your request is no longer valid. Remove it and try again.');
    }
  }
  if (!messages.length && Object.keys(fields).length) messages.push('Check the highlighted fields.');
  if (!messages.length) messages.push('Some details in the request were not accepted. Check them and try again.');
  return { message: [...new Set(messages)].join(' '), fields };
}

function messageFor(status, body) {
  const detail = body && body.detail;
  if (status === 422 && Array.isArray(detail)) return describeValidation(detail);
  if (status === 429) return { message: 'Too many requests from this connection. Wait a minute, then try again.' };
  if (status >= 500) return { message: 'The server ran into a problem. Try again in a moment.' };
  if (typeof detail === 'string' && detail.length < 200) return { message: detail };
  return { message: `The server could not handle this request (error ${status}).` };
}

// `cache: 'no-cache'` makes the browser revalidate (ETag -> usually a tiny 304)
// instead of serving its up-to-60s-old copy; use it after user actions.
export async function apiRequest(path, { method = 'GET', body, headers, timeout = DEFAULT_TIMEOUT, onSlow, cache } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const slowTimer = onSlow ? setTimeout(onSlow, SLOW_AFTER) : null;
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body || headers ? { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      ...(cache ? { cache } : {}),
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new ApiError('The server took too long to answer. It may still be starting up; try again in a minute.', { kind: 'timeout' });
    }
    throw new ApiError('Could not reach the server. Check your internet connection and try again.', { kind: 'network' });
  } finally {
    clearTimeout(timer);
    if (slowTimer) clearTimeout(slowTimer);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const { message, fields } = messageFor(res.status, data);
    throw new ApiError(message, { status: res.status, fields });
  }
  return data;
}

export const getSupplies = (opts) => apiRequest('/api/supplies', opts);
export const getAvailability = (opts) => apiRequest('/inventory/availability', opts);
export const getMyRequests = (email, opts) => apiRequest(`/requests?email=${encodeURIComponent(email)}`, opts);
export const submitRequest = (payload, opts) => apiRequest('/requests', { ...opts, method: 'POST', body: payload });

// HQ only: the shared HQ_API_TOKEN goes in X-HQ-Token (see require_hq in main.py).
const hqHeaders = (token) => ({ 'X-HQ-Token': token });
export const getAllRequests = (token, opts) =>
  apiRequest('/requests', { ...opts, headers: hqHeaders(token), cache: 'no-store' });
export const setRequestStatus = (id, status, token) =>
  apiRequest(`/requests/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status }, headers: hqHeaders(token) });
