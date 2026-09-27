import * as cheerio from 'cheerio';
import { fetchUpstream } from '../../http.js';
import { hostname } from '../../util/url.js';
import { squash, stripTags, toTimestamp } from '../../util/text.js';
import { getVqd, ddgJson, DDG_SAFE } from '../ddg-common.js';
import { decodeBingUrl, bingCookie } from '../web/bing.js';

export const ddgNews = {
  id: 'duckduckgo',
  name: 'DuckDuckGo',
  weight: 1,
  timeout: 5000,
  async search(p) {
    const vqd = await getVqd(p.query, p.region);
    const params = { l: p.region.code, o: 'json', noamp: '1', q: p.query, vqd, p: DDG_SAFE[p.safe] };
    if (p.time && p.time !== 'y') params.df = p.time;
    if (p.page > 1) params.s = String((p.page - 1) * 30);
    const data = await ddgJson('news.js', params, p.region, p.timeout);
    return (data?.results || []).map((r) => ({
      url: r.url,
      title: squash(r.title),
      excerpt: squash(stripTags(r.excerpt)),
      source: r.source || hostname(r.url),
      date: toTimestamp(r.date),
      image: r.image || '',
    }));
  },
};

const BING_NEWS_TIME = { d: 'interval="7"', w: 'interval="8"', m: 'interval="9"' };

export const bingNews = {
  id: 'bing',
  name: 'Bing News',
  weight: 0.8,
  timeout: 5000,
  async search(p) {
    const params = new URLSearchParams({ q: p.query, format: 'rss', setlang: p.region.lang, cc: p.region.country, mkt: p.region.market });
    if (p.page > 1) params.set('first', String((p.page - 1) * 10 + 1));
    if (BING_NEWS_TIME[p.time]) params.set('qft', BING_NEWS_TIME[p.time]);
    const xml = await fetchUpstream('https://www.bing.com/news/search?' + params, {
      timeout: p.timeout,
      lang: p.region.acceptLanguage,
      headers: { Accept: 'application/rss+xml, application/xml', Cookie: bingCookie(p) },
    });
    const $ = cheerio.load(xml, { xmlMode: true });
    const results = [];
    $('item').each((_, el) => {
      const item = $(el);
      const url = decodeBingUrl(item.find('link').first().text().trim());
      if (!url) return;
      const image = item.find('News\\:Image').first().text().trim();
      results.push({
        url,
        title: squash(item.find('title').first().text()),
        excerpt: squash(stripTags(item.find('description').first().text())),
        source: squash(item.find('News\\:Source').first().text()) || hostname(url),
        date: toTimestamp(item.find('pubDate').first().text()),
        image: image ? image.replace(/&amp;/g, '&') + (image.includes('?') ? '&w=300&h=180&c=7' : '') : '',
      });
    });
    return results;
  },
};
