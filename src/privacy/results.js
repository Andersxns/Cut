import { cleanLink, isAdDomain, matchesDomain } from './links.js';
import { threatFor, ensureThreatLists } from './threats.js';
import { hostname } from '../util/url.js';

// Applies the user's privacy and security preferences to a list of results
// that have a `url`: link cleaning, site blocking and preferring, ad-domain
// filtering and dangerous-site protection.
export function applyResultPrefs(results, prefs, { rerank = false } = {}) {
  const checkThreats = prefs.safeBrowsing !== 'off';
  if (checkThreats) ensureThreatLists();
  const out = [];
  for (const result of results) {
    const originalHost = hostname(result.url);
    const { url, insecure } = cleanLink(result.url, prefs);
    const host = hostname(url);
    if (prefs.blockSites.some((d) => matchesDomain(originalHost, d) || matchesDomain(host, d))) continue;
    if (prefs.adblock && isAdDomain(originalHost)) continue;
    const threat = checkThreats ? threatFor(originalHost) || threatFor(host) : null;
    if (threat && prefs.safeBrowsing === 'hide') continue;
    const boosted = prefs.boostSites.some((d) => matchesDomain(originalHost, d));
    out.push({ ...result, url, insecure, threat, boosted });
  }
  if (rerank && prefs.boostSites.length) {
    for (const r of out) if (r.boosted && r.score) r.score *= 1.8;
    out.sort((a, b) => (b.score || 0) - (a.score || 0));
  }
  return out;
}
