// User preferences. Stored in a single first-party cookie that holds only the
// choices you changed — never an identifier — and is sent only to Cut. If
// everything is at its default, no cookie is stored at all.

export const THEMES = [
  { id: 'system', name: 'System', desc: 'Match your device' },
  { id: 'light', name: 'Light', desc: 'Bright and clean' },
  { id: 'dark', name: 'Dark', desc: 'Easy on the eyes' },
  { id: 'midnight', name: 'Midnight', desc: 'True black for OLED' },
  { id: 'terminal', name: 'Terminal', desc: 'Green phosphor, monospace' },
];

export const SAFE_LEVELS = [
  { id: 'strict', name: 'Strict', desc: 'Filter explicit results' },
  { id: 'moderate', name: 'Moderate', desc: 'Filter explicit images and videos' },
  { id: 'off', name: 'Off', desc: 'Show everything' },
];

export const TIME_RANGES = [
  { id: '', name: 'Any time' },
  { id: 'd', name: 'Past day' },
  { id: 'w', name: 'Past week' },
  { id: 'm', name: 'Past month' },
  { id: 'y', name: 'Past year' },
];

// [DuckDuckGo region code, label, Bing market]
const REGION_TABLE = [
  ['wt-wt', 'All regions', 'en-US'],
  ['ar-es', 'Argentina', 'es-AR'],
  ['au-en', 'Australia', 'en-AU'],
  ['at-de', 'Austria', 'de-AT'],
  ['be-fr', 'Belgium (fr)', 'fr-BE'],
  ['be-nl', 'Belgium (nl)', 'nl-BE'],
  ['br-pt', 'Brazil', 'pt-BR'],
  ['ca-en', 'Canada (en)', 'en-CA'],
  ['ca-fr', 'Canada (fr)', 'fr-CA'],
  ['cl-es', 'Chile', 'es-CL'],
  ['cn-zh', 'China', 'zh-CN'],
  ['cz-cs', 'Czech Republic', 'cs-CZ'],
  ['dk-da', 'Denmark', 'da-DK'],
  ['fi-fi', 'Finland', 'fi-FI'],
  ['fr-fr', 'France', 'fr-FR'],
  ['de-de', 'Germany', 'de-DE'],
  ['gr-el', 'Greece', 'el-GR'],
  ['hk-tzh', 'Hong Kong', 'zh-HK'],
  ['in-en', 'India', 'en-IN'],
  ['id-id', 'Indonesia', 'id-ID'],
  ['ie-en', 'Ireland', 'en-IE'],
  ['il-he', 'Israel', 'he-IL'],
  ['it-it', 'Italy', 'it-IT'],
  ['jp-jp', 'Japan', 'ja-JP'],
  ['kr-kr', 'Korea', 'ko-KR'],
  ['mx-es', 'Mexico', 'es-MX'],
  ['nl-nl', 'Netherlands', 'nl-NL'],
  ['nz-en', 'New Zealand', 'en-NZ'],
  ['no-no', 'Norway', 'nb-NO'],
  ['ph-en', 'Philippines', 'en-PH'],
  ['pl-pl', 'Poland', 'pl-PL'],
  ['pt-pt', 'Portugal', 'pt-PT'],
  ['ro-ro', 'Romania', 'ro-RO'],
  ['ru-ru', 'Russia', 'ru-RU'],
  ['xa-ar', 'Saudi Arabia', 'ar-SA'],
  ['sg-en', 'Singapore', 'en-SG'],
  ['za-en', 'South Africa', 'en-ZA'],
  ['es-es', 'Spain', 'es-ES'],
  ['se-sv', 'Sweden', 'sv-SE'],
  ['ch-de', 'Switzerland (de)', 'de-CH'],
  ['ch-fr', 'Switzerland (fr)', 'fr-CH'],
  ['tw-tzh', 'Taiwan', 'zh-TW'],
  ['th-th', 'Thailand', 'th-TH'],
  ['tr-tr', 'Turkey', 'tr-TR'],
  ['ua-uk', 'Ukraine', 'uk-UA'],
  ['uk-en', 'United Kingdom', 'en-GB'],
  ['us-en', 'United States', 'en-US'],
  ['vn-vi', 'Vietnam', 'vi-VN'],
];

const WIKI_LANG = { nb: 'no' };

export const REGIONS = REGION_TABLE.map(([code, name, market]) => {
  const [lang, country] = market.split('-');
  return {
    code,
    name,
    market,
    lang,
    country,
    wiki: WIKI_LANG[lang] || lang,
    acceptLanguage: lang === 'en' ? `${market},en;q=0.8` : `${market},${lang};q=0.8,en;q=0.5`,
  };
});
const REGION_BY_CODE = new Map(REGIONS.map((r) => [r.code, r]));
export const getRegion = (code) => REGION_BY_CODE.get(code) || REGION_BY_CODE.get('wt-wt');

