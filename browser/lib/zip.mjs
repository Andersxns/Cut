import fs from 'node:fs';
import zlib from 'node:zlib';

// A small zip reader/writer, enough for Firefox's omni.ja archives and for
// Node's Windows zip. Unchanged entries are copied without recompressing.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;

export class ZipEntry {
  constructor(name, { method = 8, crc = 0, size = 0, raw = null, data = null, mode = 0 } = {}) {
    this.name = name;
    this.method = method;
    this.crc = crc;
    this.size = size;
    this.raw = raw; // compressed bytes as stored in the archive
    this._data = data; // uncompressed bytes, when changed or new
    this.mode = mode; // unix mode bits, if the archive recorded them
  }

  get data() {
    if (!this._data) {
      this._data = this.method === 0 ? this.raw : this.method === 8 ? zlib.inflateRawSync(this.raw) : null;
      if (!this._data) throw new Error(`${this.name}: unsupported compression method ${this.method}`);
    }
    return this._data;
  }

  get text() {
    return this.data.toString('utf8');
  }

  set(data) {
    this._data = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    this.raw = null;
    this.size = this._data.length;
    this.crc = zlib.crc32(this._data);
  }
}

export function readZip(input) {
  const buf = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === SIG_END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip archive (no end record)');
  const count = buf.readUInt16LE(end + 10);
  let offset = buf.readUInt32LE(end + 16);
  // Mozilla's optimized jars keep the central directory near the start; the
  // end record still points at it, but check the signature to be sure.
  if (buf.readUInt32LE(offset) !== SIG_CENTRAL) offset = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== SIG_CENTRAL) throw new Error(`bad central directory entry ${i}`);
    const madeBy = buf.readUInt16LE(offset + 4);
    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const crc = buf.readUInt32LE(offset + 16);
    const compSize = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const external = buf.readUInt32LE(offset + 38);
    const local = buf.readUInt32LE(offset + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;
    if (buf.readUInt32LE(local) !== SIG_LOCAL) throw new Error(`${name}: bad local header`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const mode = madeBy >> 8 === 3 ? external >>> 16 : 0;
    entries.set(name, new ZipEntry(name, { method, crc, size, raw: buf.subarray(start, start + compSize), mode }));
  }
  return entries;
}

// Zips a folder file by file, without holding the whole archive in memory.
// Returns the number of files written.
export function zipDirectory(dir, file, { level = 9, prefix = '' } = {}) {
  const entries = [];
  const walk = (abs, rel) => {
    for (const item of fs.readdirSync(abs, { withFileTypes: true })) {
      const childAbs = `${abs}/${item.name}`;
      const childRel = rel ? `${rel}/${item.name}` : item.name;
      if (item.isDirectory()) walk(childAbs, childRel);
      else entries.push({ abs: childAbs, rel: prefix + childRel });
    }
  };
  walk(dir, '');
  // A generator keeps only one file in memory at a time.
  function* lazy() {
    for (const { abs, rel } of entries) {
      const entry = new ZipEntry(rel);
      entry.set(fs.readFileSync(abs));
      yield entry;
      entry.raw = null;
      entry._data = null;
    }
  }
  writeZip(file, lazy(), { level });
  return entries.length;
}

// DOS date/time for 2010-01-01 00:00, so archives are reproducible.
const DOS_TIME = 0;
const DOS_DATE = ((2010 - 1980) << 9) | (1 << 5) | 1;

// Writes entries (a Map or array of ZipEntry). Directories are implied.
export function writeZip(file, entries, { level = 9, unixModes = false } = {}) {
  const fd = fs.openSync(file, 'w');
  const central = [];
  let position = 0;
  const write = (b) => {
    fs.writeSync(fd, b);
    position += b.length;
  };
  try {
    for (const entry of entries instanceof Map ? entries.values() : entries) {
      let { method, raw } = entry;
      if (!raw) {
        const data = entry.data;
        const deflated = zlib.deflateRawSync(data, { level });
        if (deflated.length < data.length) [method, raw] = [8, deflated];
        else [method, raw] = [0, data];
        entry.method = method;
        entry.raw = raw;
      }
      const name = Buffer.from(entry.name, 'utf8');
      const header = Buffer.alloc(30);
      header.writeUInt32LE(SIG_LOCAL, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0x800, 6);
      header.writeUInt16LE(method, 8);
      header.writeUInt16LE(DOS_TIME, 10);
      header.writeUInt16LE(DOS_DATE, 12);
      header.writeUInt32LE(entry.crc >>> 0, 14);
      header.writeUInt32LE(raw.length, 18);
      header.writeUInt32LE(entry.size, 22);
      header.writeUInt16LE(name.length, 26);
      central.push({ entry, name, method, offset: position, compSize: raw.length });
      write(header);
      write(name);
      write(raw);
    }
    const cdStart = position;
    for (const { entry, name, method, offset, compSize } of central) {
      const record = Buffer.alloc(46);
      record.writeUInt32LE(SIG_CENTRAL, 0);
      record.writeUInt16LE(unixModes ? (3 << 8) | 20 : 20, 4);
      record.writeUInt16LE(20, 6);
      record.writeUInt16LE(0x800, 8);
      record.writeUInt16LE(method, 10);
      record.writeUInt16LE(DOS_TIME, 12);
      record.writeUInt16LE(DOS_DATE, 14);
      record.writeUInt32LE(entry.crc >>> 0, 16);
      record.writeUInt32LE(compSize, 20);
      record.writeUInt32LE(entry.size, 24);
      record.writeUInt16LE(name.length, 28);
      if (unixModes) record.writeUInt32LE(((entry.mode || 0o100644) << 16) >>> 0, 38);
      record.writeUInt32LE(offset, 42);
      write(record);
      write(name);
    }
    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(SIG_END, 0);
    endRecord.writeUInt16LE(central.length, 8);
    endRecord.writeUInt16LE(central.length, 10);
    endRecord.writeUInt32LE(position - cdStart, 12);
    endRecord.writeUInt32LE(cdStart, 16);
    write(endRecord);
  } finally {
    fs.closeSync(fd);
  }
}
