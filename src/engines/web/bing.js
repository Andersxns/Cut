import * as cheerio from 'cheerio';
import { fetchUpstream, UpstreamError } from '../../http.js';
import { squash } from '../../util/text.js';

// Bing wraps every result in a click-tracking redirect:
// https://www.bing.com/ck/a?...&u=a1<base64url(target)>. We decode it so the
// link you click goes straight to the site.
export function decodeBingUrl(href) {
  if (!href) return '';
  try {
    const url = new URL(href, 'https://www.bing.com');
    if (url.hostname.endsWith('bing.com') && url.pathname.startsWith('/ck/a')) {
      const u = url.searchParams.get('u') || '';
      if (u.startsWith('a1')) return Buffer.from(u.slice(2), 'base64url').toString('utf8');
      return '';
    }
    if (url.hostname.endsWith('bing.com') && url.pathname.startsWith('/news/apiclick')) {
      return url.searchParams.get('url') || '';
    }
    return url.toString();
  } catch {
    return '';
  }
}

const ADULT = { strict: 'STRICT', moderate: 'DEMOTE', off: 'OFF' };

export function bingCookie(p) {
  const mkt = p.region.market.toLowerCase();
  return `SRCHHPGUSR=ADLT=${ADULT[p.safe]}; _EDGE_CD=m=${mkt}&u=${mkt}; _EDGE_S=mkt=${mkt}&ui=${mkt}`;
}

function timeFilter(time) {
  if (!time) return null;
  if (time === 'y') {
    const today = Math.floor(Date.now() / 86_400_000);
    return `ex1:"ez5_${today - 365}_${today}"`;
  }
  return `ex1:"ez${{ d: 1, w: 2, m: 3 }[time]}"`;
}

export default {
  id: 'bing',
  name: 'Bing',
  description: "Microsoft's web index — strong coverage and fresh results.",
  weight: 1.0,
  core: true,
  timeout: 4000,
  paging: true,
  async search(p) {
    const params = new URLSearchParams({
      q: p.query,
      setlang: p.region.lang,
      cc: p.region.country,
      mkt: p.region.market,
      first: String((p.page - 1) * 10 + 1),
      FORM: p.page > 1 ? 'PERE' : 'QBLH',
      adlt: p.safe === 'moderate' ? 'moderate' : p.safe,
    });
    const filter = timeFilter(p.time);
    if (filter) params.set('filters', filter);
    const page = await fetchUpstream('https://www.bing.com/search?' + params, {
      timeout: p.timeout,
      lang: p.region.acceptLanguage,
      headers: { Cookie: bingCookie(p) },
    });
    const $ = cheerio.load(page);
    if (!$('#b_results').length) {
      throw new UpstreamError('unexpected page', { code: /captcha|challenge/i.test(page) ? 'captcha' : 'parse' });
    }
    const results = [];
    $('#b_results > li.b_algo').each((_, el) => {
      const item = $(el);
      const link = item.find('h2 a').first();
      const url = decodeBingUrl(link.attr('href'));
      if (!url || !/^https?:/.test(url)) return;
      const caption = item.find('.b_caption p').first().length ? item.find('.b_caption p').first() : item.find('p').first();
      caption.find('.news_dt, .algoSlug_icon, a.b_algoReadMore').remove();
      const snippet = squash(caption.text()).replace(/^[·\s]+/, '');
      const siteName = squash(item.find('.tptt').first().text());
      results.push({ url, title: squash(link.text()), snippet, siteName });
    });
    return results;
  },
};
