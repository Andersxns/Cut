import { createHash, randomInt, randomUUID } from 'node:crypto';

// Small offline answers. Anything random that you might actually use (passwords)
// is generated in your browser, never on the server.

function color(query) {
  const q = query.trim().replace(/^(colou?r|hex|rgb|hsl)\s+(?=#|rgb|hsl|[0-9a-f]{6}$)/i, '');
  let r, g, b;
  let m = q.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m && (q.startsWith('#') || /^(colou?r|hex)\s/i.test(query))) {
    const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  } else if ((m = q.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i))) {
    [r, g, b] = m.slice(1, 4).map(Number);
    if ([r, g, b].some((v) => v > 255)) return null;
  } else if ((m = q.match(/^hsla?\(\s*(\d{1,3}(?:\.\d+)?)(?:deg)?\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i))) {
    const [h, s, l] = [Number(m[1]) % 360, Number(m[2]) / 100, Number(m[3]) / 100];
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    [r, g, b] = [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  } else return null;

  const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const [rn, gn, bn] = [r, g, b].map((v) => v / 255);
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = Math.round(h * 60 + 360) % 360;
  }
  const lum = [rn, gn, bn].map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
  const cmykK = 1 - max;
  const cmyk = cmykK === 1 ? [0, 0, 0, 100] : [rn, gn, bn].map((v) => Math.round(((1 - v - cmykK) / (1 - cmykK)) * 100)).concat(Math.round(cmykK * 100));
  return {
    type: 'color',
    hex,
    rgb: `rgb(${r}, ${g}, ${b})`,
    hsl: `hsl(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`,
    cmyk: `cmyk(${cmyk.join('%, ')}%)`,
    ink: luminance > 0.45 ? '#111111' : '#ffffff',
  };
}

const HASHES = { md5: 'md5', sha1: 'sha1', 'sha-1': 'sha1', sha256: 'sha256', 'sha-256': 'sha256', sha512: 'sha512', 'sha-512': 'sha512', sha384: 'sha384', 'sha-384': 'sha384' };

function hash(query) {
  const m = query.match(/^(md5|sha-?1|sha-?256|sha-?384|sha-?512)(?:\s+hash)?\s+(.+)$/is);
  if (!m) return null;
  const algorithm = HASHES[m[1].toLowerCase()];
  return { type: 'code', title: `${algorithm.toUpperCase()} hash`, input: m[2], output: createHash(algorithm).update(m[2], 'utf8').digest('hex'), mono: true };
}

function codec(query) {
  let m = query.match(/^(?:base64\s+(encode|decode)|(encode|decode)\s+base64)\s+(.+)$/is);
  if (m) {
    const mode = (m[1] || m[2]).toLowerCase();
    const input = m[3];
    if (mode === 'encode') return { type: 'code', title: 'Base64 encoded', input, output: Buffer.from(input, 'utf8').toString('base64'), mono: true };
    if (!/^[A-Za-z0-9+/_-]+=*$/.test(input.trim())) return null;
    const output = Buffer.from(input.trim(), 'base64').toString('utf8');
    if (/�/.test(output)) return null;
    return { type: 'code', title: 'Base64 decoded', input, output, mono: true };
  }
  m = query.match(/^(?:url\s?(encode|decode)|(encode|decode)\s+url)\s+(.+)$/is);
  if (m) {
    const mode = (m[1] || m[2]).toLowerCase();
    try {
      const output = mode === 'encode' ? encodeURIComponent(m[3]) : decodeURIComponent(m[3]);
      return { type: 'code', title: mode === 'encode' ? 'URL encoded' : 'URL decoded', input: m[3], output, mono: true };
    } catch {
      return null;
    }
  }
  return null;
}

function generators(query) {
  const q = query.trim().toLowerCase();
  if (/^(uuid|guid|uuid ?v?4|random uuid|generate (a )?uuid|uuid generator)$/.test(q)) {
    return { type: 'uuid', value: randomUUID() };
  }
  let m = q.match(/^(?:generate (?:a )?|random |strong |secure )?(?:password|passphrase|pw)(?: generator)?(?:\s+(\d{1,3}))?(?: (?:chars|characters))?$/);
  if (m) return { type: 'password', length: Math.min(Math.max(Number(m[1]) || 20, 6), 128) };
  if (/^(flip a coin|coin flip|flip coin|coin toss|toss a coin|heads or tails\??)$/.test(q)) {
    return { type: 'coin', value: randomInt(2) ? 'Heads' : 'Tails' };
  }
  m = q.match(/^(?:roll\s+)?(?:(\d{1,2})\s*)?d(\d{1,3})$|^roll(?: (?:a|one|(\d{1,2})))? (?:die|dice|d6)$|^(?:dice roll|roll the dice)$/);
  if (m) {
    const count = Math.min(Number(m[1] || m[3]) || (/dice/.test(q) && !m[1] ? 2 : 1), 20);
    const sides = Math.min(Math.max(Number(m[2]) || 6, 2), 1000);
    const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1));
    return { type: 'dice', count, sides, rolls, total: rolls.reduce((a, b) => a + b, 0) };
  }
  m = q.match(/^(?:random number|random integer|rng|pick a number)(?:\s+(?:between|from)\s+(-?\d{1,9})\s+(?:and|to|-)\s+(-?\d{1,9}))?$/);
  if (m) {
    let [lo, hi] = m[1] ? [Number(m[1]), Number(m[2])] : [1, 100];
    if (lo > hi) [lo, hi] = [hi, lo];
    return { type: 'random', lo, hi, value: randomInt(lo, hi + 1) };
  }
  if (/^(stopwatch|online stopwatch|start stopwatch)$/.test(q)) return { type: 'stopwatch' };
  m = q.match(/^(?:set (?:a )?)?timer(?:\s+(?:for\s+)?(\d{1,4})\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?)?)?$|^(\d{1,4})\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?)\s+timer$/);
  if (m) {
    const n = Number(m[1] || m[3]) || 5;
    const unit = (m[2] || m[4] || 'm')[0];
    const seconds = Math.min(n * (unit === 's' ? 1 : unit === 'h' ? 3600 : 60), 24 * 3600);
    return { type: 'timer', seconds };
  }
  return null;
}

const LOREM = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
  'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.',
  'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet.',
  'At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident.',
];

function text(query) {
  const q = query.trim().toLowerCase();
  let m = q.match(/^lorem(?: ipsum)?(?: generator)?(?:\s+(\d{1,2}))?(?: paragraphs?)?$/);
  if (m) {
    const count = Math.min(Math.max(Number(m[1]) || 2, 1), 10);
    return { type: 'lorem', paragraphs: Array.from({ length: count }, (_, i) => LOREM[i % LOREM.length]) };
  }
  if (/^(unix time(stamp)?|current (unix )?timestamp|epoch( time)?|timestamp)$/.test(q)) {
    return { type: 'timestamp', live: true, value: Math.floor(Date.now() / 1000) };
  }
  m = q.match(/^(?:unix|timestamp|epoch|unix timestamp)\s+(-?\d{1,13})$/);
  if (m) {
    const n = Number(m[1]);
    const ms = Math.abs(n) >= 1e11 ? n : n * 1000;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return null;
    return { type: 'timestamp', live: false, value: n, iso: date.toISOString(), utc: date.toUTCString() };
  }
  return null;
}

export const MISC_ANSWERS = [color, hash, codec, generators, text];
