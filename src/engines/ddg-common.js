import { fetchUpstream, UpstreamError } from '../http.js';
import { TTLCache, cacheKey } from '../util/cache.js';

export const DDG_SAFE = { strict: '1', moderate: '-1', off: '-2' };

// Unwraps DuckDuckGo's redirect links (//duckduckgo.com/l/?uddg=...).
export function unwrapDdgUrl(href) {
  if (!href) return '';
  let url = href.startsWith('//') ? 'https:' + href : href;
  try {
    const parsed = new URL(url, 'https://duckduckgo.com');
    if (parsed.hostname.endsWith('duckduckgo.com') && parsed.pathname === '/l/') {
      url = parsed.searchParams.get('uddg') || '';
    }
  } catch {
    return '';
  }
  return url;
}

export const isDdgAd = (url) => /duckduckgo\.com\/y\.js|[?&]ad_domain=|[?&]ad_provider=/.test(url);

export const looksLikeCaptcha = (page) => /anomaly-modal|challenge-form|bots use DuckDuckGo too|g-recaptcha/i.test(page);

// The JSON endpoints (images, news, videos) need a per-query "vqd" token
// that DuckDuckGo embeds in its regular search page.
const vqdCache = new TTLCache({ max: 1000, ttl: 20 * 60_000 });

export function getVqd(query, region, timeout = 3000) {
  return vqdCache.wrap(cacheKey('vqd', query, region.code), async () => {
    const page = await fetchUpstream('https://duckduckgo.com/?' + new URLSearchParams({ q: query, ia: 'web' }), {
      timeout,
      lang: region.acceptLanguage,
    });
    const match = page.match(/vqd=["']?(\d-[\d-]+)["']?/) || page.match(/"vqd":"(\d-[\d-]+)"/);
    if (!match) throw new UpstreamError('no vqd token', { code: looksLikeCaptcha(page) ? 'captcha' : 'parse' });
    return match[1];
  });
}

export async function ddgJson(endpoint, params, region, timeout) {
  const url = `https://duckduckgo.com/${endpoint}?` + new URLSearchParams(params);
  return fetchUpstream(url, {
    timeout,
    as: 'json',
    lang: region.acceptLanguage,
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Referer: 'https://duckduckgo.com/',
      'X-Requested-With': 'XMLHttpRequest',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    },
  });
}
