import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { TTLCache, cacheKey } from './util/cache.js';
import { parseUrl, isPublicHost, isHostname } from './util/url.js';
import { escapeHtml } from './util/html.js';
import { fetchRaw } from './http.js';

// Image & favicon proxy. Thumbnails and site icons are fetched by Cut, so the
// sites in your results never see your IP address or a Referer.

const sign = (value) => createHmac('sha256', config.secret).update(value).digest('base64url').slice(0, 22);

export function signedImageUrl(url) {
  if (!url || !parseUrl(url)) return '';
  return `/img?u=${encodeURIComponent(url)}&s=${sign(url)}`;
}

// Image source for a results page: proxied through Cut unless the user
// chose to load images directly from their hosts.
export const imageSrc = (url, ctx) => (ctx?.fx?.proxyImages === false ? (parseUrl(url) ? url : '') : signedImageUrl(url));

function verify(value, signature) {
  const expected = Buffer.from(sign(value));
  const given = Buffer.from(String(signature || ''));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const PROXY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
};

const imageCache = new TTLCache({ max: 600, ttl: 6 * 3600_000 });
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_CACHED_BYTES = 256 * 1024;

const upstreamHeaders = (accept) => ({ Accept: accept, 'Accept-Language': 'en-US,en;q=0.7' });

export async function handleImageProxy(req, res, url) {
  const target = url.searchParams.get('u') || '';
  if (!verify(target, url.searchParams.get('s'))) return plain(res, 403, 'Invalid image signature');
  const parsed = parseUrl(target);
  if (!parsed || !isPublicHost(parsed.hostname)) return plain(res, 400, 'Unsupported image address');

  const key = cacheKey('img', target);
  const cached = imageCache.get(key);
  if (cached) return sendBuffer(res, cached.type, cached.body, 86400);

  let upstream;
  try {
    upstream = await fetchRaw(parsed, { headers: upstreamHeaders('image/avif,image/webp,image/png,image/*;q=0.8'), timeout: 10000 });
  } catch {
    return plain(res, 504, 'Image unavailable');
  }
  const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const length = Number(upstream.headers.get('content-length')) || 0;
  if (!upstream.ok || !type.startsWith('image/') || type.includes('svg') || length > MAX_IMAGE_BYTES) {
    upstream.body?.cancel().catch(() => {});
    return plain(res, 502, 'Image unavailable');
  }

  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400, immutable', ...PROXY_HEADERS });
  const reader = upstream.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_IMAGE_BYTES) {
        reader.cancel().catch(() => {});
        res.destroy();
        return;
      }
      if (total <= MAX_CACHED_BYTES) chunks.push(value);
      if (!res.write(value)) await new Promise((resolve) => res.once('drain', resolve));
    }
  } catch {
    res.destroy();
    return;
  }
  res.end();
  if (total <= MAX_CACHED_BYTES) imageCache.set(key, { type, body: Buffer.concat(chunks) });
}

const faviconCache = new TTLCache({ max: 4000, ttl: 7 * 24 * 3600_000 });

function letterIcon(host) {
  const name = host.replace(/^(www\d?|m)\./, '');
  const letter = (name.match(/[a-z0-9]/i) || ['?'])[0].toUpperCase();
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="hsl(${hash % 360} 52% 50%)"/><text x="16" y="21.6" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="17" font-weight="700" fill="#fff">${escapeHtml(letter)}</text></svg>`;
  return { type: 'image/svg+xml', body: Buffer.from(svg) };
}

async function fetchIcon(url) {
  const response = await fetchRaw(url, { headers: upstreamHeaders('image/*'), timeout: 4000 });
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!response.ok || !(type.startsWith('image/') || type === 'application/octet-stream') || type.includes('svg')) return null;
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length < 70 || body.length > 200_000) return null;
  return { type: type === 'application/octet-stream' ? 'image/x-icon' : type, body };
}

function getFavicon(host) {
  return faviconCache.wrap(host, async () => {
    const candidates = [`https://icons.duckduckgo.com/ip3/${host}.ico`];
    const parent = host.split('.').slice(-2).join('.');
    if (parent !== host) candidates.push(`https://icons.duckduckgo.com/ip3/${parent}.ico`);
    for (const candidate of candidates) {
      const found = await fetchIcon(candidate).catch(() => null);
      if (found) return found;
    }
    return letterIcon(host);
  });
}

// Starts fetching icons for a results page before the browser asks for them.
export function warmFavicons(hosts) {
  for (const host of new Set(hosts)) {
    if (host && isHostname(host) && isPublicHost(host)) getFavicon(host).catch(() => {});
  }
}

export async function handleFavicon(req, res, host) {
  try {
    host = decodeURIComponent(host || '').toLowerCase();
  } catch {
    host = '';
  }
  if (!isHostname(host) || !isPublicHost(host)) return plain(res, 400, 'Bad host');
  const icon = await getFavicon(host);
  sendBuffer(res, icon.type, icon.body, 7 * 86400);
}

function sendBuffer(res, type, body, maxAge) {
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': `public, max-age=${maxAge}`, ...PROXY_HEADERS });
  res.end(body);
}

function plain(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...PROXY_HEADERS });
  res.end(message);
}
