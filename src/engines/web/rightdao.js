import * as cheerio from 'cheerio';
import { fetchUpstream, UpstreamError } from '../../http.js';
import { squash } from '../../util/text.js';

// Right Dao: an independent web index from the US, with its own crawler. Free
// and without a key. Its results are in English and can be a few years old,
// and it has no safe search, so it sits out searches with safe search set to
// Strict.

const PAGE_SIZE = 12; // what Right Dao shows on a page

export function parseRightDao(page) {
  const $ = cheerio.load(page);
  if (!$('.results').length) throw new UpstreamError('unexpected page', { code: 'parse' });
  const results = [];
  $('div.item').each((_, el) => {
    const item = $(el);
    const link = item.find('div.title a').first();
    const url = link.attr('href') || '';
    if (!/^https?:\/\//.test(url)) return;
    const description = item.find('div.description').first();
    description.find('span.date').remove();
    results.push({
      url,
      title: squash(link.text()) || url,
      snippet: squash(description.text().replace(/​/g, '')),
    });
  });
  return results;
}

export default {
  id: 'rightdao',
  name: 'Right Dao',
  description: 'Independent web index with its own crawler. Results in English.',
  weight: 0.6,
  timeout: 3000,
  paging: true,
  async search(p) {
    if (p.safe === 'strict') return [];
    const params = new URLSearchParams({ q: p.query });
    if (p.page > 1) params.set('start', String((p.page - 1) * PAGE_SIZE + 1));
    const page = await fetchUpstream('https://rightdao.com/search?' + params, { timeout: p.timeout, lang: p.region.acceptLanguage });
    return parseRightDao(page);
  },
};
