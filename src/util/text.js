import { escapeHtml, raw } from './html.js';

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', deg: '°', times: '×', divide: '÷',
  eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', oacute: 'ó', uacute: 'ú', iacute: 'í',
  ntilde: 'ñ', ouml: 'ö', uuml: 'ü', auml: 'ä', szlig: 'ß', ccedil: 'ç', euro: '€', pound: '£',
};

export function decodeEntities(text) {
  if (!text || !text.includes('&')) return text || '';
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[entity.toLowerCase()];
    return named ?? match;
  });
}

export const stripTags = (markup) => decodeEntities(String(markup || '').replace(/<[^>]*>/g, ''));

export const squash = (text) => String(text || '').replace(/\s+/g, ' ').trim();

export function truncate(text, max) {
  const s = squash(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '') + '…';
}

// Lower-cased word tokens, Unicode aware.
export const tokenize = (text) => (String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);

const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'to', 'for', 'is', 'at', 'by', 'with', 'from']);
export const significantTokens = (text) => {
  const tokens = tokenize(text);
  const meaningful = tokens.filter((t) => !STOPWORDS.has(t));
  return [...new Set(meaningful.length ? meaningful : tokens)];
};

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Returns SafeHtml with query terms wrapped in <b>, everything else escaped.
export function highlight(text, terms) {
  const source = String(text || '');
  const words = [...new Set(terms.filter((t) => t.length > 1))].sort((a, b) => b.length - a.length);
  if (!words.length || !source) return raw(escapeHtml(source));
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${words.map(escapeRegExp).join('|')})`, 'giu');
  let out = '';
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    out += escapeHtml(source.slice(last, match.index)) + '<b>' + escapeHtml(match[0]) + '</b>';
    last = match.index + match[0].length;
  }
  return raw(out + escapeHtml(source.slice(last)));
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), SIZE_UNITS.length - 1);
  const value = bytes / 1024 ** exp;
  return `${value >= 100 || exp === 0 ? Math.round(value) : value.toFixed(1)} ${SIZE_UNITS[exp]}`;
}

const SIZE_FACTORS = { b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4, p: 1024 ** 5 };
// Parses sizes like "389.7 MiB", "1.2 GB", "700MB".
export function parseSize(text) {
  const m = String(text || '').replace(',', '.').match(/([\d.]+)\s*([kmgtp]?)i?b/i);
  if (!m) return 0;
  return Math.round(parseFloat(m[1]) * (SIZE_FACTORS[(m[2] || 'b').toLowerCase()] || 1));
}

const numberFormat = new Intl.NumberFormat('en-US');
export const formatNumber = (n) => (Number.isFinite(n) ? numberFormat.format(n) : '');

const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
export const formatCompact = (n) => (Number.isFinite(n) ? compactFormat.format(n) : '');

const UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];
export function timeAgo(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const seconds = Math.round((now - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  for (const [unit, size] of UNITS) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

const dateFormat = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
export const formatDate = (timestamp) => (Number.isFinite(timestamp) && timestamp > 0 ? dateFormat.format(new Date(timestamp)) : '');

export function toTimestamp(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}
