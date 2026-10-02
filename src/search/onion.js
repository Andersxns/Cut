import { ahmia } from '../engines/onion/ahmia.js';
import { runEngines, summarize } from './run.js';
import { applyResultPrefs } from '../privacy/results.js';
import { bannedOnions, isBannedOnion, mentionsAbuse, isExplicit } from '../privacy/abuse.js';
import { urlKey } from '../util/url.js';

// Onion sites, found by Ahmia. Only over Tor: Cut asks Ahmia at its onion
// address, and onion sites open only through Tor anyway.

const PAGE_SIZE = 20;

export const onionAvailable = (network) => network.mode === 'tor';

// Ahmia's list of banned sites is 2 MB, which takes a while over Tor; over
// Tor, the first search of any kind starts fetching it.
export function prepareOnionSearch(network) {
  if (onionAvailable(network)) bannedOnions(ahmia.timeout);
}

export async function searchOnion(ctx) {
  if (!onionAvailable(ctx.network)) return { results: [], sources: [], ms: 0, unavailable: true };
  if (mentionsAbuse(ctx.query)) return { results: [], sources: [], ms: 0, refused: true };
  // Ahmia answers with every match at once, so each page after the first
  // comes out of the same (cached) answer.
  const [{ outcomes, ms }, banned] = await Promise.all([
    runEngines('onion', [ahmia], { query: ctx.query, page: 1, region: ctx.region, safe: ctx.safe, time: ctx.time }),
    bannedOnions(ahmia.timeout),
  ]);
  const seen = new Set();
  const kept = outcomes[0].results.filter((r) => {
    const text = `${r.title} ${r.snippet} ${r.url}`;
    const key = urlKey(r.url);
    if (seen.has(key)) return false; // Ahmia lists some pages twice
    seen.add(key);
    return !isBannedOnion(r.url, banned) && !mentionsAbuse(text) && (ctx.safe !== 'strict' || !isExplicit(text));
  });
  const start = (ctx.page - 1) * PAGE_SIZE;
  return {
    results: applyResultPrefs(kept.slice(start, start + PAGE_SIZE), ctx.prefs),
    sources: summarize(outcomes),
    ms,
    hasMore: kept.length > start + PAGE_SIZE,
  };
}
