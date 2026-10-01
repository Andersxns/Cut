import fs from 'node:fs';
import zlib from 'node:zlib';
import { readTar } from './tar.mjs';

// Tor for Cut Browser's Tor windows, from the Tor Project's "expert bundle"
// (the Tor client and its pluggable transports, as shipped in Tor Browser).
// Everything lands in the app's tor/ folder:
//   tor(.exe) and, on Linux, the libraries it needs
//   pluggable_transports/lyrebird(.exe)   obfs4, meek, Snowflake and WebTunnel bridges
//   pluggable_transports/pt_config.json   the built-in bridges
//   geoip, geoip6                          country data for relays
//   licenses/                              Tor's and its components' licenses

const LICENSES = ['tor', 'lyrebird', 'openssl', 'libevent', 'zlib'];

// Maps a path in the expert bundle to its place in tor/, or null to leave it
// out (the debug symbols, tor-gencert and the Conjure transport, which Cut
// Browser doesn't offer).
function destination(name) {
  if (/^tor\/(tor(\.exe)?|lib[^/]+\.so[.\d]*)$/.test(name)) return name.slice(4);
  if (/^tor\/pluggable_transports\/(lyrebird(\.exe)?|pt_config\.json)$/.test(name)) return name.slice(4);
  if (/^data\/geoip6?$/.test(name)) return name.slice(5);
  const license = name.match(/^docs\/([a-z]+)\.txt$/);
  if (license && LICENSES.includes(license[1])) return `licenses/${license[1]}.txt`;
  return null;
}

// Returns [{ rel, mode, data }] with paths relative to tor/.
export async function torFiles(bundle) {
  const files = [];
  for await (const entry of readTar(fs.createReadStream(bundle).pipe(zlib.createGunzip()))) {
    if (entry.type !== 'file') continue;
    const rel = destination(entry.name);
    if (!rel) continue;
    const executable = !/\.(json|txt)$|^geoip6?$/.test(rel.split('/').pop());
    files.push({ rel, mode: executable ? 0o755 : 0o644, data: entry.data });
  }
  for (const want of ['pluggable_transports/pt_config.json', 'geoip', 'geoip6']) {
    if (!files.some((f) => f.rel === want)) throw new Error(`The Tor expert bundle has no ${want}`);
  }
  if (!files.some((f) => /^tor(\.exe)?$/.test(f.rel))) throw new Error('The Tor expert bundle has no tor executable');
  return files;
}
