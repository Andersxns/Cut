import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { Agent, fetch } from 'undici';

import { socksConnect, socksConnector } from '../src/net/socks.js';
import { encodeQuery, decodeResponse } from '../src/net/doh.js';
import { validateNetwork, NETWORK_DEFAULTS } from '../src/net/settings.js';

// A tiny SOCKS5 server (RFC 1928/1929) that records what clients ask for.
function socksServer({ requireAuth = false } = {}) {
  const seen = [];
  const server = net.createServer((client) => {
    client.once('data', (greeting) => {
      const methods = [...greeting.subarray(2)];
      if (requireAuth && !methods.includes(0x02)) return client.end(Buffer.from([5, 0xff]));
      const auth = methods.includes(0x02);
      client.write(Buffer.from([5, auth ? 0x02 : 0x00]));
      const connectStage = () =>
        client.once('data', (req) => {
          const atyp = req[3];
          let host;
          let offset;
          if (atyp === 3) {
            host = req.subarray(5, 5 + req[4]).toString();
            offset = 5 + req[4];
          } else {
            host = [...req.subarray(4, 8)].join('.');
            offset = 8;
          }
          const port = req.readUInt16BE(offset);
          seen.push({ host, port, atyp, user: client.user });
          const upstream = net.connect({ host: host === 'test.invalid' ? '127.0.0.1' : host, port }, () => {
            client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
            client.pipe(upstream).pipe(client);
          });
          upstream.on('error', () => client.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])));
        });
      if (!auth) return connectStage();
      client.once('data', (creds) => {
        const ulen = creds[1];
        client.user = creds.subarray(2, 2 + ulen).toString();
        client.write(Buffer.from([1, 0]));
        connectStage();
      });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}

function httpServer() {
  const server = http.createServer((req, res) => res.end(`hello from ${req.url}`));
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

test('SOCKS5 tunnels with remote DNS and username/password auth', async () => {
  const socks = await socksServer({ requireAuth: true });
  const target = await httpServer();
  try {
    const socket = await socksConnect({ proxyHost: '127.0.0.1', proxyPort: socks.port, username: 'cut-abc', password: 'abc', remoteDns: true, targetHost: 'test.invalid', targetPort: target.port });
    const reply = await new Promise((resolve) => {
      socket.once('data', (d) => resolve(d.toString()));
      socket.write('GET /direct HTTP/1.1\r\nHost: test.invalid\r\nConnection: close\r\n\r\n');
    });
    socket.destroy();
    assert.match(reply, /hello from \/direct/);
    assert.deepEqual(socks.seen[0], { host: 'test.invalid', port: target.port, atyp: 3, user: 'cut-abc' }, 'host name is resolved by the proxy');
  } finally {
    socks.server.close();
    target.server.close();
  }
});

test('undici fetch works through the SOCKS connector', async () => {
  const socks = await socksServer();
  const target = await httpServer();
  const agent = new Agent({ connect: socksConnector({ proxyHost: '127.0.0.1', proxyPort: socks.port, remoteDns: true }) });
  try {
    const response = await fetch(`http://test.invalid:${target.port}/through-proxy`, { dispatcher: agent });
    assert.equal(await response.text(), 'hello from /through-proxy');
    assert.equal(socks.seen.length, 1);
  } finally {
    await agent.close();
    socks.server.close();
    target.server.close();
  }
});

test('a proxy that refuses auth produces a clear error', async () => {
  const socks = await socksServer({ requireAuth: true });
  try {
    await assert.rejects(
      socksConnect({ proxyHost: '127.0.0.1', proxyPort: socks.port, targetHost: 'example.com', targetPort: 80 }),
      /rejected the authentication method/,
    );
    await assert.rejects(socksConnect({ proxyHost: '127.0.0.1', proxyPort: 1, targetHost: 'example.com', targetPort: 80, timeout: 2000 }), /couldn’t connect to the proxy/);
  } finally {
    socks.server.close();
  }
});

test('DNS-over-HTTPS messages encode and decode', () => {
  const query = encodeQuery('example.com', 1);
  assert.equal(query.readUInt16BE(4), 1, 'one question');
  assert.deepEqual([...query.subarray(12, 20)], [7, ...Buffer.from('example')]);
  // Response: the question echoed, then one A record using a name pointer.
  const answer = Buffer.from([0xc0, 0x0c, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x0e, 0x10, 0x00, 0x04, 93, 184, 215, 14]);
  const header = Buffer.from([0x00, 0x00, 0x81, 0x80, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
  const response = Buffer.concat([header, query.subarray(12), answer]);
  assert.deepEqual(decodeResponse(response), [{ address: '93.184.215.14', family: 4, ttl: 3600 }]);
  const nxdomain = Buffer.from(header);
  nxdomain[3] = 0x83;
  assert.deepEqual(decodeResponse(Buffer.concat([nxdomain.subarray(0, 6), Buffer.from([0, 0, 0, 0, 0, 0]), query.subarray(12)])), []);
});

test('connection settings are validated', () => {
  const ok = validateNetwork(new URLSearchParams('mode=manual&proxyType=socks5&proxyHost=127.0.0.1&proxyPort=9050&_full=1&remoteDns=1'));
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.settings.proxyPort, 9050);
  assert.equal(ok.settings.remoteDns, true);
  assert.ok(validateNetwork(new URLSearchParams('mode=manual&proxyHost=')).errors.length, 'manual mode needs a host');
  assert.ok(validateNetwork(new URLSearchParams('proxyPort=70000')).errors.length);
  assert.ok(validateNetwork(new URLSearchParams('proxyHost=bad host!')).errors.length);
  assert.ok(validateNetwork(new URLSearchParams('doh=strict&dohProvider=custom&dohUrl=http://insecure')).errors.length);
  assert.equal(validateNetwork(new URLSearchParams('mode=warp-drive')).settings.mode, NETWORK_DEFAULTS.mode);
});
