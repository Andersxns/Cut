import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { readPrefs, mergePrefs, serializePrefs, getRegion, REGIONS, SAFE_LEVELS, DEFAULT_PREFS, COOKIE_NAME, features, cookieMaxAge, exportCode, importCode, keepSecrets } from './prefs.js';
import { getNetworkSettings, validateNetwork, saveNetworkSettings, canManageNetwork, describeNetwork, networkFixed } from './net/settings.js';
import { testConnection } from './net/dispatcher.js';
import { runWithContext } from './net/context.js';
import { ensureThreatLists, threatListStatus } from './privacy/threats.js';
import { WEB_ENGINE_IDS, TORRENT_SOURCE_IDS } from './engines/registry.js';
import { IMAGE_FILTERS } from './engines/media/images.js';
import { VIDEO_FILTERS } from './engines/media/videos.js';
import { CATEGORY_IDS } from './engines/torrents/common.js';
import { searchWeb } from './search/web.js';
import { graceFor, within } from './search/run.js';
import { searchTorrents, SORT_IDS } from './search/torrents.js';
import { searchMedia } from './search/media.js';
import { searchOnion, prepareOnionSearch } from './search/onion.js';
import { getInstantAnswer } from './answers/index.js';
import { getInfobox } from './answers/infobox.js';
import { resolveBang, suggestBangs } from './bangs.js';
import { fetchUpstream } from './http.js';
import { handleImageProxy, handleFavicon, warmFavicons } from './proxy.js';
import { hostname } from './util/url.js';
import { TTLCache, cacheKey } from './util/cache.js';
import { significantTokens } from './util/text.js';
import { searchShell, searchBody, resultsFragment } from './views/search.js';
import { searchUrl } from './views/layout.js';
import { homePage, privacyPage, bangsPage, errorPage } from './views/pages.js';
import { settingsPage } from './views/settings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const TYPES = ['web', 'images', 'videos', 'news', 'torrents', 'onion'];

