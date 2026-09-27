import net from 'node:net';
import dns from 'node:dns';
import { Agent, fetch } from 'undici';

// DNS over HTTPS (RFC 8484, wire format) for Cut's direct connections, so the
// local network and ISP can't see which engines Cut is talking to.

const resolverAgent = new Agent({ keepAliveTimeout: 30_000 });
const cache = new Map();
const MIN_TTL = 30;
const MAX_TTL = 3600;

export function encodeQuery(name, type) {
  const parts = [Buffer.from([0x00, 0x00, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])];
  for (const label of name.replace(/\.$/, '').split('.')) {
    const bytes = Buffer.from(label, 'ascii');
    if (!bytes.length || bytes.length > 63) throw new Error(`invalid DNS name: ${name}`);
    parts.push(Buffer.from([bytes.length]), bytes);
  }
  parts.push(Buffer.from([0x00, 0x00, type, 0x00, 0x01]));
  return Buffer.concat(parts);
}

function formatIPv6(bytes) {
  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push(bytes.readUInt16BE(i).toString(16));
  return groups.join(':');
}

export function decodeResponse(message) {
  const buf = Buffer.from(message);
  const rcode = buf[3] & 0x0f;
  if (rcode === 3) return [];
  if (rcode !== 0) throw new Error(`DNS error code ${rcode}`);
  let offset = 12;
  const skipName = () => {
    for (;;) {
      const length = buf[offset];
      if (length === 0) return void (offset += 1);
      if ((length & 0xc0) === 0xc0) return void (offset += 2);
      offset += length + 1;
    }
  };
  const questions = buf.readUInt16BE(4);
  const answers = buf.readUInt16BE(6);
  for (let i = 0; i < questions; i++) {
    skipName();
    offset += 4;
  }
  const records = [];
  for (let i = 0; i < answers; i++) {
    skipName();
    const type = buf.readUInt16BE(offset);
    const ttl = buf.readUInt32BE(offset + 4);
    const length = buf.readUInt16BE(offset + 8);
    offset += 10;
    if (type === 1 && length === 4) records.push({ address: [...buf.subarray(offset, offset + 4)].join('.'), family: 4, ttl });
    if (type === 28 && length === 16) records.push({ address: formatIPv6(buf.subarray(offset, offset + 16)), family: 6, ttl });
    offset += length;
  }
  return records;
}

async function query(endpoint, name, type) {
  const url = `${endpoint}?dns=${encodeQuery(name, type).toString('base64url')}`;
  const response = await fetch(url, {
    headers: { accept: 'application/dns-message' },
    dispatcher: resolverAgent,
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error(`DoH server returned HTTP ${response.status}`);
  return decodeResponse(await response.arrayBuffer());
}

export async function resolveOverHttps(endpoint, name) {
  const key = `${endpoint} ${name}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.records;
  const settled = await Promise.allSettled([query(endpoint, name, 1), query(endpoint, name, 28)]);
  const records = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (!records.length) {
    const failure = settled.find((r) => r.status === 'rejected');
    throw failure ? failure.reason : Object.assign(new Error(`no DNS records for ${name}`), { code: 'ENOTFOUND' });
  }
  const ttl = Math.min(MAX_TTL, Math.max(MIN_TTL, Math.min(...records.map((r) => r.ttl))));
  cache.set(key, { records, expires: Date.now() + ttl * 1000 });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return records;
}

// A `lookup` function for net/tls sockets. `strict` never falls back to the
// operating system's resolver.
export function dohLookup(endpoint, strict) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    const family = net.isIP(hostname);
    if (family) return options.all ? callback(null, [{ address: hostname, family }]) : callback(null, hostname, family);
    resolveOverHttps(endpoint, hostname)
      .then((records) => {
        let list = records.filter((r) => !options.family || r.family === options.family);
        list = [...list.filter((r) => r.family === 4), ...list.filter((r) => r.family === 6)];
        if (!list.length) throw Object.assign(new Error(`no address for ${hostname}`), { code: 'ENOTFOUND' });
        if (options.all) callback(null, list.map(({ address, family: f }) => ({ address, family: f })));
        else callback(null, list[0].address, list[0].family);
      })
      .catch((err) => {
        if (!strict) return dns.lookup(hostname, options, callback);
        callback(Object.assign(new Error(`DNS over HTTPS failed for ${hostname}: ${err.message}`), { code: 'ENOTFOUND' }));
      });
  };
}
