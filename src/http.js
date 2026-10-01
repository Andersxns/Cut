import { fetch } from 'undici';
import { dispatcherFor } from './net/dispatcher.js';
import { currentContext } from './net/context.js';
import { userAgentString, timeoutFactor, fixedTimeout } from './net/settings.js';

// Every request to an upstream engine goes through here. Cut talks to
// engines on your behalf, so they only ever see the server — or its proxy or
// Tor exit — never you.

export class UpstreamError extends Error {
  constructor(message, { code = 'error', status } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function privacyHeaders() {
  const context = currentContext();
  const headers = {};
  if (context.gpc) headers['Sec-GPC'] = '1';
  if (context.dnt) headers.DNT = '1';
  return headers;
}

export const effectiveTimeout = (ms) => fixedTimeout() ?? Math.round(ms * (timeoutFactor() || 1));

// Low-level fetch through the configured network path (proxy, Tor, DoH).
export function fetchRaw(url, { headers, timeout = 8000, ...init } = {}) {
  const target = url instanceof URL ? url : new URL(url);
  return fetch(target, {
    redirect: 'follow',
    ...init,
    headers: { 'User-Agent': userAgentString(), ...privacyHeaders(), ...headers },
    dispatcher: dispatcherFor(target),
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(effectiveTimeout(timeout))]) : AbortSignal.timeout(effectiveTimeout(timeout)),
  });
}

const BASE_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.7',
  'Upgrade-Insecure-Requests': '1',
};

export async function fetchUpstream(url, { method = 'GET', headers, body, timeout = 5000, signal, as = 'text', lang } = {}) {
  let response;
  try {
    response = await fetchRaw(url, { method, body, signal, timeout, headers: { ...BASE_HEADERS, ...(lang ? { 'Accept-Language': lang } : null), ...headers } });
  } catch (err) {
    throw toUpstreamError(err);
  }
  if (response.status === 429) throw new UpstreamError('rate limited', { code: 'ratelimit', status: 429 });
  if (response.status === 403) throw new UpstreamError('blocked', { code: 'blocked', status: 403 });
  if (!response.ok) throw new UpstreamError(`HTTP ${response.status}`, { code: 'http', status: response.status });
  if (as === 'response') return response;
  try {
    if (as === 'json') return await response.json();
    return await response.text();
  } catch (err) {
    if (err instanceof SyntaxError) throw new UpstreamError('invalid JSON', { code: 'parse' });
    throw toUpstreamError(err);
  }
}

export function toUpstreamError(err) {
  if (err instanceof UpstreamError) return err;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return new UpstreamError('timed out', { code: 'timeout' });
  const cause = err?.cause;
  if (cause?.code === 'EPROXY' || /proxy|socks/i.test(cause?.message || '')) return new UpstreamError(cause.message, { code: 'proxy' });
  return new UpstreamError(cause?.code || err?.message || 'network error', { code: 'network' });
}

export const describeError = (code) =>
  ({
    timeout: 'timed out',
    late: 'was too slow',
    offtopic: 'returned unrelated results',
    ratelimit: 'rate limited',
    blocked: 'blocked the request',
    captcha: 'asked for a CAPTCHA',
    parse: 'returned an unexpected page',
    network: 'unreachable',
    proxy: 'couldn’t be reached through the proxy',
    http: 'returned an error',
    key: 'didn’t accept your API key',
    quota: 'has no searches left on your plan',
  })[code] || 'failed';
