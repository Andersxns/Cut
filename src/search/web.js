import { WEB_ENGINES } from '../engines/registry.js';
import { cleanUrl, urlKey, hostname, parseUrl } from '../util/url.js';
import { runEngines, summarize } from './run.js';
import { applyResultPrefs } from '../privacy/results.js';
import { relevanceTerms, mentionedTerms } from '../util/text.js';

// Weighted reciprocal-rank fusion. A page that several engines agree on
// rises; a page only one engine ranks low stays low.
const RRF_K = 6;

// What a result is judged on: its title, snippet and address (the address's
// separators read as spaces, so /rocket-league/ counts).
const resultText = (r) => `${r.title || ''} ${r.snippet || ''} ${String(r.url || '').replace(/[/._\-+=?&#:%]+/g, ' ')}`;

export function mergeWeb(outcomes, query = '') {
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
  // Results that mention more of the search's words rank higher. One that
  // mentions a single word of a longer search sinks: it's usually about
  // something else that shares the word ("overtime pay" for "overtime in
  // rocket league").
  const terms = relevanceTerms(query);
  for (const entry of list) {
    if (!entry.title) entry.title = entry.siteName || hostname(entry.url);
    if (entry.engines.length > 1) entry.score *= 1 + 0.15 * (entry.engines.length - 1);
    if (terms.length >= 2) entry.score *= 0.5 + (0.5 * mentionedTerms(resultText(entry), terms).length) / terms.length;
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
  const terms = relevanceTerms(query);
  if (!terms.length || results.length < 4) return null;
  const onTopic = results.filter((r) => mentionedTerms(resultText(r), terms).length).length;
  return onTopic / results.length < 0.2 ? `${results.length - onTopic} of ${results.length} results were unrelated to the query` : null;
}

// Bing also answers such traffic with results for just one word of the
// search: "overtime in rocket league" gets overtime pay and sports apparel.
// Those mention a word of the query, so they pass offTopic; but they never
// mention words that the other engines' results are full of. An engine
// whose answer misses such a word was answering a different search, and is
// left out (unless every engine would be, when there's nothing to compare).
export function dropOutliers(outcomes, query) {
  const terms = relevanceTerms(query);
  const answered = outcomes.filter((o) => o.ok && o.results.length >= 3);
  if (terms.length < 2 || answered.length < 2) return outcomes;
  const mentions = new Map(answered.map((o) => [o, o.results.map((r) => mentionedTerms(resultText(r), terms))]));
  const outliers = new Set(
    answered.filter((outcome) => {
      const others = answered.filter((o) => o !== outcome).flatMap((o) => mentions.get(o));
      if (others.length < 4) return false;
      const own = mentions.get(outcome);
      return terms.some((t) => !own.some((m) => m.includes(t)) && others.filter((m) => m.includes(t)).length >= 0.4 * others.length);
    }),
  );
  if (!outliers.size || outliers.size === answered.length) return outcomes;
  return outcomes.map((o) => (outliers.has(o) ? { ...o, ok: false, error: 'offtopic', results: [] } : o));
}

// The engines a search asks: the ones you turned on (and gave a key, if they
// need one) that can answer this page and time filter.
export const webEnginesFor = (ctx) =>
  WEB_ENGINES.filter(
    (e) => ctx.prefs.engines.includes(e.id) && (!e.keyPref || ctx.prefs[e.keyPref]) && (ctx.page === 1 || e.paging) && (!ctx.time || e.supportsTime),
  );

export async function searchWeb(ctx) {
  const engines = webEnginesFor(ctx);
  const { outcomes, ms } = await runEngines(
    'web',
    engines,
    {
      query: ctx.query,
      page: ctx.page,
      region: ctx.region,
      safe: ctx.safe,
      time: ctx.time,
      keys: Object.fromEntries(engines.filter((e) => e.keyPref).map((e) => [e.id, ctx.prefs[e.keyPref]])),
    },
    { validate: (results) => offTopic(results, ctx.query) },
  );
  const kept = dropOutliers(outcomes, ctx.query);
  return {
    results: applyResultPrefs(mergeWeb(kept, ctx.query), ctx.prefs, { rerank: true }),
    sources: summarize(kept),
    ms,
    hasMore: kept.some((o) => o.ok && o.engine.paging && o.results.length >= 5),
  };
}
