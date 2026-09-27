import { fetchUpstream } from '../../http.js';
import { stripTags, squash } from '../../util/text.js';

// Wikipedia and three independent, non-commercial indexes.

export const wikipedia = {
  id: 'wikipedia',
  name: 'Wikipedia',
  description: 'Encyclopedia articles in your region’s language.',
  weight: 0.7,
  timeout: 3000,
  paging: false,
  async search(p) {
    if (p.page > 1) return [];
    const lang = p.region.wiki;
    const url = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({
      action: 'query', list: 'search', srsearch: p.query, srlimit: '4', srprop: 'snippet|timestamp', format: 'json', utf8: '1',
    });
    const data = await fetchUpstream(url, { timeout: p.timeout, as: 'json', headers: { Accept: 'application/json' } });
    return (data?.query?.search || []).map((item) => ({
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
      title: `${item.title} - Wikipedia`,
      snippet: squash(stripTags(item.snippet)),
      siteName: 'Wikipedia',
    }));
  },
};

export const marginalia = {
  id: 'marginalia',
  name: 'Marginalia',
  description: 'Independent index of the non-commercial, human-made web.',
  weight: 0.35,
  timeout: 3000,
  paging: true,
  async search(p) {
    const url = `https://api.marginalia.nu/public/search/${encodeURIComponent(p.query)}?count=10&page=${p.page}`;
    const data = await fetchUpstream(url, { timeout: p.timeout, as: 'json', headers: { Accept: 'application/json' } });
    return (data?.results || []).map((item) => ({
      url: item.url,
      title: squash(item.title) || item.url,
      snippet: squash(item.description),
    }));
  },
};

export const mwmbl = {
  id: 'mwmbl',
  name: 'Mwmbl',
  description: 'Open-source, community-crawled non-profit search index.',
  weight: 0.3,
  timeout: 3000,
  paging: false,
  async search(p) {
    if (p.page > 1) return [];
    const data = await fetchUpstream('https://api.mwmbl.org/search?' + new URLSearchParams({ s: p.query }), {
      timeout: p.timeout,
      as: 'json',
      headers: { Accept: 'application/json' },
    });
    const join = (parts) => squash((parts || []).map((x) => x.value).join(''));
    return (Array.isArray(data) ? data : []).slice(0, 10).map((item) => ({
      url: item.url,
      title: join(item.title) || item.url,
      snippet: join(item.extract),
    }));
  },
};

export const wiby = {
  id: 'wiby',
  name: 'Wiby',
  description: 'Search engine for the classic, lightweight web.',
  weight: 0.2,
  timeout: 3000,
  paging: true,
  async search(p) {
    const data = await fetchUpstream('https://wiby.me/json/?' + new URLSearchParams({ q: p.query, p: String(p.page) }), {
      timeout: p.timeout,
      as: 'json',
      headers: { Accept: 'application/json' },
    });
    return (Array.isArray(data) ? data : []).slice(0, 10).map((item) => ({
      url: item.URL,
      title: squash(item.Title) || item.URL,
      snippet: squash(item.Snippet),
    }));
  },
};
