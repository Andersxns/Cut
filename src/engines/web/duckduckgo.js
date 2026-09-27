import * as cheerio from 'cheerio';
import { fetchUpstream, UpstreamError } from '../../http.js';
import { TTLCache, cacheKey } from '../../util/cache.js';
import { squash } from '../../util/text.js';
import { DDG_SAFE, unwrapDdgUrl, isDdgAd, looksLikeCaptcha } from '../ddg-common.js';

// DuckDuckGo's no-JS endpoint. Follow-up pages must replay the exact
// "Next" form (including its vqd token) from the previous page, so we keep
// those forms briefly in memory.
const nextForms = new TTLCache({ max: 500, ttl: 20 * 60_000 });
const formKey = (p, page) => cacheKey('ddg-form', p.query, p.region.code, p.safe, p.time, page);

function cookieFor(p) {
  return [`kl=${p.region.code}`, `kp=${DDG_SAFE[p.safe]}`, p.time && `df=${p.time}`].filter(Boolean).join('; ');
}

async function post(endpoint, p, form) {
  const origin = endpoint.startsWith('https://lite') ? 'https://lite.duckduckgo.com' : 'https://html.duckduckgo.com';
  const page = await fetchUpstream(endpoint, {
    method: 'POST',
    timeout: p.timeout,
    lang: p.region.acceptLanguage,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: origin,
      Referer: origin + '/',
      Cookie: cookieFor(p),
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
    },
    body: new URLSearchParams(form).toString(),
  });
  if (looksLikeCaptcha(page)) throw new UpstreamError('captcha', { code: 'captcha' });
  return page;
}

function parseHtml(page) {
  const $ = cheerio.load(page);
  const results = [];
  $('div.result').each((_, el) => {
    const item = $(el);
    if (item.hasClass('result--ad') || item.find('.badge--ad').length) return;
    const link = item.find('a.result__a').first();
    const url = unwrapDdgUrl(link.attr('href'));
    if (!url || isDdgAd(url)) return;
    const title = squash(link.text());
    const snippet = squash(item.find('.result__snippet').text());
    results.push({ url, title, snippet });
  });
  let next = null;
  $('div.nav-link form').each((_, form) => {
    const f = $(form);
    if (!/next/i.test(f.find('input[type=submit]').attr('value') || '')) return;
    next = {};
    f.find('input[type=hidden]').each((__, input) => {
      next[$(input).attr('name')] = $(input).attr('value') ?? '';
    });
  });
  return { results, next };
}

function parseLite(page) {
  const $ = cheerio.load(page);
  const results = [];
  $('a.result-link').each((_, el) => {
    const link = $(el);
    const row = link.closest('tr');
    if (row.hasClass('result-sponsored')) return;
    const url = unwrapDdgUrl(link.attr('href'));
    if (!url || isDdgAd(url)) return;
    const snippet = squash(row.next('tr').find('td.result-snippet').text());
    results.push({ url, title: squash(link.text()), snippet });
  });
  return results;
}

async function firstPage(p) {
  const form = { q: p.query, b: '', kl: p.region.code, df: p.time || '', kp: DDG_SAFE[p.safe] };
  try {
    const { results, next } = parseHtml(await post('https://html.duckduckgo.com/html/', p, form));
    if (next) nextForms.set(formKey(p, 2), next);
    return results;
  } catch (err) {
    // The lite endpoint often keeps working when the HTML one is throttled.
    if (err.code !== 'captcha' && err.code !== 'blocked' && err.code !== 'ratelimit') throw err;
    return parseLite(await post('https://lite.duckduckgo.com/lite/', p, { q: p.query, kl: p.region.code, df: p.time || '' }));
  }
}

export default {
  id: 'duckduckgo',
  name: 'DuckDuckGo',
  description: 'Broad web index with its own crawler plus partner results.',
  weight: 1.0,
  core: true,
  timeout: 4000,
  paging: true,
  async search(p) {
    if (p.page === 1) return firstPage(p);
    let form = nextForms.get(formKey(p, p.page));
    if (!form && p.page <= 4) {
      // Walk forward from page 1 to recover the continuation token.
      await firstPage(p);
      for (let page = 2; page < p.page && nextForms.get(formKey(p, page)); page++) {
        const { next } = parseHtml(await post('https://html.duckduckgo.com/html/', p, nextForms.get(formKey(p, page))));
        if (next) nextForms.set(formKey(p, page + 1), next);
      }
      form = nextForms.get(formKey(p, p.page));
    }
    if (!form) return [];
    const { results, next } = parseHtml(await post('https://html.duckduckgo.com/html/', p, form));
    if (next) nextForms.set(formKey(p, p.page + 1), next);
    return results;
  },
};
