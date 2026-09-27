import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Downloads into the cache once, verifying each file against the checksum
// its publisher lists. A file that is already cached is re-verified, not
// fetched again.

const fmt = (n) => `${(n / 1048576).toFixed(1)} MB`;

async function hashFile(file, algorithm) {
  const hash = crypto.createHash(algorithm);
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

export async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

// expected: { algorithm: 'sha512' | 'sha256', digest }
export async function download(url, dest, expected) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const name = path.basename(dest);
  if (fs.existsSync(dest)) {
    if ((await hashFile(dest, expected.algorithm)) === expected.digest) {
      console.log(`  ✓ ${name} (cached)`);
      return dest;
    }
    console.log(`  ! ${name} is damaged; downloading again`);
    fs.rmSync(dest);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const hash = crypto.createHash(expected.algorithm);
  let done = 0;
  let lastReport = 0;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      done += chunk.length;
      if (Date.now() - lastReport > 5000) {
        lastReport = Date.now();
        console.log(`    ${name}: ${fmt(done)}${total ? ` of ${fmt(total)}` : ''}`);
      }
      cb(null, chunk);
    },
  });
  const part = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(part));
  const digest = hash.digest('hex');
  if (digest !== expected.digest) {
    fs.rmSync(part, { force: true });
    throw new Error(`${name}: checksum mismatch (expected ${expected.digest.slice(0, 16)}…, got ${digest.slice(0, 16)}…)`);
  }
  fs.renameSync(part, dest);
  console.log(`  ✓ ${name} (${fmt(done)}, ${expected.algorithm} verified)`);
  return dest;
}

// Parses "<digest>  <path>" checksum lists (SHA512SUMS, SHASUMS256.txt).
export function parseSums(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^([0-9a-f]{64,128})\s+\*?(.+?)\s*$/);
    if (m) map.set(m[2], m[1]);
  }
  return map;
}
