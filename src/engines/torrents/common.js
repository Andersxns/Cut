// Shared torrent helpers: info-hash normalisation, magnet links, categories.

export const CATEGORIES = [
  { id: 'all', name: 'All' },
  { id: 'video', name: 'Movies & TV' },
  { id: 'audio', name: 'Music & Audio' },
  { id: 'apps', name: 'Software' },
  { id: 'games', name: 'Games' },
  { id: 'books', name: 'Books' },
  { id: 'anime', name: 'Anime' },
  { id: 'other', name: 'Other' },
  { id: 'xxx', name: 'Adult', adult: true },
];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

export const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker.bittor.pw:1337/announce',
];

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Accepts a 40-char hex or 32-char base32 BTIH and returns lower-case hex.
export function normalizeHash(value) {
  const hash = String(value || '').trim();
  if (/^[a-f0-9]{40}$/i.test(hash)) return hash.toLowerCase();
  if (/^[a-z2-7]{32}$/i.test(hash)) {
    let bits = '';
    for (const ch of hash.toUpperCase()) bits += BASE32.indexOf(ch).toString(2).padStart(5, '0');
    let hex = '';
    for (let i = 0; i + 4 <= bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex.slice(0, 40);
  }
  return '';
}

export const hashFromMagnet = (magnet) => normalizeHash((String(magnet || '').match(/urn:btih:([a-z0-9]+)/i) || [])[1]);

export function buildMagnet(hash, name, { trackers = [], webseeds = [], publicTrackers = true } = {}) {
  const tr = [...new Set([...trackers, ...(publicTrackers ? PUBLIC_TRACKERS : [])])].slice(0, 12);
  return (
    `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name || hash)}` +
    tr.map((t) => `&tr=${encodeURIComponent(t)}`).join('') +
    webseeds.map((w) => `&ws=${encodeURIComponent(w)}`).join('')
  );
}

const RULES = [
  ['xxx', /\b(xxx|porn|brazzers|onlyfans|hentai|18\+ only|jav\s?\d)\b/i],
  ['anime', /^\s*\[[^\]]{2,40}\]\s*\S|\b(anime|subsplease|erai-raws|horriblesubs|judas)\b/i],
  ['games', /\b(fitgirl|dodi|codex|skidrow|plaza|reloaded|elamigos|tenoke|empress|flt|rune|gog|repack|nsw|nsp|xci|ps[2-5]|xbox|switch|pc game|game of the year|goty)\b/i],
  ['video', /\b(2160p|1080p|720p|480p|4k|uhd|x26[45]|h\.?26[45]|hevc|av1|bluray|blu-ray|bdrip|brrip|web-?dl|webrip|hdtv|dvdrip|hdrip|xvid|divx|remux|s\d{1,2}e\d{1,3}|season \d+|complete series|\.(mkv|mp4|avi|m4v))\b/i],
  ['audio', /\b(flac|mp3|aac|ogg|opus|alac|320\s?kbps|v0|discography|album|lossless|24bit|16bit|vinyl|soundtrack|ost)\b/i],
  ['books', /\b(epub|pdf|mobi|azw3|ebook|e-book|audiobook|m4b|cbr|cbz|comics?|magazine|textbook|manga)\b/i],
  ['apps', /\b(x64|x86|amd64|arm64|win(dows)?\s?(1[01]|7|8)?|macos|mac os|linux|\.iso|iso|portable|setup|installer|apk|android|\.exe|\.dmg|ubuntu|debian|fedora|distro)\b/i],
];

export function guessCategory(name) {
  for (const [id, re] of RULES) if (re.test(name)) return id;
  return 'other';
}

// Maps free-text category labels (Knaben, Nyaa, ...) to our categories.
export function categoryFromLabel(label, name = '') {
  const l = String(label || '').toLowerCase();
  if (/xxx|adult|porn/.test(l)) return 'xxx';
  if (/anime/.test(l)) return 'anime';
  if (/game|console|ps\d|xbox|nintendo|wii/.test(l)) return 'games';
  if (/movie|tv|video|film|series|episode|live action|documentar/.test(l)) return 'video';
  if (/audio|music|mp3|flac|lossless|lossy|podcast/.test(l)) return 'audio';
  if (/book|comic|literature|magazine|text|\bdoc\b/.test(l)) return 'books';
  if (/software|app|pc|mac|linux|windows|android|ios|unix|os/.test(l)) return 'apps';
  return guessCategory(name);
}
