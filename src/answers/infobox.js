import { fetchUpstream } from '../http.js';
import { TTLCache, cacheKey } from '../util/cache.js';
import { squash, truncate, tokenize } from '../util/text.js';

// The knowledge panel beside web results. DuckDuckGo's Instant Answer API
// decides whether a query is about a well-known "thing"; Wikipedia fills in
// for other languages or when DuckDuckGo has nothing.

const cache = new TTLCache({ max: 1000, ttl: 6 * 3600_000 });

const PROFILE_URLS = {
  twitter_profile: (v) => ['X (Twitter)', `https://x.com/${v}`],
  instagram_profile: (v) => ['Instagram', `https://www.instagram.com/${v}`],
  facebook_profile: (v) => ['Facebook', `https://www.facebook.com/${v}`],
  youtube_channel: (v) => ['YouTube', `https://www.youtube.com/channel/${v}`],
  github_profile: (v) => ['GitHub', `https://github.com/${v}`],
  imdb_id: (v) => ['IMDb', `https://www.imdb.com/${v.startsWith('nm') ? 'name' : 'title'}/${v}`],
  spotify_artist_id: (v) => ['Spotify', `https://open.spotify.com/artist/${v}`],
  soundcloud_id: (v) => ['SoundCloud', `https://soundcloud.com/${v}`],
  rotten_tomatoes: (v) => ['Rotten Tomatoes', `https://www.rottentomatoes.com/${v}`],
  wikidata_id: (v) => ['Wikidata', `https://www.wikidata.org/wiki/${v}`],
};

async function fromDuckDuckGo(query) {
  const data = await fetchUpstream(
    'https://api.duckduckgo.com/?' + new URLSearchParams({ q: query, format: 'json', no_html: '1', skip_disambig: '1', no_redirect: '1' }),
    { timeout: 2500, as: 'json', headers: { Accept: 'application/json' } },
  );
  if (!data?.AbstractText || data.Type === 'D') return null;
  const content = data.Infobox?.content || [];
  const facts = content
    .filter((c) => c.data_type === 'string' && c.label && c.value && String(c.value).length < 140)
    .slice(0, 8)
    .map((c) => [c.label, squash(String(c.value))]);
  const links = [];
  const official = (data.Results || []).find((r) => /^official site/i.test(r.Text || ''))?.FirstURL || data.OfficialWebsite;
  if (official) links.push(['Official site', official]);
  for (const c of content) {
    const make = PROFILE_URLS[c.data_type];
    if (make && c.value && links.length < 7) links.push(make(String(c.value)));
  }
  const image = data.Image ? (data.Image.startsWith('/') ? 'https://duckduckgo.com' + data.Image : data.Image) : '';
  // Bare abstracts with no picture, facts or entity type are usually a
  // literal title match on something obscure ("python" → a Cold War plan).
  if (!image && !facts.length && !data.Entity) return null;
  return {
    title: data.Heading,
    description: truncate(data.AbstractText, 520),
    source: data.AbstractSource || 'Wikipedia',
    url: data.AbstractURL,
    image,
    logo: Number(data.ImageIsLogo) === 1,
    facts,
    links,
  };
}

const norm = (s) => tokenize(s).join(' ');

async function fromWikipedia(query, lang) {
  const search = await fetchUpstream(
    `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({ action: 'opensearch', search: query, limit: '1', namespace: '0', format: 'json' }),
    { timeout: 2500, as: 'json', headers: { Accept: 'application/json' } },
  );
  const title = search?.[1]?.[0];
  // Only show a panel when the article is clearly *the* subject of the query.
  if (!title || norm(title.replace(/\s*\(.*\)$/, '')) !== norm(query)) return null;
  const summary = await fetchUpstream(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, {
    timeout: 2500,
    as: 'json',
    headers: { Accept: 'application/json' },
  });
  if (!summary?.extract || summary.type === 'disambiguation') return null;
  return {
    title: summary.title,
    subtitle: summary.description || '',
    description: truncate(summary.extract, 520),
    source: 'Wikipedia',
    url: summary.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    image: summary.thumbnail?.source || '',
    logo: false,
    facts: [],
    links: [],
  };
}

export function getInfobox(query, region) {
  const words = query.trim().split(/\s+/);
  if (words.length > 7 || query.length > 80 || /^(how|why|what|when|where|who|which|is|are|can|does|do)\s/i.test(query)) return Promise.resolve(null);
  return cache
    .wrap(cacheKey('infobox', query.toLowerCase(), region.wiki), async () => {
      if (region.wiki !== 'en') return (await fromWikipedia(query, region.wiki).catch(() => null)) || (await fromDuckDuckGo(query).catch(() => null)) || false;
      return (await fromDuckDuckGo(query).catch(() => null)) || (await fromWikipedia(query, 'en').catch(() => null)) || false;
    })
    .then((v) => v || null)
    .catch(() => null);
}
