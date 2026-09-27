import { randomBytes } from 'node:crypto';
import { Agent, ProxyAgent, EnvHttpProxyAgent, fetch } from 'undici';
import { getNetworkSettings, networkVersion, onNetworkChange, DOH_PROVIDERS, userAgentString } from './settings.js';
import { socksConnector } from './socks.js';
import { dohLookup } from './doh.js';
import { currentContext } from './context.js';

// Picks the undici dispatcher for each upstream request according to the
// server's network settings. Tor gets one SOCKS "identity" per isolation key,
// which makes Tor build a separate circuit for it.

let built = { version: -1 };
const isolated = new Map();
const MAX_ISOLATED = 24;
let sessionKey = randomBytes(8).toString('hex');
let sessionStarted = Date.now();

function closeAll() {
  for (const agent of [built.direct, built.system, built.proxy, ...isolated.values()]) agent?.close().catch(() => {});
  isolated.clear();
  built = { version: -1 };
}
onNetworkChange(closeAll);

function build() {
  const s = getNetworkSettings();
  closeAll();
  const lookup = s.doh !== 'off' ? dohLookup(s.dohProvider === 'custom' ? s.dohUrl : DOH_PROVIDERS[s.dohProvider].url, s.doh === 'strict') : undefined;
  built = { version: networkVersion(), direct: new Agent(lookup ? { connect: { lookup } } : {}) };
  if (s.mode === 'system') built.system = new EnvHttpProxyAgent();
  if (s.mode === 'manual' && (s.proxyType === 'http' || s.proxyType === 'https')) {
    const token = s.proxyUser ? `Basic ${Buffer.from(`${s.proxyUser}:${s.proxyPass}`).toString('base64')}` : undefined;
    built.proxy = new ProxyAgent({ uri: `${s.proxyType}://${s.proxyHost.includes(':') ? `[${s.proxyHost}]` : s.proxyHost}:${s.proxyPort}`, token });
  }
  if (s.mode === 'manual' && s.proxyType.startsWith('socks')) {
    built.proxy = new Agent({
      connect: socksConnector({ proxyHost: s.proxyHost, proxyPort: s.proxyPort, version: s.proxyType === 'socks4' ? 4 : 5, username: s.proxyUser, password: s.proxyPass, remoteDns: s.remoteDns }),
    });
  }
  return built;
}

function bypassed(hostname, list) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return list
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/^\*\./, '.'))
    .filter(Boolean)
    .some((entry) => (entry.startsWith('.') ? host.endsWith(entry) || host === entry.slice(1) : host === entry));
}

function torAgent(key) {
  const s = getNetworkSettings();
  let agent = isolated.get(key);
  if (agent) {
    isolated.delete(key);
    isolated.set(key, agent);
    return agent;
  }
  // Tor isolates streams by SOCKS credentials, so each key gets its own circuit.
  agent = new Agent({
    connect: socksConnector({ proxyHost: s.torHost, proxyPort: s.torPort, version: 5, username: `cut-${key}`, password: key, remoteDns: true }),
    keepAliveTimeout: 20_000,
  });
  isolated.set(key, agent);
  while (isolated.size > MAX_ISOLATED) {
    const [oldest, oldAgent] = isolated.entries().next().value;
    isolated.delete(oldest);
    oldAgent.close().catch(() => {});
  }
  return agent;
}

function isolationKey() {
  const s = getNetworkSettings();
  if (Date.now() - sessionStarted > 10 * 60_000) {
    sessionKey = randomBytes(8).toString('hex');
    sessionStarted = Date.now();
  }
  if (s.isolation === 'none') return 'shared';
  if (s.isolation === 'session') return sessionKey;
  return currentContext().isolation || sessionKey;
}

export function dispatcherFor(url) {
  const s = getNetworkSettings();
  if (built.version !== networkVersion()) build();
  if (s.mode === 'direct' || bypassed(url.hostname, s.bypass)) return built.direct;
  if (s.mode === 'system') return built.system;
  if (s.mode === 'tor') return torAgent(isolationKey());
  return built.proxy || built.direct;
}

// Fetches Tor Project's check endpoint through the current settings and
// reports the exit address. Used by the "Test connection" button.
export async function testConnection() {
  const started = Date.now();
  const url = new URL('https://check.torproject.org/api/ip');
  try {
    const response = await fetch(url, {
      dispatcher: dispatcherFor(url),
      headers: { 'User-Agent': userAgentString(), Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json();
    return { ok: true, tor: Boolean(data.IsTor), ip: String(data.IP || ''), ms: Date.now() - started };
  } catch (err) {
    const reason = err?.cause?.message || err?.message || 'unknown error';
    return { ok: false, error: reason.replace(/^fetch failed$/, 'the request failed'), ms: Date.now() - started };
  }
}
