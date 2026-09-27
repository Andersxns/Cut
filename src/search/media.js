import { MEDIA_ENGINES } from '../engines/registry.js';
import { cleanUrl, urlKey } from '../util/url.js';
import { runEngines, summarize } from './run.js';
import { applyResultPrefs } from '../privacy/results.js';

// Images, news and videos: ask the primary engine; if it fails or comes back
// empty, ask the fallback. News additionally blends both for wider coverage.
export async function searchMedia(kind, ctx) {
  const [primary, fallback] = MEDIA_ENGINES[kind];
  const params = { query: ctx.query, page: ctx.page, region: ctx.region, safe: ctx.safe, time: ctx.time, extra: ctx.filters };
  const blend = kind === 'news';
  const first = await runEngines(kind, blend ? [primary, fallback] : [primary], params);
  let outcomes = first.outcomes;
  let ms = first.ms;
  if (!blend && (!outcomes[0].ok || !outcomes[0].results.length)) {
    const second = await runEngines(kind, [fallback], params);
    outcomes = [...outcomes, ...second.outcomes];
    ms += second.ms;
  }

  const seen = new Set();
  let results = [];
  const lists = outcomes.filter((o) => o.ok).map((o) => o.results);
  if (blend) {
    // Interleave the two news feeds, dropping duplicates.
    for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) {
      for (const list of lists) if (list[i]) results.push(list[i]);
    }
  } else {
    results = lists.flat();
  }
  results = results.filter((r) => {
    if (!r.url) return false;
    const key = kind === 'images' ? r.image : urlKey(cleanUrl(r.url));
    const titleKey = kind === 'news' ? r.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') : '';
    if (seen.has(key) || (titleKey && seen.has(titleKey))) return false;
    seen.add(key);
    if (titleKey) seen.add(titleKey);
    return true;
  });
  results = applyResultPrefs(results, ctx.prefs);
  if (kind === 'news' && ctx.sort === 'newest') results.sort((a, b) => (b.date || 0) - (a.date || 0));
  return { results, sources: summarize(outcomes), ms, hasMore: results.length >= 20 };
}
