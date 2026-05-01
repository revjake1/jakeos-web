// Sidecar HTTP client.
//
// Talks to the Rust sidecar (jakeos-sidecar) over Tailscale. Configurable base
// URL via SIDECAR_BASE_URL; defaults to the Mac's tailnet IP on the documented
// port. Forwards the user's Google access token where Gmail/Calendar scope is
// needed (per data-contract spec: emails, calendar).
//
// Offline behavior: an in-memory cache holds the last successful response per
// endpoint. On failure we return the cached value with `{ stale: true }` plus
// the time of the last successful sync — the dashboard renders a banner from
// this and disables write controls.
//
// Cache is intentionally process-local and lossy on restart. v1 only.

const BASE_URL = (process.env.SIDECAR_BASE_URL || 'http://100.122.117.106:7843').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.SIDECAR_TIMEOUT_MS || 4000);

const cache = new Map(); // key → { value, fetchedAt }
let lastSuccessAt = null;
let lastFailureAt = null;
let lastFailureReason = null;

export function status() {
  return { baseUrl: BASE_URL, lastSuccessAt, lastFailureAt, lastFailureReason };
}

function cacheKey(method, path) {
  return `${method} ${path}`;
}

async function request(method, path, { body, accessToken } = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (accessToken) headers['x-google-access-token'] = accessToken;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`sidecar ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    const ct = res.headers.get('content-type') || '';
    const value = ct.includes('application/json') ? await res.json() : await res.text();
    lastSuccessAt = new Date().toISOString();
    return value;
  } finally {
    clearTimeout(timer);
  }
}

// GET with cache fall-through. Returns { value, stale, fetchedAt }.
export async function getCached(path, { accessToken } = {}) {
  const key = cacheKey('GET', path);
  try {
    const value = await request('GET', path, { accessToken });
    const fetchedAt = new Date().toISOString();
    cache.set(key, { value, fetchedAt });
    return { value, stale: false, fetchedAt };
  } catch (err) {
    lastFailureAt = new Date().toISOString();
    lastFailureReason = String(err?.message || err);
    const cached = cache.get(key);
    if (cached) return { value: cached.value, stale: true, fetchedAt: cached.fetchedAt, error: lastFailureReason };
    return { value: null, stale: true, fetchedAt: null, error: lastFailureReason };
  }
}

// Write requests. Returns { ok, value? , error? }. Never reads cache.
export async function post(path, body, { accessToken } = {}) {
  try {
    const value = await request('POST', path, { body, accessToken });
    return { ok: true, value };
  } catch (err) {
    lastFailureAt = new Date().toISOString();
    lastFailureReason = String(err?.message || err);
    return { ok: false, error: lastFailureReason };
  }
}

export async function patch(path, body, { accessToken } = {}) {
  try {
    const value = await request('PATCH', path, { body, accessToken });
    return { ok: true, value };
  } catch (err) {
    lastFailureAt = new Date().toISOString();
    lastFailureReason = String(err?.message || err);
    return { ok: false, error: lastFailureReason };
  }
}

// Liveness check: cheap, used by the offline-banner middleware on every poll.
export async function ping() {
  try {
    await request('GET', '/livez');
    return { up: true };
  } catch (err) {
    return { up: false, error: String(err?.message || err) };
  }
}
