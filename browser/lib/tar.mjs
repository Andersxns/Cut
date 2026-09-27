import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Streaming tar reader and writer (ustar with pax/GNU long names), so Linux
// packages keep their permissions and symlinks even when built on Windows.

const BLOCK = 512;

function parseOctal(buf, start, length) {
  const text = buf.toString('latin1', start, start + length).replace(/\0.*$/s, '').trim();
  return text ? parseInt(text, 8) : 0;
}

function parsePax(text) {
  const out = {};
  let i = 0;
  while (i < text.length) {
    const space = text.indexOf(' ', i);
    const length = Number(text.slice(i, space));
    const record = text.slice(space + 1, i + length - 1);
    const eq = record.indexOf('=');
    out[record.slice(0, eq)] = record.slice(eq + 1);
    i += length;
  }
  return out;
}

// Yields { name, type: 'file'|'dir'|'symlink'|'link', mode, size, linkname, data }.
export async function* readTar(stream) {
  let buffer = Buffer.alloc(0);
  let pending = null; // long name / pax overrides for the next entry
  const chunks = stream[Symbol.asyncIterator]();
  let ended = false;
  const need = async (n) => {
    while (buffer.length < n && !ended) {
      const { value, done } = await chunks.next();
      if (done) ended = true;
      else buffer = buffer.length ? Buffer.concat([buffer, value]) : value;
    }
    return buffer.length >= n;
  };
  const take = (n) => {
    const out = buffer.subarray(0, n);
    buffer = buffer.subarray(n);
    return out;
  };
  while (await need(BLOCK)) {
    const header = Buffer.from(take(BLOCK));
    if (header.every((b) => b === 0)) continue;
    const typeflag = String.fromCharCode(header[156] || 48);
    const size = parseOctal(header, 124, 12);
    const padded = Math.ceil(size / BLOCK) * BLOCK;
    if (!(await need(padded))) throw new Error('tar archive ends in the middle of an entry');
    const body = Buffer.from(take(padded).subarray(0, size));
    if (typeflag === 'L' || typeflag === 'K') {
      pending = { ...pending, [typeflag === 'L' ? 'path' : 'linkpath']: body.toString('utf8').replace(/\0+$/, '') };
      continue;
    }
    if (typeflag === 'x') {
      pending = { ...pending, ...parsePax(body.toString('utf8')) };
      continue;
    }
    if (typeflag === 'g') continue;
    let name = header.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    const prefix = header.toString('latin1', 257, 262) === 'ustar' ? header.toString('utf8', 345, 500).replace(/\0.*$/s, '') : '';
    if (prefix) name = `${prefix}/${name}`;
    const linkname = pending?.linkpath ?? header.toString('utf8', 157, 257).replace(/\0.*$/s, '');
    if (pending?.path) name = pending.path;
    pending = null;
    const type = typeflag === '5' ? 'dir' : typeflag === '2' ? 'symlink' : typeflag === '1' ? 'link' : 'file';
    yield { name: name.replace(/\/$/, ''), type, mode: parseOctal(header, 100, 8) & 0o7777, size, linkname, data: type === 'file' ? body : null };
  }
}

// Reads a .tar.xz through the xz command-line tool.
export function readTarXz(file) {
  const xz = spawn('xz', ['-dc', file], { stdio: ['ignore', 'pipe', 'inherit'] });
  xz.on('error', (e) => {
    throw new Error(`Couldn't run xz (needed for .tar.xz files): ${e.message}`);
  });
  return readTar(xz.stdout);
}

function header(name, { type = 'file', mode = 0o644, size = 0, linkname = '', mtime }) {
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, 100, 'utf8');
  block.write(mode.toString(8).padStart(7, '0') + '\0', 100, 8, 'latin1');
  block.write('0000000\0', 108, 8, 'latin1');
  block.write('0000000\0', 116, 8, 'latin1');
  block.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'latin1');
  block.write(Math.floor(mtime).toString(8).padStart(11, '0') + '\0', 136, 12, 'latin1');
  block.write('        ', 148, 8, 'latin1');
  block.write({ file: '0', dir: '5', symlink: '2', pax: 'x' }[type], 156, 1, 'latin1');
  block.write(linkname, 157, 100, 'utf8');
  block.write('ustar\0', 257, 6, 'latin1');
  block.write('00', 263, 2, 'latin1');
  block.write('root', 265, 32, 'latin1');
  block.write('root', 297, 32, 'latin1');
  let sum = 0;
  for (const b of block) sum += b;
  block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1');
  return block;
}

const pad = (n) => Buffer.alloc((BLOCK - (n % BLOCK)) % BLOCK);

// Writes a tar stream to `output` (a writable stream). Directories must be
// added before their contents; names use forward slashes.
export class TarWriter {
  constructor(output, { mtime = Date.UTC(2026, 0, 1) / 1000 } = {}) {
    this.output = output;
    this.mtime = mtime;
    this.bytes = 0;
  }

  async #write(buf) {
    this.bytes += buf.length;
    if (!this.output.write(buf)) await once(this.output, 'drain');
  }

  async #entry(name, options, data = null) {
    const needsPax = Buffer.byteLength(name) > 99 || Buffer.byteLength(options.linkname || '') > 99;
    if (needsPax) {
      const records = [['path', name], ...(options.linkname ? [['linkpath', options.linkname]] : [])]
        .map(([k, v]) => {
          const base = ` ${k}=${v}\n`;
          let length = Buffer.byteLength(base) + 1;
          while (String(length).length + Buffer.byteLength(base) !== length) length = String(length).length + Buffer.byteLength(base);
          return `${length}${base}`;
        })
        .join('');
      const pax = Buffer.from(records, 'utf8');
      await this.#write(header('PaxHeader', { type: 'pax', size: pax.length, mtime: this.mtime }));
      await this.#write(pax);
      await this.#write(pad(pax.length));
    }
    await this.#write(header(name.slice(0, 99), { ...options, linkname: (options.linkname || '').slice(0, 99), mtime: this.mtime }));
    if (data) {
      await this.#write(data);
      await this.#write(pad(data.length));
    }
  }

  dir(name, mode = 0o755) {
    return this.#entry(`${name.replace(/\/$/, '')}/`, { type: 'dir', mode });
  }

  file(name, data, mode = 0o644) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    return this.#entry(name, { type: 'file', mode, size: buf.length }, buf);
  }

  symlink(name, target) {
    return this.#entry(name, { type: 'symlink', mode: 0o777, linkname: target });
  }

  async finish() {
    await this.#write(Buffer.alloc(BLOCK * 2));
  }
}

// A writable that compresses with the xz tool into `file`; resolves when done.
export function xzWriter(file, level = 6) {
  const out = fs.createWriteStream(file);
  const xz = spawn('xz', [`-${level}`, '-T0', '-c'], { stdio: ['pipe', 'pipe', 'inherit'] });
  xz.stdout.pipe(out);
  const done = new Promise((resolve, reject) => {
    out.on('finish', resolve);
    xz.on('error', reject);
    xz.on('exit', (code) => code !== 0 && reject(new Error(`xz exited with ${code}`)));
  });
  return { stream: xz.stdin, done: () => (xz.stdin.end(), done) };
}
