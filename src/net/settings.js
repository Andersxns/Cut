import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// How Cut's server reaches search engines: directly, through a proxy, or over
// Tor, plus DNS-over-HTTPS and the identity it presents. These settings are
// for the whole server, so they live in data/network.json and can only be
// changed from the computer running Cut (or with CUT_ADMIN_TOKEN).

// CUT_DATA_DIR moves it elsewhere, e.g. into Cut Browser's profile.
const FILE = path.join(process.env.CUT_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data'), 'network.json');

export const USER_AGENTS = {
  firefox: { name: 'Firefox on Windows', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0' },
  chrome: { name: 'Chrome on Windows', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' },
  safari: { name: 'Safari on macOS', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15' },
  tor: { name: 'Tor Browser', value: 'Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0' },
  custom: { name: 'Custom', value: '' },
};

export const DOH_PROVIDERS = {
  cloudflare: { name: 'Cloudflare', url: 'https://1.1.1.1/dns-query' },
  quad9: { name: 'Quad9', url: 'https://9.9.9.9/dns-query' },
  mullvad: { name: 'Mullvad', url: 'https://dns.mullvad.net/dns-query' },
  adguard: { name: 'AdGuard', url: 'https://dns.adguard-dns.com/dns-query' },
  nextdns: { name: 'NextDNS', url: 'https://dns.nextdns.io/dns-query' },
  google: { name: 'Google', url: 'https://8.8.8.8/dns-query' },
  custom: { name: 'Custom', url: '' },
};

export const NETWORK_DEFAULTS = Object.freeze({
  mode: 'direct', // direct | system | manual | tor
  proxyType: 'socks5', // http | https | socks4 | socks5
  proxyHost: '',
  proxyPort: 1080,
  proxyUser: '',
  proxyPass: '',
  remoteDns: true,
  torHost: '127.0.0.1',
  torPort: 9050,
  isolation: 'search', // search | session | none
  bypass: 'localhost, 127.0.0.1, ::1',
  doh: 'off', // off | fallback | strict
  dohProvider: 'cloudflare',
  dohUrl: '',
  userAgent: 'firefox',
  customUserAgent: '',
  timeout: 'auto', // auto | 3 | 5 | 8 | 12 | 20
});

const ENUMS = {
  mode: ['direct', 'system', 'manual', 'tor'],
  proxyType: ['http', 'https', 'socks4', 'socks5'],
  isolation: ['search', 'session', 'none'],
  doh: ['off', 'fallback', 'strict'],
  dohProvider: Object.keys(DOH_PROVIDERS),
  userAgent: Object.keys(USER_AGENTS),
  timeout: ['auto', '3', '5', '8', '12', '20'],
};

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const validHost = (v) => HOST_RE.test(v) || net.isIP(v) !== 0;
const validPort = (v) => Number.isInteger(v) && v > 0 && v < 65536;
const printable = (v, max) => typeof v === 'string' && v.length <= max && /^[\x20-\x7e]*$/.test(v);

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

// Validates raw values (from a form or file). Returns { settings, errors }.
export function validateNetwork(input, base = NETWORK_DEFAULTS) {
  const out = { ...base };
  const errors = [];
  const get = (k) => (input instanceof URLSearchParams ? input.get(k) : input[k]);
  for (const [key, allowed] of Object.entries(ENUMS)) {
    const value = get(key);
    if (value === undefined || value === null) continue;
    if (allowed.includes(String(value))) out[key] = String(value);
    else errors.push(`Unknown value for ${key}.`);
  }
  for (const key of ['proxyHost', 'torHost']) {
    const value = get(key);
    if (value === undefined || value === null) continue;
    const trimmed = String(value).trim().replace(/^\[|\]$/g, '');
    if (trimmed === '' || validHost(trimmed)) out[key] = trimmed;
    else errors.push(`“${trimmed}” isn’t a valid host name or IP address.`);
  }
  for (const key of ['proxyPort', 'torPort']) {
    const value = get(key);
    if (value === undefined || value === null || value === '') continue;
    const n = Number(value);
    if (validPort(n)) out[key] = n;
    else errors.push('Ports must be between 1 and 65535.');
  }
  for (const [key, max] of [['proxyUser', 255], ['proxyPass', 255], ['customUserAgent', 400], ['bypass', 600]]) {
    const value = get(key);
    if (value === undefined || value === null) continue;
    if (printable(String(value), max)) out[key] = String(value).trim();
    else errors.push(`${key === 'customUserAgent' ? 'The user agent' : key === 'bypass' ? 'The “No proxy for” list' : 'Proxy credentials'} must be plain text.`);
  }
  const remoteDns = get('remoteDns');
  if (remoteDns !== undefined && remoteDns !== null) out.remoteDns = remoteDns === true || remoteDns === '1' || remoteDns === 'on';
  else if (input instanceof URLSearchParams && input.get('_full') === '1') out.remoteDns = false;
  const dohUrl = get('dohUrl');
  if (dohUrl !== undefined && dohUrl !== null) {
    if (dohUrl === '') out.dohUrl = '';
    else if (httpsUrl(dohUrl)) out.dohUrl = httpsUrl(dohUrl);
    else errors.push('The DNS-over-HTTPS address must start with https://.');
  }
  if (out.mode === 'manual' && !out.proxyHost) errors.push('Enter the proxy’s host name or IP address.');
  if (out.doh !== 'off' && out.dohProvider === 'custom' && !out.dohUrl) errors.push('Enter a DNS-over-HTTPS address, or pick a provider.');
  if (out.userAgent === 'custom' && !out.customUserAgent) errors.push('Enter a custom user agent, or pick a preset.');
  return { settings: out, errors };
}

// CUT_NETWORK_FIXED=1: the connection comes from the environment alone and
// can't be changed from the settings page. Cut Browser's Tor windows run
// their own Cut Search this way, so their searches always go through Tor.
export const networkFixed = /^(1|true|yes)$/i.test(process.env.CUT_NETWORK_FIXED || '');

// Seeds from environment variables, e.g. CUT_PROXY=socks5h://127.0.0.1:9050
// or CUT_TOR=1 (Tor on 127.0.0.1:9050) or CUT_TOR=127.0.0.1:9150.
export function fromEnvironment(env = process.env) {
  const seed = {};
  const proxy = env.CUT_PROXY;
  if (proxy) {
    try {
      const url = new URL(proxy);
      const type = { 'http:': 'http', 'https:': 'https', 'socks4:': 'socks4', 'socks4a:': 'socks4', 'socks5:': 'socks5', 'socks5h:': 'socks5', 'socks:': 'socks5' }[url.protocol];
      if (type) {
        Object.assign(seed, {
          mode: 'manual',
          proxyType: type,
          proxyHost: url.hostname.replace(/^\[|\]$/g, ''),
          proxyPort: Number(url.port) || (type === 'http' ? 8080 : type === 'https' ? 443 : 1080),
          proxyUser: decodeURIComponent(url.username),
          proxyPass: decodeURIComponent(url.password),
          remoteDns: url.protocol !== 'socks5:' && url.protocol !== 'socks4:',
        });
      }
    } catch {
      console.warn('[cut] Ignoring CUT_PROXY: not a valid proxy URL');
    }
  }
  const tor = (env.CUT_TOR || '').trim();
  const torAddress = tor.match(/^\[?([^\]]+?)\]?:(\d{1,5})$/);
  if (/^(1|true|yes)$/i.test(tor)) seed.mode = 'tor';
  else if (torAddress && validHost(torAddress[1]) && validPort(Number(torAddress[2]))) Object.assign(seed, { mode: 'tor', torHost: torAddress[1], torPort: Number(torAddress[2]) });
  else if (tor && !/^(0|false|no)$/i.test(tor)) console.warn('[cut] Ignoring CUT_TOR: use 1, or the address of Tor’s SOCKS port (host:port)');
  if (env.CUT_USER_AGENT && printable(env.CUT_USER_AGENT, 400)) Object.assign(seed, { userAgent: 'custom', customUserAgent: env.CUT_USER_AGENT });
  if (env.CUT_DOH) {
    const provider = env.CUT_DOH.toLowerCase();
    if (provider === 'off') seed.doh = 'off';
    else if (DOH_PROVIDERS[provider]) Object.assign(seed, { doh: 'fallback', dohProvider: provider });
    else if (httpsUrl(env.CUT_DOH)) Object.assign(seed, { doh: 'fallback', dohProvider: 'custom', dohUrl: httpsUrl(env.CUT_DOH) });
  }
  return seed;
}

let settings = { ...NETWORK_DEFAULTS };
let version = 0;
const listeners = new Set();

function load() {
  let stored = {};
  try {
    if (!networkFixed) stored = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[cut] Couldn't read ${FILE}: ${err.message}`);
  }
  // A fixed Tor connection sends everything to Tor, local addresses included
  // (Tor refuses those), rather than letting some requests go around it.
  const fixed = networkFixed && fromEnvironment().mode === 'tor' ? { bypass: '' } : {};
  const { settings: valid } = validateNetwork({ ...stored, ...fromEnvironment(), ...fixed });
  settings = valid;
  version++;
}
load();

export const getNetworkSettings = () => settings;
export const networkVersion = () => version;
export const onNetworkChange = (fn) => listeners.add(fn);

// Applies the settings at once, then saves them. Returns false when they
// couldn't be written (e.g. a read-only disk), so they last until restart.
export function saveNetworkSettings(next) {
  if (networkFixed) return false;
  settings = { ...next };
  version++;
  for (const fn of listeners) fn(settings);
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
    return true;
  } catch (err) {
    console.warn(`[cut] Couldn't save ${FILE}: ${err.code || err.message}`);
    return false;
  }
}

export const userAgentString = (s = settings) => (s.userAgent === 'custom' && s.customUserAgent ? s.customUserAgent : USER_AGENTS[s.userAgent]?.value || USER_AGENTS.firefox.value);

export const usesProxy = (s = settings) => s.mode !== 'direct';

// Engines get more time when traffic goes through Tor or a proxy.
export function timeoutFactor(s = settings) {
  if (s.timeout !== 'auto') return null;
  return s.mode === 'tor' ? 3 : s.mode === 'direct' ? 1 : 1.6;
}
export const fixedTimeout = (s = settings) => (s.timeout === 'auto' ? null : Number(s.timeout) * 1000);

export function describeNetwork(s = settings) {
  const dns = s.doh === 'off' ? '' : ` · DNS over HTTPS (${DOH_PROVIDERS[s.dohProvider]?.name || 'custom'})`;
  if (s.mode === 'tor') return `Tor via ${s.torHost}:${s.torPort}${dns}`;
  if (s.mode === 'manual') return `${s.proxyType.toUpperCase()} proxy ${s.proxyHost}:${s.proxyPort}${dns}`;
  if (s.mode === 'system') return `System proxy settings${dns}`;
  return `Direct connection${dns}`;
}

// Only the machine running Cut may change server-wide network settings, unless
// the operator set CUT_ADMIN_TOKEN and the request carries it.
export function canManageNetwork(req, form) {
  if (networkFixed) return false;
  const token = process.env.CUT_ADMIN_TOKEN;
  const given = form?.get('admin_token');
  if (token && given) {
    const a = Buffer.from(token);
    const b = Buffer.from(given);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  const address = req.socket.remoteAddress || '';
  const loopback = address === '127.0.0.1' || address === '::1' || address.startsWith('::ffff:127.');
  const proxied = req.headers['x-forwarded-for'] || req.headers.forwarded || req.headers['x-real-ip'];
  // A loopback connection with a foreign Host header is a DNS-rebinding page.
  const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  const localHost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
  return loopback && !proxied && localHost;
}
