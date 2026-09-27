// URL helpers: tracker stripping, de-duplication keys and display breadcrumbs.

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name',
  'utm_brand', 'utm_social', 'utm_social-type', 'utm_reader', 'utm_viz_id', 'utm_pubreferrer',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid',
  'mc_cid', 'mc_eid', '_hsenc', '_hsmi', '__hsfp', '__hssc', '__hstc', 'hsctatracking',
  'igshid', 'igsh', 'ref_src', 'ref_url', 's_cid', 'ocid', 'cvid', 'ncid', '_ga', '_gl',
  'oly_anon_id', 'oly_enc_id', 'rb_clickid', 'vero_id', 'vero_conv', 'wickedid', 'spm', 'scm',
  'sr_share', 'trk', 'trkcampaign', 'mkt_tok', 'epik', 'at_medium', 'at_campaign', 'at_custom1',
  'cmpid', 'ito', 'itm_source', 'itm_medium', 'itm_campaign', 'mbid', 'pd_rd_r', 'pd_rd_w',
  'pd_rd_wg', 'pf_rd_p', 'pf_rd_r', 'pk_campaign', 'pk_kwd', 'pk_source', 'pk_medium',
  'mtm_campaign', 'mtm_source', 'mtm_medium', 'mtm_keyword', 'guccounter', 'guce_referrer',
  'guce_referrer_sig', 'soc_src', 'soc_trk', 'srsltid', 'zanpid', 'xtor',
]);

export function parseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

// Removes known tracking parameters. YouTube's `si` share tracker is stripped too.
export function cleanUrl(value) {
  const url = parseUrl(value);
  if (!url) return value;
  let changed = false;
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    const youtubeShare = lower === 'si' && /(^|\.)(youtube\.com|youtu\.be)$/.test(url.hostname);
    if (TRACKING_PARAMS.has(lower) || lower.startsWith('utm_') || youtubeShare) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  return changed ? url.toString() : value;
}

// Key used to merge the same page returned by different engines.
export function urlKey(value) {
  const url = parseUrl(cleanUrl(value));
  if (!url) return String(value);
  const host = url.hostname.replace(/^(www\d?|m|mobile)\./, '');
  const path = decodeURIComponent(url.pathname).replace(/\/(index\.(html?|php))?$/, '') || '';
  const params = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : '';
  return (host + path + query).toLowerCase();
}

export const hostname = (value) => parseUrl(value)?.hostname.replace(/^www\./, '') || '';

// Breadcrumb for display: "example.com › docs › guide".
export function breadcrumb(value) {
  const url = parseUrl(value);
  if (!url) return { host: String(value), parts: [] };
  let parts = [];
  try {
    parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
  } catch {
    parts = url.pathname.split('/').filter(Boolean);
  }
  parts = parts.slice(0, 4).map((p) => (p.length > 32 ? p.slice(0, 30) + '…' : p));
  return { host: url.hostname.replace(/^www\./, ''), parts };
}

const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;
export const isHostname = (value) => HOSTNAME_RE.test(value);

// Rejects obviously internal destinations for the image proxy.
export function isPublicHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (/^(::1?|fc|fd|fe80:)/.test(h)) return false;
  return true;
}
