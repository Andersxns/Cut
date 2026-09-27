import zlib from 'node:zlib';

// Draws Cut Browser's icons without image libraries: shapes are described as
// "inside" tests in a 256-unit design space and supersampled for smooth edges.
// The mark is the same geometry as Cut Search's logo (scripts/make-icons.mjs).

export const ORANGE = '#e0552b';
export const PURPLE = '#7b3fe4';

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// ---------- The mark (48-unit geometry from Cut Search) ----------

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

function distanceToHalf(u, v, side) {
  const inside = (a, b) => (side < 0 ? a + b <= -m : a + b >= m);
  const length = Math.hypot(u, v);
  if (length <= r && inside(u, v)) return 0;
  let best = Infinity;
  if (length > r && inside((u / length) * r, (v / length) * r)) best = length - r;
  const chord = side < 0 ? [[(-m + s) / 2, (-m - s) / 2], [(-m - s) / 2, (-m + s) / 2]] : [[(m + s) / 2, (m - s) / 2], [(m - s) / 2, (m + s) / 2]];
  return Math.min(best, segmentDistance(u, v, chord[0], chord[1]));
}

// Is (x, y) inside the mark, drawn in the box [x0, y0, size]?
export const mark = (x0, y0, size) => (x, y) => {
  const u = ((x - x0) / size) * 48;
  const v = ((y - y0) / size) * 48;
  return distanceToHalf(u - SLIDE - 24, v + SLIDE - 24, -1) <= ROUND || distanceToHalf(u - 24, v - 24, 1) <= ROUND;
};

// ---------- Other shapes ----------

export const roundRect = (x0, y0, x1, y1, radius) => (x, y) => {
  const dx = Math.max(x0 + radius - x, 0, x - (x1 - radius));
  const dy = Math.max(y0 + radius - y, 0, y - (y1 - radius));
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && dx * dx + dy * dy <= radius * radius;
};

// A page whose top-right corner is folded over along x - y = FOLD.
const FOLD = 140;
const page = (inset) => {
  const body = roundRect(44 + inset, 14 + inset, 212 - inset, 242 - inset, Math.max(2, 14 - inset));
  return (x, y) => body(x, y) && x - y <= FOLD - inset * Math.SQRT2;
};
const fold = (x, y) => x >= 154 && y <= 72 && x - y <= FOLD;

// ---------- Rasterizing ----------

// layers: [{ inside(x, y) in 256-space, color: '#rrggbb' }], painted in order.
export function rasterize(size, layers, { background = null } = {}) {
  const SS = size <= 32 ? 8 : size <= 128 ? 5 : 3;
  const px = Buffer.alloc(size * size * 4);
  const colors = layers.map((l) => rgb(l.color));
  const bg = background ? rgb(background) : null;
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r0 = 0;
      let g0 = 0;
      let b0 = 0;
      let a0 = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((pxl + (sx + 0.5) / SS) / size) * 256;
          const y = ((py + (sy + 0.5) / SS) / size) * 256;
          let hit = -1;
          for (let i = layers.length - 1; i >= 0; i--) {
            if (layers[i].inside(x, y)) {
              hit = i;
              break;
            }
          }
          const c = hit >= 0 ? colors[hit] : bg;
          if (c) {
            r0 += c[0];
            g0 += c[1];
            b0 += c[2];
            a0++;
          }
        }
      }
      const i = (py * size + pxl) * 4;
      if (a0) {
        px[i] = Math.round(r0 / a0);
        px[i + 1] = Math.round(g0 / a0);
        px[i + 2] = Math.round(b0 / a0);
      }
      px[i + 3] = Math.round((a0 / (SS * SS)) * 255);
    }
  }
  return { size, rgba: px };
}

// ---------- Encoders ----------

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

export function png({ size, rgba }, height = size) {
  const width = rgba.length / 4 / height;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// 32-bit DIB for classic icon entries (bottom-up BGRA plus an empty AND mask).
function dib({ size, rgba }) {
  const maskRow = Math.ceil(size / 32) * 4;
  const out = Buffer.alloc(40 + size * size * 4 + maskRow * size);
  out.writeUInt32LE(40, 0);
  out.writeInt32LE(size, 4);
  out.writeInt32LE(size * 2, 8);
  out.writeUInt16LE(1, 12);
  out.writeUInt16LE(32, 14);
  out.writeUInt32LE(size * size * 4 + maskRow * size, 20);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = ((size - 1 - y) * size + x) * 4;
      const dst = 40 + (y * size + x) * 4;
      out[dst] = rgba[src + 2];
      out[dst + 1] = rgba[src + 1];
      out[dst + 2] = rgba[src];
      out[dst + 3] = rgba[src + 3];
    }
  }
  return out;
}

