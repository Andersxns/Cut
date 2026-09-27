import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns/promises';

// Minimal SOCKS4/4a/5 client (RFC 1928 + RFC 1929 username/password auth).
// With remote DNS the proxy resolves host names, so lookups never leak
// outside the tunnel — essential for Tor. Tor also treats each distinct
// username/password as a separate circuit ("IsolateSOCKSAuth").

const SOCKS5_ERRORS = {
  1: 'general SOCKS server failure',
  2: 'connection not allowed by ruleset',
  3: 'network unreachable',
  4: 'host unreachable',
  5: 'connection refused by destination',
  6: 'TTL expired',
  7: 'command not supported',
  8: 'address type not supported',
};

export class ProxyError extends Error {
  constructor(message) {
    super(message);
    this.code = 'EPROXY';
  }
}

// Reads exact byte counts from a socket during the handshake.
function byteReader(socket) {
  let buffer = Buffer.alloc(0);
  let waiting = null;
  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    flush();
  };
  const onEnd = () => waiting?.reject(new ProxyError('the proxy closed the connection'));
  const onError = (err) => waiting?.reject(err);
  function flush() {
    if (waiting && buffer.length >= waiting.n) {
      const out = buffer.subarray(0, waiting.n);
      buffer = buffer.subarray(waiting.n);
      const { resolve } = waiting;
      waiting = null;
      resolve(out);
    }
  }
  socket.on('data', onData);
  socket.on('end', onEnd);
  socket.on('error', onError);
  return {
    read(n) {
      return new Promise((resolve, reject) => {
        waiting = { n, resolve, reject };
        flush();
      });
    },
    release() {
      socket.off('data', onData);
      socket.off('end', onEnd);
      socket.off('error', onError);
      if (buffer.length) socket.unshift(buffer);
    },
  };
}

function ipv6Bytes(address) {
  const [head, tail = ''] = address.split('::');
  const parts = (s) => (s ? s.split(':') : []);
  const h = parts(head);
  const t = parts(tail);
  const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  const bytes = Buffer.alloc(16);
  groups.forEach((g, i) => bytes.writeUInt16BE(parseInt(g, 16) || 0, i * 2));
  return bytes;
}

async function resolveIPv4(host) {
  if (net.isIPv4(host)) return host;
  const { address } = await dns.lookup(host, { family: 4 });
  return address;
}

// Opens a TCP tunnel to targetHost:targetPort through the SOCKS proxy.
export async function socksConnect({ proxyHost, proxyPort, version = 5, username = '', password = '', remoteDns = true, targetHost, targetPort, timeout = 20000 }) {
  const socket = net.connect({ host: proxyHost, port: proxyPort });
  socket.setNoDelay(true);
  socket.setTimeout(timeout, () => socket.destroy(new ProxyError('the proxy timed out')));
  try {
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', (err) => reject(new ProxyError(`couldn’t connect to the proxy at ${proxyHost}:${proxyPort} (${err.code || err.message})`)));
    });
    const reader = byteReader(socket);
    const host = String(targetHost).replace(/^\[|\]$/g, '');
    if (version === 5) {
      const methods = username || password ? [0x02] : [0x00];
      socket.write(Buffer.from([0x05, methods.length, ...methods]));
      const [ver, method] = await reader.read(2);
      if (ver !== 0x05) throw new ProxyError('that isn’t a SOCKS5 proxy');
      if (method === 0xff) throw new ProxyError('the proxy rejected the authentication method');
      if (method === 0x02) {
        const u = Buffer.from(username);
        const p = Buffer.from(password);
        socket.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]));
        const [, status] = await reader.read(2);
        if (status !== 0x00) throw new ProxyError('the proxy rejected the username or password');
      }
      let address;
      if (net.isIPv4(host)) address = Buffer.from([0x01, ...host.split('.').map(Number)]);
      else if (net.isIPv6(host)) address = Buffer.concat([Buffer.from([0x04]), ipv6Bytes(host)]);
      else if (remoteDns) {
        const name = Buffer.from(host);
        address = Buffer.concat([Buffer.from([0x03, name.length]), name]);
      } else address = Buffer.from([0x01, ...(await resolveIPv4(host)).split('.').map(Number)]);
      socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), address, Buffer.from([targetPort >> 8, targetPort & 0xff])]));
      const head = await reader.read(4);
      if (head[1] !== 0x00) throw new ProxyError(`the proxy couldn’t reach ${host}: ${SOCKS5_ERRORS[head[1]] || 'unknown error'}`);
      if (head[3] === 0x01) await reader.read(6);
      else if (head[3] === 0x04) await reader.read(18);
      else if (head[3] === 0x03) await reader.read((await reader.read(1))[0] + 2);
    } else {
      // SOCKS4, or SOCKS4a when the proxy should resolve the name.
      const useName = !net.isIPv4(host) && remoteDns;
      const ip = useName ? [0, 0, 0, 1] : (await resolveIPv4(host)).split('.').map(Number);
      const parts = [Buffer.from([0x04, 0x01, targetPort >> 8, targetPort & 0xff, ...ip]), Buffer.from(username), Buffer.from([0])];
      if (useName) parts.push(Buffer.from(host), Buffer.from([0]));
      socket.write(Buffer.concat(parts));
      const reply = await reader.read(8);
      if (reply[1] !== 0x5a) throw new ProxyError(`the SOCKS4 proxy refused the connection to ${host}`);
    }
    reader.release();
    socket.setTimeout(0);
    return socket;
  } catch (err) {
    socket.destroy();
    throw err instanceof ProxyError ? err : new ProxyError(err.message);
  }
}

// An undici `connect` function that tunnels through SOCKS and adds TLS for https.
export function socksConnector(config) {
  return (options, callback) => {
    let settled = false;
    const done = (err, socket) => {
      if (settled) return;
      settled = true;
      callback(err, socket);
    };
    const secure = options.protocol === 'https:';
    const port = Number(options.port) || (secure ? 443 : 80);
    socksConnect({ ...config, targetHost: options.hostname, targetPort: port })
      .then((socket) => {
        if (!secure) return done(null, socket);
        const name = options.servername || options.hostname;
        const tlsSocket = tls.connect({ socket, servername: net.isIP(name) ? undefined : name, ALPNProtocols: ['http/1.1'] });
        tlsSocket.once('secureConnect', () => done(null, tlsSocket));
        tlsSocket.once('error', (err) => done(err));
      })
      .catch((err) => done(err));
  };
}
