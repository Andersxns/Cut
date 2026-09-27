import { fetchUpstream } from '../http.js';
import { TTLCache, cacheKey } from '../util/cache.js';
import { stripTags, squash } from '../util/text.js';

const cache = new TTLCache({ max: 500, ttl: 24 * 3600_000 });

const PATTERNS = [
  /^define[:\s]+(.+)$/i,
  /^(?:meaning|definition|define) of\s+(.+)$/i,
  /^what does\s+(.+?)\s+mean\??$/i,
  /^(.+?)\s+(?:meaning|definition|define)$/i,
  /^dictionary\s+(.+)$/i,
];

async function lookup(word) {
  const data = await fetchUpstream(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`, {
    timeout: 2500,
    as: 'json',
    headers: { Accept: 'application/json' },
  }).catch((err) => (err.status === 404 ? null : Promise.reject(err)));
  return data?.en || null;
}

export function matchDefinition(query) {
  let word = null;
  for (const re of PATTERNS) {
    const m = query.trim().match(re);
    if (m) {
      word = m[1].trim().replace(/^["']|["']$/g, '');
      break;
    }
  }
  if (!word || word.length > 40 || word.split(/\s+/).length > 3 || !/^[\p{L}' -]+$/u.test(word)) return null;
  return async () => {
    const entries = await cache.wrap(cacheKey('define', word.toLowerCase()), async () => (await lookup(word)) || (await lookup(word.toLowerCase())) || []);
    const meanings = entries
      .map((entry) => ({
        partOfSpeech: entry.partOfSpeech,
        definitions: (entry.definitions || [])
          .map((d) => ({ text: squash(stripTags(d.definition)), example: squash(stripTags(d.examples?.[0] || '')) }))
          .filter((d) => d.text.length > 1)
          .slice(0, 3),
      }))
      .filter((m) => m.definitions.length)
      .slice(0, 3);
    if (!meanings.length) return null;
    return { type: 'define', word, meanings, url: `https://en.wiktionary.org/wiki/${encodeURIComponent(word.replace(/ /g, '_'))}` };
  };
}