// Windows .ico: classic bitmaps for small sizes, PNG for 256.
export function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const bodies = images.map((img) => (img.size >= 256 ? png(img) : dib(img)));
  let offset = header.length;
  images.forEach((img, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(img.size >= 256 ? 0 : img.size, entry);
    header.writeUInt8(img.size >= 256 ? 0 : img.size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(bodies[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += bodies[i].length;
  });
  return Buffer.concat([header, ...bodies]);
}

// ---------- Cut Browser's icon set ----------

// The app icon is the bare mark, like Firefox's own icon has no plate.
export const appLayers = (color = ORANGE) => [{ inside: mark(10, 10, 236), color }];

export const documentLayers = () => [
  { inside: page(0), color: '#c9c9d1' },
  { inside: page(4), color: '#ffffff' },
  { inside: fold, color: '#dcdce2' },
  { inside: mark(76, 92, 104), color: ORANGE },
];

// Block letters for the PDF badge, drawn in a 256-unit box.
const bar = (x0, y0, x1, y1) => roundRect(x0, y0, x1, y1, 2);
const box = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
// A bowl that is square on its left side and round on its right (P and D).
const bowl = (x0, y0, x1, y1, radius, stroke) => {
  const mid = (x0 + x1) / 2;
  const outerRound = roundRect(x0, y0, x1, y1, radius);
  const innerRound = roundRect(x0 + stroke, y0 + stroke, x1 - stroke, y1 - stroke, Math.max(1, radius - stroke));
  const outer = (x, y) => outerRound(x, y) || box(x0, y0, mid, y1)(x, y);
  const inner = (x, y) => innerRound(x, y) || box(x0 + stroke, y0 + stroke, mid, y1 - stroke)(x, y);
  return (x, y) => outer(x, y) && !inner(x, y);
};
const letters = (x, y) =>
  // P
  bar(66, 162, 80, 214)(x, y) ||
  bowl(66, 162, 112, 198, 17, 13)(x, y) ||
  // D
  bowl(118, 162, 166, 214, 24, 14)(x, y) ||
  // F
  bar(174, 162, 188, 214)(x, y) ||
  bar(174, 162, 206, 175)(x, y) ||
  bar(174, 183, 200, 196)(x, y);

export const pdfLayers = () => [
  { inside: page(0), color: '#c9c9d1' },
  { inside: page(4), color: '#ffffff' },
  { inside: fold, color: '#dcdce2' },
  { inside: mark(92, 58, 72), color: ORANGE },
  { inside: roundRect(44, 150, 212, 226, 6), color: '#d92d20' },
  { inside: letters, color: '#ffffff' },
];

export const WINDOWS_ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

export const appIco = (color) => ico(WINDOWS_ICON_SIZES.map((size) => rasterize(size, appLayers(color))));
export const documentIco = () => ico([16, 24, 32, 48, 64, 256].map((size) => rasterize(size, documentLayers())));
export const pdfIco = () => ico([16, 24, 32, 48, 64, 256].map((size) => rasterize(size, pdfLayers())));
export const appPng = (size, color) => png(rasterize(size, appLayers(color)));

// A mark centred in a wider canvas (e.g. branding/about.png, 300×236).
export function centredPng(width, height, markSize, color = ORANGE) {
  const side = Math.max(width, height);
  const img = rasterize(side, [{ inside: mark(128 - (markSize / side) * 128, 128 - (markSize / side) * 128, (markSize / side) * 256), color }]);
  const out = Buffer.alloc(width * height * 4);
  const ox = Math.floor((side - width) / 2);
  const oy = Math.floor((side - height) / 2);
  for (let y = 0; y < height; y++) img.rgba.copy(out, y * width * 4, ((y + oy) * side + ox) * 4, ((y + oy) * side + ox + width) * 4);
  return png({ size: width, rgba: out }, height);
}

// ---------- Vector versions ----------

export const markSvg = (color = ORANGE, { contextFill = false } = {}) => {
  const paint = contextFill ? `context-fill ${color}` : color;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
  <g fill="${paint}" stroke="${paint}" stroke-width="6.4" stroke-linejoin="round">
    <path d="M34.238 6.836A17.8 17.8 0 0 0 10.036 31.038Z"/>
    <path d="M39.564 15.362A17.8 17.8 0 0 1 15.362 39.564Z"/>
  </g>
</svg>
`;
};

// "Cut Browser" set in the system UI face: "Cut" bold, the product name
// lighter, as on Cut Search's home page ("Cut Search"). 540×80 box; pages
// that show it are given room for it in app/chrome/content.css.
export const wordmarkSvg = (fill = 'context-fill', product = 'Browser') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 80">
  <text x="0" y="64" fill="${fill}" font-family="'Segoe UI Variable Display', 'Segoe UI', 'SF Pro Display', Cantarell, Ubuntu, 'Noto Sans', 'DejaVu Sans', sans-serif" font-size="76" font-weight="650" letter-spacing="-1.5">Cut<tspan font-weight="400" fill-opacity="0.66"> ${product}</tspan></text>
</svg>
`;