export const DEFAULT_WEB_ENGINES = ['duckduckgo', 'bing', 'wikipedia', 'marginalia'];
export const DEFAULT_TORRENT_SOURCES = ['piratebay', 'nyaa', 'torrentscsv', 'knaben', 'archive'];
export const SEARCH_TYPES = ['web', 'images', 'videos', 'news', 'torrents'];
export const FRONTEND_SERVICES = ['youtube', 'reddit', 'twitter', 'medium'];

const bool = (key, value) => ({ key, type: 'bool', default: value });
const oneOf = (key, values, value) => ({ key, type: 'enum', values, default: value });

// Every preference: cookie key, type, default and allowed values.
export const SCHEMA = {
  // General
  home: oneOf('hm', SEARCH_TYPES, 'web'),
  newTab: bool('nt', false),
  infinite: bool('is', false),
  shortcuts: bool('ks', true),
  // Appearance
  theme: oneOf('th', THEMES.map((t) => t.id), 'system'),
  size: oneOf('fs', ['s', 'm', 'l'], 'm'),
  density: oneOf('dn', ['comfortable', 'compact'], 'comfortable'),
  // Search
  region: oneOf('kl', REGION_TABLE.map((r) => r[0]), 'wt-wt'),
  safe: oneOf('kp', SAFE_LEVELS.map((s) => s.id), 'moderate'),
  suggest: oneOf('ac', ['ddg', 'bangs', 'off'], 'ddg'),
  instant: bool('ia', true),
  infobox: bool('ib', true),
  related: bool('rs', true),
  bold: bool('hl', true),
  favicons: bool('fi', true),
  engines: { key: 'we', type: 'ids', default: DEFAULT_WEB_ENGINES },
  blockSites: { key: 'bs', type: 'domains', default: [] },
  boostSites: { key: 'bo', type: 'domains', default: [] },
  // Privacy & security
  etp: oneOf('tp', ['standard', 'strict', 'custom'], 'standard'),
  strip: oneOf('sp', ['known', 'aggressive', 'off'], 'known'),
  unwrap: bool('uw', true),
  amp: bool('am', true),
  adblock: bool('ab', false),
  https: oneOf('hs', ['upgrade', 'mark', 'off'], 'upgrade'),
  fe_youtube: oneOf('fy', ['off', 'invidious', 'piped'], 'off'),
  fe_reddit: oneOf('fr', ['off', 'old', 'redlib'], 'off'),
  fe_twitter: oneOf('fx', ['off', 'nitter', 'xcancel'], 'off'),
  fe_medium: oneOf('fm', ['off', 'scribe'], 'off'),
  fi_youtube: { key: 'yi', type: 'origin', default: '' },
  fi_reddit: { key: 'ri', type: 'origin', default: '' },
  fi_twitter: { key: 'xi', type: 'origin', default: '' },
  fi_medium: { key: 'mi', type: 'origin', default: '' },
  gpc: bool('gp', true),
  dnt: bool('dt', false),
  referrer: oneOf('rf', ['none', 'origin'], 'none'),
  keep: oneOf('kd', ['365', '30', 'session'], '365'),
  post: bool('po', false),
  hideQuery: bool('nq', false),
  sound: bool('sd', true),
  proxyImages: bool('pi', true),
  safeBrowsing: oneOf('sb', ['warn', 'hide', 'off'], 'warn'),
  safeDownloads: oneOf('sl', ['warn', 'hide', 'off'], 'warn'),
  level: oneOf('lv', ['standard', 'safer', 'safest'], 'standard'),
  // Torrents
  torrents: { key: 'ts', type: 'ids', default: DEFAULT_TORRENT_SOURCES },
  torrentSort: oneOf('to', ['best', 'seeders', 'newest', 'largest', 'smallest'], 'best'),
  minSeeders: oneOf('tm', ['0', '1', '5', '20'], '0'),
  trackers: bool('tt', true),
};

// Enhanced Tracking Protection presets. "Custom" keeps individual choices.
export const ETP_PRESETS = {
  standard: { strip: 'known', unwrap: true, amp: true, adblock: false },
  strict: { strip: 'aggressive', unwrap: true, amp: true, adblock: true },
};

export const DEFAULT_PREFS = Object.freeze(derive(Object.fromEntries(Object.entries(SCHEMA).map(([name, spec]) => [name, spec.default]))));

export const COOKIE_NAME = 'cut';

const ORIGIN_RE = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;
export function parseOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && ORIGIN_RE.test(url.origin) ? url.origin : '';
  } catch {
    return '';
  }
}

function parseDomains(value, max = 40) {
  const out = [];
  for (const raw of String(value || '').split(/[\s,;]+/)) {
    const entry = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^\*\./, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (entry && /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(entry) && !out.includes(entry)) out.push(entry);
    if (out.length >= max) break;
  }
  return out;
}

