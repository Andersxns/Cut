// Renders the Cut logo to PNG/ICO without any image libraries.
// Usage: node scripts/make-icons.mjs   (writes into public/img)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'img');
fs.mkdirSync(OUT, { recursive: true });

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const COLOR = hex('#e0552b');

// Logo geometry (48×48 design space): a disc of radius R centred on (24, 24),
// cut along x + y = 48. Each half keeps GAP/2 away from the cut, the upper half
// slides SLIDE units along it, and corners are rounded with radius ROUND. The
// SVG in src/views/icons.js is generated from the same numbers: each half is
// the disc of radius R - ROUND, clipped ROUND further from the cut, then
// stroked with width 2 × ROUND and round joins.
const R = 21;
const GAP = 4.8;
const SLIDE = 1.6;
const ROUND = 3.2;
const r = R - ROUND;
const m = GAP / 2 + ROUND * Math.SQRT2;
const s = Math.sqrt(2 * r * r - m * m);

function segmentDistance(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Distance from (u, v), relative to the disc centre, to one inset half.
// side = -1 is the upper half (u + v <= -m), side = 1 the lower (u + v >= m).
function distanceToHalf(u, v, side) {
  const inside = (a, b) => (side < 0 ? a + b <= -m : a + b >= m);
  const length = Math.hypot(u, v);
  if (length <= r && inside(u, v)) return 0;
  let best = Infinity;
  if (length > r && inside((u / length) * r, (v / length) * r)) best = length - r;
  const chord = side < 0 ? [[(-m + s) / 2, (-m - s) / 2], [(-m - s) / 2, (-m + s) / 2]] : [[(m + s) / 2, (m - s) / 2], [(m - s) / 2, (m + s) / 2]];
  return Math.min(best, segmentDistance(u, v, chord[0], chord[1]));
}

// Colour of the mark at a point in its design space, or null if empty.
function sample(x, y) {
  if (distanceToHalf(x - SLIDE - 24, y + SLIDE - 24, -1) <= ROUND) return COLOR;
  if (distanceToHalf(x - 24, y - 24, 1) <= ROUND) return COLOR;
  return null;
}

// size: output pixels; scale: fraction of the canvas the mark occupies; bg: optional [r,g,b].
function render(size, { scale = 1, bg = null } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const SS = 6;
  const markSize = size * scale;
  const offset = (size - markSize) / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS - offset) / markSize) * 48;
          const y = ((py + (sy + 0.5) / SS - offset) / markSize) * 48;
          const c = sample(x, y);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a++;
          }
        }
      }
      const coverage = a / (SS * SS);
      const i = (py * size + px) * 4;
      const color = a ? [r / a, g / a, b / a] : [0, 0, 0];
      if (bg) {
        for (let k = 0; k < 3; k++) pixels[i + k] = Math.round(color[k] * coverage + bg[k] * (1 - coverage));
        pixels[i + 3] = 255;
      } else {
        for (let k = 0; k < 3; k++) pixels[i + k] = Math.round(color[k]);
        pixels[i + 3] = Math.round(coverage * 255);
      }
    }
  }
  return encodePng(size, pixels);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((img) => img.png)]);
}

const write = (name, data) => {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log(`  ${name.padEnd(22)} ${data.length.toLocaleString()} bytes`);
};

write('favicon.ico', encodeIco([16, 32, 48].map((size) => ({ size, png: render(size) }))));
write('apple-touch-icon.png', render(180, { scale: 0.7, bg: hex('#ffffff') }));
write('icon-192.png', render(192, { scale: 0.92 }));
write('icon-512.png', render(512, { scale: 0.92 }));
write('icon-maskable-512.png', render(512, { scale: 0.62, bg: hex('#ffffff') }));
