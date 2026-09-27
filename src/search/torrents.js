import { TORRENT_SOURCES } from '../engines/registry.js';
import { buildMagnet, guessCategory } from '../engines/torrents/common.js';
import { significantTokens, tokenize } from '../util/text.js';
import { runEngines, summarize } from './run.js';
import { downloadRisk } from '../privacy/threats.js';

export const SORTS = [
  { id: 'best', name: 'Best match' },
  { id: 'seeders', name: 'Most seeders' },
  { id: 'newest', name: 'Newest' },
  { id: 'largest', name: 'Largest' },
  { id: 'smallest', name: 'Smallest' },
];
export const SORT_IDS = SORTS.map((s) => s.id);
export const PAGE_SIZE = 30;

const TIME_WINDOWS = { d: 86_400_000, w: 7 * 86_400_000, m: 31 * 86_400_000, y: 366 * 86_400_000 };
const maxOrNull = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b));

// Several sources often index the same torrent; merge them by info-hash.
export function mergeTorrents(outcomes) {
  const byHash = new Map();
  for (const { results } of outcomes) {
    for (const item of results) {
      const ref = { id: item.source, url: item.url, via: item.via };
      const entry = byHash.get(item.hash);
      if (!entry) {
        byHash.set(item.hash, { ...item, sources: [ref] });
        continue;
      }
      if (!entry.sources.some((s) => s.id === ref.id)) entry.sources.push(ref);
      entry.seeders = maxOrNull(entry.seeders, item.seeders);
      entry.leechers = maxOrNull(entry.leechers, item.leechers);
      if (!entry.size && item.size) entry.size = item.size;
      if (item.date && (!entry.date || item.date < entry.date)) entry.date = item.date;
      if (entry.category === 'other' && item.category !== 'other') entry.category = item.category;
      entry.torrentUrl ||= item.torrentUrl;
      entry.files ??= item.files;
      entry.uploader ||= item.uploader;
      entry.trusted ||= item.trusted;
      entry.webseed ||= item.webseed;
      entry.virus = Math.max(entry.virus || 0, item.virus || 0);
      if (item.trackers) entry.trackers = [...new Set([...(entry.trackers || []), ...item.trackers])];
      if (item.webseeds) entry.webseeds = item.webseeds;
    }
  }
  return [...byHash.values()];
}

function relevance(name, terms) {
  if (!terms.length) return 1;
  const lower = name.toLowerCase();
  const words = new Set(tokenize(name));
  let hits = 0;
  // Short or numeric terms ("24", "04") must match a whole word; longer ones may
  // match inside a word ("ubuntu" in "ubuntu-desktop").
  for (const term of terms) if (words.has(term) || (term.length > 3 && !/^\d+$/.test(term) && lower.includes(term))) hits++;
  return hits / terms.length;
}

// Drops off-topic, dead, dangerous and (unless safe search is off) adult
// items, then scores what's left.
export function rankTorrents(list, query, safe, { minSeeders = 0, safeDownloads = 'off', publicTrackers = true } = {}) {
  const terms = significantTokens(query);
  const threshold = terms.length <= 2 ? 1 : 0.6;
  const ranked = [];
  for (const t of list) {
    if (safe !== 'off' && (t.category === 'xxx' || guessCategory(t.name) === 'xxx')) continue;
    if (minSeeders > 0 && !t.webseed && (t.seeders ?? 0) < minSeeders) continue;
    const rel = relevance(t.name, terms);
    if (rel < threshold) continue;
    t.risk = safeDownloads !== 'off' ? downloadRisk(t) : null;
    if (t.risk && safeDownloads === 'hide') continue;
    const seeds = t.seeders ?? (t.webseed ? 8 : 0);
    t.score = rel * 4 + Math.log10(seeds + 1) + (t.sources.length - 1) * 0.3 + (t.trusted ? 0.2 : 0);
    t.magnet = buildMagnet(t.hash, t.name, { trackers: t.trackers, webseeds: t.webseeds, publicTrackers });
    ranked.push(t);
  }
  return ranked;
}

const bySizeAsc = (a, b) => (a.size ? (b.size ? a.size - b.size : -1) : b.size ? 1 : 0);
const SORTERS = {
  best: (a, b) => b.score - a.score,
  seeders: (a, b) => (b.seeders ?? (b.webseed ? 0 : -1)) - (a.seeders ?? (a.webseed ? 0 : -1)) || b.score - a.score,
  newest: (a, b) => (b.date || 0) - (a.date || 0),
  largest: (a, b) => (b.size || 0) - (a.size || 0),
  smallest: bySizeAsc,
};

export async function searchTorrents(ctx) {
  const sources = TORRENT_SOURCES.filter((s) => ctx.prefs.torrents.includes(s.id));
  // Sources are always queried for every category; filtering happens here so
  // switching category or sort is instant and served from cache.
  const { outcomes, ms } = await runEngines('torrent', sources, {
    query: ctx.query,
    page: 1,
    region: ctx.region,
    safe: ctx.safe,
    time: '',
  });
  let all = rankTorrents(mergeTorrents(outcomes), ctx.query, ctx.safe, {
    minSeeders: Number(ctx.prefs.minSeeders) || 0,
    safeDownloads: ctx.prefs.safeDownloads,
    publicTrackers: ctx.prefs.trackers,
  });
  if (ctx.time && TIME_WINDOWS[ctx.time]) {
    const since = Date.now() - TIME_WINDOWS[ctx.time];
    all = all.filter((t) => t.date >= since);
  }
  const counts = { all: all.length };
  for (const t of all) counts[t.category] = (counts[t.category] || 0) + 1;
  const filtered = ctx.cat === 'all' ? all : all.filter((t) => t.category === ctx.cat);
  filtered.sort(SORTERS[ctx.sort] || SORTERS.best);
  const start = (ctx.page - 1) * PAGE_SIZE;
  return {
    results: filtered.slice(start, start + PAGE_SIZE),
    total: filtered.length,
    counts,
    sources: summarize(outcomes),
    ms,
    hasMore: start + PAGE_SIZE < filtered.length,
  };
}