// Parses one stored or submitted value; returns undefined when invalid.
function parseValue(spec, value, allowed) {
  switch (spec.type) {
    case 'bool':
      return value === '1' || value === 'on' ? true : value === '0' ? false : undefined;
    case 'enum':
      if (spec.key === 'ac' && (value === '1' || value === '0')) return value === '1' ? 'ddg' : 'off'; // older cookies
      return spec.values.includes(value) ? value : undefined;
    case 'ids':
      return value === '' ? [] : [...new Set(String(value).split(/[.,]/).filter((id) => allowed.includes(id)))];
    case 'domains':
      return parseDomains(value);
    case 'origin':
      return value === '' ? '' : parseOrigin(value) || undefined;
    default:
      return undefined;
  }
}

function derive(prefs) {
  if (prefs.etp !== 'custom' && ETP_PRESETS[prefs.etp]) Object.assign(prefs, ETP_PRESETS[prefs.etp]);
  prefs.frontends = Object.fromEntries(FRONTEND_SERVICES.map((s) => [s, prefs[`fe_${s}`]]));
  prefs.frontendInstances = Object.fromEntries(FRONTEND_SERVICES.map((s) => [s, prefs[`fi_${s}`]]));
  return prefs;
}

const allowedFor = (name, knownEngines, knownSources) => (name === 'engines' ? knownEngines : name === 'torrents' ? knownSources : []);

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (key) out[key] = part.slice(i + 1).trim();
  }
  return out;
}

function fromParams(params, knownEngines, knownSources) {
  const prefs = {};
  for (const [name, spec] of Object.entries(SCHEMA)) {
    const raw = params.get(spec.key);
    const value = raw === null ? undefined : parseValue(spec, raw, allowedFor(name, knownEngines, knownSources));
    prefs[name] = value === undefined ? structuredClone(spec.default) : value;
  }
  return derive(prefs);
}

// `knownEngines` / `knownSources` are passed in to avoid a circular import.
export function readPrefs(cookieHeader, knownEngines, knownSources) {
  const raw = parseCookies(cookieHeader)[COOKIE_NAME];
  if (!raw) return structuredClone(DEFAULT_PREFS);
  try {
    return fromParams(new URLSearchParams(decodeURIComponent(raw)), knownEngines, knownSources);
  } catch {
    return structuredClone(DEFAULT_PREFS);
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Only values that differ from the defaults are written.
export function serializePrefs(prefs) {
  const params = new URLSearchParams();
  for (const [name, spec] of Object.entries(SCHEMA)) {
    const value = prefs[name];
    if (value === undefined || same(value, spec.default)) continue;
    if (spec.type === 'bool') params.set(spec.key, value ? '1' : '0');
    else if (spec.type === 'ids') params.set(spec.key, value.join('.'));
    else if (spec.type === 'domains') params.set(spec.key, value.join(','));
    else params.set(spec.key, String(value));
  }
  return encodeURIComponent(params.toString());
}

// Applies submitted form fields on top of existing prefs. A full settings form
// sends `_full=1`, meaning unchecked boxes and empty lists count as "off".
export function mergePrefs(current, form, knownEngines, knownSources) {
  const next = { ...current };
  const full = form.get('_full') === '1';
  for (const [name, spec] of Object.entries(SCHEMA)) {
    const allowed = allowedFor(name, knownEngines, knownSources);
    if (spec.type === 'ids') {
      if (full || form.has(name)) next[name] = [...new Set(form.getAll(name).filter((id) => allowed.includes(id)))];
      continue;
    }
    if (!form.has(name)) {
      if (full && spec.type === 'bool') next[name] = false;
      continue;
    }
    const value = spec.type === 'bool' ? (form.get(name) === '1' || form.get(name) === 'on' ? true : false) : parseValue(spec, form.get(name), allowed);
    if (value !== undefined) next[name] = value;
  }
  return derive(next);
}

// Portable settings code: move settings between browsers without an account.
export const exportCode = (prefs) => 'cut1.' + Buffer.from(decodeURIComponent(serializePrefs(prefs))).toString('base64url');

export function importCode(code, knownEngines, knownSources) {
  const match = String(code || '').trim().match(/^cut1\.([A-Za-z0-9_-]*)$/);
  if (!match) return null;
  try {
    return fromParams(new URLSearchParams(Buffer.from(match[1], 'base64url').toString('utf8')), knownEngines, knownSources);
  } catch {
    return null;
  }
}

// What the security level and image settings actually allow on a page.
export function features(prefs) {
  const level = prefs.level;
  return {
    js: level !== 'safest',
    webfont: level === 'standard',
    favicons: prefs.favicons && level === 'standard',
    thumbnails: level === 'standard',
    images: level !== 'safest',
    proxyImages: prefs.proxyImages,
  };
}

export const cookieMaxAge = (prefs) => (prefs.keep === 'session' ? null : Number(prefs.keep) * 86400);
