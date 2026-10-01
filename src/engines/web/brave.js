import { fetchRaw, toUpstreamError, UpstreamError } from '../../http.js';
import { decodeEntities, squash } from '../../util/text.js';

// Brave's own index, through its official Search API. It needs an API key of
// your own (Settings › Search engines); without one it isn't asked.

// The countries and languages Brave's API accepts, as it names them.
const COUNTRIES = new Set([
  'AR', 'AU', 'AT', 'BE', 'BR', 'CA', 'CL', 'DK', 'FI', 'FR', 'DE', 'HK', 'IN', 'ID', 'IT', 'JP', 'KR', 'MY', 'MX', 'NL',
  'NZ', 'NO', 'CN', 'PL', 'PT', 'PH', 'RU', 'SA', 'ZA', 'ES', 'SE', 'CH', 'TW', 'TR', 'GB', 'US',
]);
const LANGUAGES = new Set([
  'ar', 'eu', 'bn', 'bg', 'ca', 'zh-hans', 'zh-hant', 'hr', 'cs', 'da', 'nl', 'en', 'en-gb', 'et', 'fi', 'fr', 'gl', 'de', 'gu',
  'he', 'hi', 'hu', 'is', 'it', 'jp', 'kn', 'ko', 'lv', 'lt', 'ms', 'ml', 'mr', 'nb', 'pl', 'pt-br', 'pt-pt', 'pa', 'ro', 'ru',
  'sr', 'sk', 'sl', 'es', 'sv', 'ta', 'te', 'th', 'tr', 'uk', 'vi',
]);

function languageFor({ lang, country }) {
  const code =
    lang === 'ja' ? 'jp'
    : lang === 'zh' ? (country === 'CN' ? 'zh-hans' : 'zh-hant')
    : lang === 'pt' ? `pt-${country.toLowerCase()}`
    : lang === 'en' && country === 'GB' ? 'en-gb'
    : lang;
  return LANGUAGES.has(code) ? code : '';
}

const PAGE_SIZE = 20; // the most Brave sends at once; every request counts against your plan

export function braveParams(p) {
  const params = new URLSearchParams({
    q: p.query.slice(0, 400),
    count: String(PAGE_SIZE),
    offset: String(p.page - 1),
    safesearch: p.safe,
    text_decorations: 'false',
    result_filter: 'web,query',
  });
  const everywhere = p.region.code === 'wt-wt';
  params.set('country', !everywhere && COUNTRIES.has(p.region.country) ? p.region.country : 'ALL');
  const lang = everywhere ? '' : languageFor(p.region);
  if (lang) params.set('search_lang', lang);
  if (p.time) params.set('freshness', `p${p.time}`);
  return params;
}

// Text comes plain (text_decorations=false), but may still carry entities or
// the <strong> Brave highlights with.
const plain = (text) => squash(decodeEntities(String(text || '').replace(/<\/?strong>/g, '')));

export const parseBrave = (data) =>
  (data?.web?.results || [])
    .filter((item) => /^https?:/.test(item?.url || ''))
    .map((item) => ({
      url: item.url,
      title: plain(item.title) || item.url,
      snippet: plain(item.description),
      siteName: plain(item.profile?.name),
    }));

// Brave answers problems with a JSON error. A key it doesn't accept, or a
// plan with no searches left, is reported as such so Cut can say so.
export async function braveError(response) {
  const body = await response.json().catch(() => null);
  const code = String(body?.error?.code || '');
  const detail = String(body?.error?.detail || `HTTP ${response.status}`);
  if (/TOKEN|SUBSCRIPTION|AUTH/i.test(code) || response.status === 401) return new UpstreamError(detail, { code: 'key', status: response.status });
  if (/QUOTA|CREDIT|PLAN|BILLING|PAYMENT/i.test(code) || response.status === 402) return new UpstreamError(detail, { code: 'quota', status: response.status });
  if (response.status === 429) return new UpstreamError(detail, { code: 'ratelimit', status: 429 });
  return new UpstreamError(detail, { code: 'http', status: response.status });
}

export default {
  id: 'brave',
  name: 'Brave Search',
  description: 'Brave’s own independent web index, through its official API. Needs an API key from Brave.',
  weight: 1.0,
  core: true,
  timeout: 4000,
  paging: true,
  keyPref: 'braveKey', // the setting that holds your key
  async search(p) {
    const key = p.keys?.brave;
    if (!key || p.page > 10) return []; // Brave pages through ten pages at most
    let response;
    try {
      response = await fetchRaw('https://api.search.brave.com/res/v1/web/search?' + braveParams(p), {
        timeout: p.timeout,
        headers: { Accept: 'application/json', 'X-Subscription-Token': key },
      });
    } catch (err) {
      throw toUpstreamError(err);
    }
    if (!response.ok) throw await braveError(response);
    let data;
    try {
      data = await response.json();
    } catch {
      throw new UpstreamError('invalid JSON', { code: 'parse' });
    }
    return parseBrave(data);
  },
};