// ---------- Security headers ----------

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  // Bang redirects are form submissions that end on another site.
  "form-action 'self' https:",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function securityHeaders(req, res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Permissions-Policy',
    'interest-cohort=(), browsing-topics=(), attribution-reporting=(), geolocation=(), camera=(), microphone=(), payment=(), usb=()',
  );
  if (isSecure(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

// Pages tighten or relax a few policies to match the visitor's settings:
// the Safest security level forbids all scripts, and loading images directly
// from their hosts needs remote images allowed.
function pagePolicy(ctx) {
  const csp = [
    "default-src 'none'",
    `script-src ${ctx.fx.js ? "'self'" : "'none'"}`,
    "style-src 'self'",
    `img-src 'self' data:${ctx.fx.proxyImages ? '' : ' https: http:'}`,
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "form-action 'self' https:",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  return { 'Content-Security-Policy': csp, 'Referrer-Policy': ctx.prefs.referrer === 'origin' ? 'strict-origin' : 'no-referrer' };
}

const isSecure = (req) => req.socket.encrypted || (config.trustProxy && req.headers['x-forwarded-proto'] === 'https');

function origin(req) {
  const host = String(req.headers.host || '');
  const safeHost = /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) ? host : `localhost:${config.port}`;
  return `${isSecure(req) ? 'https' : 'http'}://${safeHost}`;
}

// ---------- Responses ----------

function pickEncoding(req) {
  const accepted = String(req.headers['accept-encoding'] || '');
  if (/\bbr\b/.test(accepted)) return 'br';
  if (/\bgzip\b/.test(accepted)) return 'gzip';
  return null;
}

function send(req, res, status, body, type, headers = {}) {
  let buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const out = { 'Content-Type': type, 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', ...headers };
  const encoding = buffer.length > 1024 && /text|json|javascript|xml|svg/.test(type) ? pickEncoding(req) : null;
  if (encoding === 'br') buffer = zlib.brotliCompressSync(buffer, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
  if (encoding === 'gzip') buffer = zlib.gzipSync(buffer, { level: 6 });
  if (encoding) out['Content-Encoding'] = encoding;
  out['Content-Length'] = buffer.length;
  res.writeHead(status, out);
  res.end(req.method === 'HEAD' ? undefined : buffer);
}

const sendHtml = (req, res, status, markup, headers) => send(req, res, status, String(markup), 'text/html; charset=utf-8', headers);
const sendPage = (req, res, status, ctx, markup, headers) => sendHtml(req, res, status, markup, { ...pagePolicy(ctx), ...headers });
const sendJson = (req, res, status, data, type = 'application/json; charset=utf-8') => send(req, res, status, JSON.stringify(data), type);

function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-store', 'Content-Length': 0 });
  res.end();
}

// Streams an HTML page: the shell goes out immediately, results follow.
function openStream(req, res, extraHeaders = {}) {
  const encoding = pickEncoding(req);
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', 'X-Accel-Buffering': 'no', ...extraHeaders };
  let out = res;
  if (encoding === 'br') out = zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
  if (encoding === 'gzip') out = zlib.createGzip({ level: 6 });
  if (encoding) headers['Content-Encoding'] = encoding;
  res.writeHead(200, headers);
  if (out !== res) {
    out.on('error', () => res.destroy());
    out.pipe(res);
  }
  return {
    write: (chunk) => out.write(String(chunk)),
    flush: () => out !== res && out.flush(),
    end: (chunk) => {
      if (chunk) out.write(String(chunk));
      out.end();
    },
  };
}

async function readForm(req, limit = 16 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

// ---------- Static files ----------

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const staticFiles = new Map();
function loadStaticFile(file) {
  const body = fs.readFileSync(file);
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  const compressible = /text|javascript|svg|manifest/.test(type);
  return {
    body,
    type,
    etag: `"${createHash('sha1').update(body).digest('base64url').slice(0, 16)}"`,
    br: compressible ? zlib.brotliCompressSync(body) : null,
    gzip: compressible ? zlib.gzipSync(body, { level: 9 }) : null,
  };
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else staticFiles.set('/static/' + path.relative(PUBLIC_DIR, full).split(path.sep).join('/'), full);
  }
}
walk(PUBLIC_DIR);

const staticCache = new Map();
function getStatic(urlPath) {
  const file = staticFiles.get(urlPath);
  if (!file) return null;
  if (config.dev || !staticCache.has(urlPath)) staticCache.set(urlPath, loadStaticFile(file));
  return staticCache.get(urlPath);
}

const assetHash = () =>
  createHash('sha1')
    .update(getStatic('/static/css/cut.css')?.body || '')
    .update(getStatic('/static/js/cut.js')?.body || '')
    .digest('hex')
    .slice(0, 10);
let assetVersion = assetHash();

function serveStatic(req, res, urlPath) {
  const file = getStatic(urlPath);
  if (!file) return notFound(req, res);
  const headers = {
    'Content-Type': file.type,
    ETag: file.etag,
    'Cache-Control': config.dev ? 'no-cache' : 'public, max-age=31536000, immutable',
    Vary: 'Accept-Encoding',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  if (req.headers['if-none-match'] === file.etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const encoding = pickEncoding(req);
  const body = (encoding && file[encoding]) || file.body;
  if (body !== file.body) headers['Content-Encoding'] = encoding;
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ---------- Rate limiting (hashed, in memory, rotating salt) ----------

let limiterSalt = randomBytes(16);
let limiterDay = new Date().toISOString().slice(0, 10);
const buckets = new Map();

function clientId(req) {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== limiterDay) {
    limiterDay = day;
    limiterSalt = randomBytes(16);
    buckets.clear();
  }
  const forwarded = config.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return createHmac('sha256', limiterSalt).update(forwarded || req.socket.remoteAddress || '').digest('base64url').slice(0, 16);
}

function allow(req, kind) {
  if (!config.rateLimit.enabled) return true;
  const perMinute = kind === 'suggest' ? config.rateLimit.suggestPerMinute : config.rateLimit.searchPerMinute;
  const key = `${kind}:${clientId(req)}`;
  const now = Date.now();
  const bucket = buckets.get(key) || { tokens: perMinute, updated: now };
  bucket.tokens = Math.min(perMinute, bucket.tokens + ((now - bucket.updated) / 60_000) * perMinute);
  bucket.updated = now;
  buckets.set(key, bucket);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [key, bucket] of buckets) if (bucket.updated < cutoff) buckets.delete(key);
}, 60_000).unref();

// ---------- Context ----------

const normalizeQuery = (q) => String(q || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);

function baseContext(req) {
  const prefs = readPrefs(req.headers.cookie, WEB_ENGINE_IDS, TORRENT_SOURCE_IDS);
  return {
    prefs,
    fx: features(prefs),
    network: getNetworkSettings(),
    assetVersion: config.dev ? assetHash() : assetVersion,
    query: '',
    type: 'web',
    explicit: {},
    typeParams: {},
  };
}

function searchContext(req, url, form) {
  const ctx = baseContext(req);
  const get = (key) => (form?.get(key) ?? url.searchParams.get(key)) || '';
  const type = TYPES.includes(get('t')) ? get('t') : 'web';
  const explicit = {};
  if (REGIONS.some((r) => r.code === get('kl'))) explicit.kl = get('kl');
  if (SAFE_LEVELS.some((s) => s.id === get('kp'))) explicit.kp = get('kp');
  if (['d', 'w', 'm', 'y'].includes(get('df'))) explicit.df = get('df');

  const typeParams = {};
  const filters = {};
  const filterSet = type === 'images' ? IMAGE_FILTERS : type === 'videos' ? VIDEO_FILTERS : [];
  for (const f of filterSet) {
    const value = get(f.param);
    if (value && f.options.some(([id]) => id === value)) {
      typeParams[f.param] = value;
      filters[f.key] = value;
    }
  }
  let cat = 'all';
  const defaultSort = ctx.prefs.torrentSort;
  let sort = type === 'torrents' ? defaultSort : '';
  if (type === 'torrents') {
    if (CATEGORY_IDS.includes(get('cat')) && get('cat') !== 'all') cat = typeParams.cat = get('cat');
    if (SORT_IDS.includes(get('sort'))) sort = get('sort');
    if (sort !== defaultSort) typeParams.sort = sort;
  }
  if (type === 'news' && get('sort') === 'newest') sort = typeParams.sort = 'newest';

  const query = normalizeQuery(get('q'));
  return Object.assign(ctx, {
    type,
    query,
    page: Math.min(Math.max(parseInt(get('p'), 10) || 1, 1), 20),
    region: getRegion(explicit.kl || ctx.prefs.region),
    safe: explicit.kp || ctx.prefs.safe,
    time: explicit.df || '',
    explicit,
    typeParams,
    filters,
    cat,
    sort,
    defaultSort,
    terms: significantTokens(query),
    fragment: get('frag') === '1',
  });
}

// Every upstream request made while handling one search shares an isolation
// key (a fresh Tor circuit per search) and the visitor's privacy signals.
const upstreamScope = (prefs, fn) => runWithContext({ isolation: randomBytes(8).toString('hex'), gpc: prefs.gpc, dnt: prefs.dnt }, fn);

// Image and icon fetches carry the visitor's privacy signals too.
function withSignals(req, fn) {
  const prefs = readPrefs(req.headers.cookie, [], []);
  return runWithContext({ gpc: prefs.gpc, dnt: prefs.dnt }, fn);
}

// ---------- Suggestions ----------

const suggestCache = new TTLCache({ max: 3000, ttl: 30 * 60_000 });

export function getSuggestions(query, region) {
  return suggestCache.wrap(cacheKey('ac', query.toLowerCase(), region.code), async () => {
    const data = await fetchUpstream('https://duckduckgo.com/ac/?' + new URLSearchParams({ q: query, kl: region.code }), {
      timeout: 1500,
      as: 'json',
      headers: { Accept: 'application/json' },
    });
    return (Array.isArray(data) ? data : []).map((item) => item.phrase).filter(Boolean).slice(0, 8);
  });
}

async function handleSuggest(req, res, url) {
  const q = normalizeQuery(url.searchParams.get('q')).slice(0, 120);
  const list = url.searchParams.get('type') === 'list';
  if (!allow(req, 'suggest')) return sendJson(req, res, 429, list ? [q, []] : { q, suggestions: [] });
  const prefs = readPrefs(req.headers.cookie, [], []);
  let suggestions = [];
  let bangs = [];
  const bangMatch = q.match(/(?:^|\s)!(\S*)$/);
  if (prefs.suggest === 'off') return sendJson(req, res, 200, list ? [q, []] : { q, suggestions, bangs });
  if (bangMatch) bangs = suggestBangs(bangMatch[1]);
  else if (q && prefs.suggest === 'ddg') {
    suggestions = await runWithContext({ gpc: prefs.gpc, dnt: prefs.dnt }, () => getSuggestions(q, getRegion(prefs.region))).catch(() => []);
  }
  if (list) return sendJson(req, res, 200, [q, suggestions], 'application/x-suggestions+json; charset=utf-8');
  sendJson(req, res, 200, { q, suggestions, bangs });
}

// ---------- Search ----------

const STANDALONE_ANSWERS = new Set(['calc', 'units', 'currency', 'weather', 'clock', 'define', 'color', 'code', 'uuid', 'password', 'coin', 'dice', 'random', 'stopwatch', 'timer', 'lorem', 'timestamp']);

function runSearch(ctx) {
  return upstreamScope(ctx.prefs, async () => {
    prepareOnionSearch(ctx.network);
    const data = await searchFor(ctx);
    if (ctx.fx.favicons && ['web', 'news', 'videos'].includes(ctx.type)) warmFavicons(data.results.map((r) => hostname(r.url)));
    return data;
  });
}

async function searchFor(ctx) {
  if (ctx.type === 'torrents') return searchTorrents(ctx);
  if (ctx.type === 'onion') return searchOnion(ctx);
  if (ctx.type !== 'web') return searchMedia(ctx.type, ctx);
  const extras = ctx.page === 1 && !ctx.fragment;
  const started = Date.now();
  const pendingInfobox = extras && ctx.prefs.infobox ? getInfobox(ctx.query, ctx.region) : null;
  const pendingRelated = extras && ctx.prefs.related ? getSuggestions(ctx.query, ctx.region).catch(() => []) : [];
  const [web, answer] = await Promise.all([searchWeb(ctx), extras && ctx.prefs.instant ? getInstantAnswer(ctx).catch(() => null) : null]);
  // The infobox and related searches are extras: once the results are in they
  // get a short grace period instead of holding up the page. They still land
  // in their caches, so a repeat search shows them.
  const grace = graceFor(Date.now() - started);
  const [infobox, related] = await Promise.all([within(pendingInfobox, grace, null), within(pendingRelated, grace, [])]);
  const lower = ctx.query.toLowerCase();
  return {
    ...web,
    answer,
    infobox: answer && STANDALONE_ANSWERS.has(answer.type) ? null : infobox,
    related: related.filter((s) => s.toLowerCase() !== lower).slice(0, 8),
  };
}

async function handleSearch(req, res, url) {
  const form = req.method === 'POST' ? await readForm(req) : null;
  const ctx = searchContext(req, url, form);
  if (!ctx.query) return redirect(res, '/');

  const bang = resolveBang(ctx.query);
  if (bang?.redirect) return redirect(res, bang.redirect);
  if (bang?.type) {
    if (!bang.query) return redirect(res, '/');
    Object.assign(ctx, { type: bang.type, query: bang.query, terms: significantTokens(bang.query), typeParams: {}, filters: {}, cat: 'all', sort: bang.type === 'torrents' ? 'best' : '' });
  }
  if (!allow(req, 'search')) {
    return sendPage(req, res, 429, ctx, errorPage(ctx, { status: 429, title: 'Slow down a little', message: 'You’re searching faster than our upstream engines allow. Wait a few seconds and try again.' }), { 'Retry-After': '10' });
  }
  if (bang?.lucky) {
    const data = await upstreamScope(ctx.prefs, () => searchWeb({ ...ctx, query: bang.query, page: 1 }));
    const top = data.results.find((r) => !r.threat);
    if (top) return redirect(res, top.url);
    Object.assign(ctx, { query: bang.query, terms: significantTokens(bang.query) });
  }

  if (ctx.fragment) {
    const data = await runSearch(ctx);
    return sendJson(req, res, 200, { html: resultsFragment(ctx, data), next: data.hasMore ? searchUrl(ctx, { p: ctx.page + 1 }) : null });
  }

  const stream = openStream(req, res, pagePolicy(ctx));
  stream.write(searchShell(ctx));
  stream.flush();
  let data;
  try {
    data = await runSearch(ctx);
  } catch (err) {
    if (config.debug) console.error('[search]', err);
    data = { results: [], sources: [], ms: 0, counts: {}, total: 0, error: true };
  }
  stream.end(searchBody(ctx, data));
}

// ---------- Settings ----------

// Writes the preferences cookie — or deletes it when everything is default.
function setPrefsCookie(req, res, prefs) {
  const value = serializePrefs(prefs);
  const secure = isSecure(req) ? '; Secure' : '';
  if (!value) return res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly${secure}`);
  const maxAge = cookieMaxAge(prefs);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${value}; Path=/;${maxAge ? ` Max-Age=${maxAge};` : ''} SameSite=Lax; HttpOnly${secure}`);
}

const cookieText = (prefs) => decodeURIComponent(serializePrefs(prefs, { secrets: 'mask' })).split('&').filter(Boolean).join('\n');
const safeReturn = (value) => (typeof value === 'string' && /^\/(?![/\\])[^\s]*$/.test(value) ? value : '');
const wantsJson = (req) => String(req.headers.accept || '').includes('application/json');

// Cross-site request protection for settings. Browsers send Sec-Fetch-Site on
// every request, and pages can't forge it. (The Origin header isn't enough on
// its own: with Referrer-Policy: no-referrer, form posts send "Origin: null".)
function sameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin';
  const requestOrigin = req.headers.origin;
  return !requestOrigin || requestOrigin === origin(req);
}

function renderSettings(req, res, status, notice = {}, networkErrors = [], networkDraft = null) {
  const ctx = baseContext(req);
  const settings = networkDraft || getNetworkSettings();
  sendPage(
    req,
    res,
    status,
    ctx,
    settingsPage(ctx, {
      notice,
      returnTo: notice.returnTo || '',
      code: exportCode(ctx.prefs),
      cookie: cookieText(ctx.prefs),
      threats: threatListStatus(),
      network: {
        settings,
        description: describeNetwork(getNetworkSettings()),
        canManage: canManageNetwork(req),
        tokenAllowed: Boolean(process.env.CUT_ADMIN_TOKEN) && !networkFixed,
        fixed: networkFixed,
        errors: networkErrors,
      },
    }),
  );
}

async function handleSettings(req, res, url, pathname) {
  if (req.method !== 'POST') {
    const notice = Object.fromEntries(['saved', 'cleared', 'import', 'network'].map((k) => [k, url.searchParams.get(k)]));
    notice.returnTo = safeReturn(url.searchParams.get('return'));
    return renderSettings(req, res, 200, notice);
  }
  if (!sameOrigin(req)) {
    const ctx = baseContext(req);
    return sendPage(req, res, 403, ctx, errorPage(ctx, { status: 403, title: 'Not allowed', message: 'Settings can only be changed from Cut itself.' }));
  }
  const form = await readForm(req);
  const current = readPrefs(req.headers.cookie, WEB_ENGINE_IDS, TORRENT_SOURCE_IDS);

  if (pathname === '/settings') {
    const next = form.get('reset') === '1' ? keepSecrets(structuredClone(DEFAULT_PREFS), current) : mergePrefs(current, form, WEB_ENGINE_IDS, TORRENT_SOURCE_IDS);
    setPrefsCookie(req, res, next);
    if (wantsJson(req)) return sendJson(req, res, 200, { ok: true, theme: next.theme, cookie: cookieText(next), code: exportCode(next) });
    return redirect(res, safeReturn(form.get('return')) || '/settings?saved=1', 303);
  }
  if (pathname === '/settings/import') {
    const imported = importCode(form.get('code'), WEB_ENGINE_IDS, TORRENT_SOURCE_IDS);
    if (!imported) return redirect(res, '/settings?import=invalid#data', 303);
    setPrefsCookie(req, res, keepSecrets(imported, current));
    return redirect(res, '/settings?import=ok#data', 303);
  }
  if (pathname === '/settings/clear') {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly${isSecure(req) ? '; Secure' : ''}`);
    return redirect(res, '/settings?cleared=1#data', 303);
  }

  // Server-wide connection settings: only from the machine running Cut.
  if (!canManageNetwork(req, form)) {
    if (wantsJson(req)) return sendJson(req, res, 403, { ok: false, error: 'Connection settings can only be changed on the computer running Cut.' });
    return redirect(res, '/settings?network=denied#connection', 303);
  }
  if (pathname === '/settings/network/test') return sendJson(req, res, 200, await testConnection());
  const { settings, errors } = validateNetwork(form, getNetworkSettings());
  if (errors.length) {
    if (wantsJson(req)) return sendJson(req, res, 400, { ok: false, errors });
    return renderSettings(req, res, 400, {}, errors, settings);
  }
  const saved = saveNetworkSettings(settings);
  if (wantsJson(req)) return sendJson(req, res, 200, { ok: true, saved, description: describeNetwork(settings) });
  return redirect(res, `/settings?network=${saved ? 'saved' : 'unsaved'}#connection`, 303);
}

// ---------- Misc routes ----------

function handleOpenSearch(req, res) {
  const base = origin(req);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/" xmlns:moz="http://www.mozilla.org/2006/browser/search/">
  <ShortName>Cut Search</ShortName>
  <Description>Private search for the web and torrents</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Image width="32" height="32" type="image/x-icon">${base}/favicon.ico</Image>
  <Url type="text/html" method="get" template="${base}/search?q={searchTerms}"/>
  <Url type="application/x-suggestions+json" method="get" template="${base}/ac?type=list&amp;q={searchTerms}"/>
  <Url type="application/opensearchdescription+xml" rel="self" template="${base}/opensearch.xml"/>
  <moz:SearchForm>${base}/</moz:SearchForm>
</OpenSearchDescription>`;
  send(req, res, 200, xml, 'application/opensearchdescription+xml; charset=utf-8', { 'Cache-Control': 'public, max-age=86400' });
}

const ROBOTS = 'User-agent: *\nDisallow: /search\nDisallow: /ac\nDisallow: /img\nDisallow: /fav/\nAllow: /\n';

function notFound(req, res) {
  const ctx = baseContext(req);
  sendPage(req, res, 404, ctx, errorPage(ctx, { status: 404, title: 'Nothing here', message: 'That page doesn’t exist. Maybe search for it instead?' }));
}

const POST_ROUTES = new Set(['/search', '/settings', '/settings/import', '/settings/clear', '/settings/network', '/settings/network/test']);
const page = (req, res, view) => {
  const ctx = baseContext(req);
  sendPage(req, res, 200, ctx, view(ctx));
};

// Dangerous-site lists are on by default; fetch them shortly after start-up.
setTimeout(() => ensureThreatLists(), 3000).unref();

// ---------- Router ----------

export async function handle(req, res) {
  securityHeaders(req, res);
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return send(req, res, 400, 'Bad request', 'text/plain; charset=utf-8');
  }
  const { pathname } = url;
  try {
    if (!['GET', 'HEAD', 'POST'].includes(req.method)) return send(req, res, 405, 'Method not allowed', 'text/plain; charset=utf-8', { Allow: 'GET, HEAD, POST' });
    if (req.method === 'POST' && !POST_ROUTES.has(pathname)) return send(req, res, 405, 'Method not allowed', 'text/plain; charset=utf-8');

    if (pathname.startsWith('/static/')) return serveStatic(req, res, pathname);
    if (pathname.startsWith('/fav/')) return await withSignals(req, () => handleFavicon(req, res, pathname.slice(5)));
    if (pathname.startsWith('/settings/') && POST_ROUTES.has(pathname)) {
      return req.method === 'POST' ? await handleSettings(req, res, url, pathname) : redirect(res, '/settings');
    }
    switch (pathname) {
      case '/':
        if (url.searchParams.get('q')) return await handleSearch(req, res, url);
        return page(req, res, homePage);
      case '/search':
      case '/html':
        return await handleSearch(req, res, url);
      case '/ac':
        return await handleSuggest(req, res, url);
      case '/img':
        return await withSignals(req, () => handleImageProxy(req, res, url));
      case '/settings':
        return await handleSettings(req, res, url, pathname);
      case '/privacy':
        return page(req, res, privacyPage);
      case '/bangs':
        return page(req, res, bangsPage);
      case '/opensearch.xml':
        return handleOpenSearch(req, res);
      case '/robots.txt':
        return send(req, res, 200, ROBOTS, 'text/plain; charset=utf-8', { 'Cache-Control': 'public, max-age=86400' });
      case '/favicon.ico':
        return serveStatic(req, res, '/static/img/favicon.ico');
      case '/site.webmanifest':
        return serveStatic(req, res, '/static/site.webmanifest');
      case '/healthz':
        return send(req, res, 200, 'ok', 'text/plain; charset=utf-8', { 'X-Cut-Search': '1' });
      default:
        return notFound(req, res);
    }
  } catch (err) {
    // Never log request details — only what broke.
    console.error(`[cut] ${err?.name || 'Error'}: ${err?.message || err}`);
    if (config.debug) console.error(err?.stack);
    if (res.headersSent) return res.end();
    const status = err?.status === 413 ? 413 : 500;
    const ctx = baseContext(req);
    sendPage(req, res, status, ctx, errorPage(ctx, { status, title: 'Something went wrong', message: 'Cut hit an unexpected error. Nothing about your search was stored.' }));
  }
}

export const refreshAssets = () => {
  staticCache.clear();
  assetVersion = assetHash();
};
