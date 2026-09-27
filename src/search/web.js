import { WEB_ENGINES } from '../engines/registry.js';
import { cleanUrl, urlKey, hostname, parseUrl } from '../util/url.js';
import { runEngines, summarize } from './run.js';
import { applyResultPrefs } from '../privacy/results.js';
import { significantTokens } from '../util/text.js';

// Weighted reciprocal-rank fusion. A page that several engines agree on
// rises; a page only one engine ranks low stays low.
const RRF_K = 6;

export function mergeWeb(outcomes) {
  const byKey = new Map();
  for (const { engine, results } of outcomes) {
    results.forEach((result, rank) => {
      if (!result.url || !parseUrl(result.url)) return;
      const url = cleanUrl(result.url);
      const key = urlKey(url);
      const official = /^official (site|website)$/i.test(result.title || '');
      let entry = byKey.get(key);
      if (!entry) {
        entry = { url, key, title: official ? '' : result.title || '', snippet: result.snippet || '', siteName: result.siteName || '', engines: [], score: 0, official };
        byKey.set(key, entry);
      } else {
        if (official) entry.official = true;
        else if (!entry.title) entry.title = result.title || '';
        if ((result.snippet || '').length > entry.snippet.length) entry.snippet = result.snippet;
        if (!entry.siteName && result.siteName) entry.siteName = result.siteName;
        if (url.startsWith('https:') && entry.url.startsWith('http:')) entry.url = url;
      }
      if (!entry.engines.includes(engine.id)) {
        entry.engines.push(engine.id);
        entry.score += engine.weight / (RRF_K + rank + 1);
      }
    });
  }

  const list = [...byKey.values()];
  for (const entry of list) {
    if (!entry.title) entry.title = entry.siteName || hostname(entry.url);
    if (entry.engines.length > 1) entry.score *= 1 + 0.15 * (entry.engines.length - 1);
  }
  list.sort((a, b) => b.score - a.score);

  // Gentle domain diversity: the third and later hits from one site sink a bit.
  const perHost = new Map();
  for (const entry of list) {
    const host = hostname(entry.url);
    const n = (perHost.get(host) || 0) + 1;
    perHost.set(host, n);
    if (n > 2) entry.score *= 0.75 ** (n - 2);
  }
  return list.sort((a, b) => b.score - a.score);
}

// Some engines answer traffic they take for a bot with unrelated results
// (Bing will return household chemicals for "rust ownership") instead of an
// error. An answer in which almost nothing mentions any word of the query is
// treated as a failed request. Returns a reason, or null if it looks fine.
export function offTopic(results, query) {
  const terms = significantTokens(query).filter((t) => t.length >= 3);
  if (!terms.length || results.length < 4) return null;
  const onTopic = results.filter((r) => {
    const text = `${r.title} ${r.snippet} ${r.url}`.toLowerCase();
    return terms.some((t) => text.includes(t));
  }).length;
  return onTopic / results.length < 0.2 ? `${results.length - onTopic} of ${results.length} results were unrelated to the query` : null;
}

export async function searchWeb(ctx) {
  const engines = WEB_ENGINES.filter(
    (e) => ctx.prefs.engines.includes(e.id) && (ctx.page === 1 || e.paging) && (!ctx.time || e.supportsTime),
  );
  const { outcomes, ms } = await runEngines(
    'web',
    engines,
    {
      query: ctx.query,
      page: ctx.page,
      region: ctx.region,
      safe: ctx.safe,
      time: ctx.time,
    },
    { validate: (results) => offTopic(results, ctx.query) },
  );
  return {
    results: applyResultPrefs(mergeWeb(outcomes), ctx.prefs, { rerank: true }),
    sources: summarize(outcomes),
    ms,
    hasMore: outcomes.some((o) => o.ok && o.engine.paging && o.results.length >= 5),
  };
}
