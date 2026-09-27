import { parseUrl } from '../util/url.js';
import { decodeBingUrl } from '../engines/web/bing.js';

// Everything Cut does to a result link before you see it, in order:
// unwrap redirect wrappers → restore AMP pages → strip trackers → HTTPS →
// privacy-friendly front-ends. Each step is a setting.

const KNOWN_TRACKERS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name', 'utm_brand',
  'utm_social', 'utm_social-type', 'utm_reader', 'utm_viz_id', 'utm_pubreferrer', 'fbclid', 'gclid', 'gclsrc',
  'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id', 'mc_cid', 'mc_eid', '_hsenc',
  '_hsmi', '__hsfp', '__hssc', '__hstc', 'hsctatracking', 'igshid', 'igsh', 'ref_src', 'ref_url', 's_cid', 'ocid',
  'cvid', 'ncid', '_ga', '_gl', 'oly_anon_id', 'oly_enc_id', 'rb_clickid', 'vero_id', 'vero_conv', 'wickedid',
  'spm', 'scm', 'sr_share', 'trk', 'trkcampaign', 'mkt_tok', 'epik', 'at_medium', 'at_campaign', 'at_custom1',
  'cmpid', 'itm_source', 'itm_medium', 'itm_campaign', 'mbid', 'pd_rd_r', 'pd_rd_w', 'pd_rd_wg', 'pf_rd_p',
  'pf_rd_r', 'pk_campaign', 'pk_kwd', 'pk_source', 'pk_medium', 'mtm_campaign', 'mtm_source', 'mtm_medium',
  'mtm_keyword', 'guccounter', 'guce_referrer', 'guce_referrer_sig', 'soc_src', 'soc_trk', 'srsltid', 'zanpid',
  'xtor', 'irclickid', 'irgwc', 'clickid', 'click_id', 'ttd_id',
]);

// Strict mode also removes referral, affiliate and campaign parameters. These
// are occasionally used by a site itself, so this can rarely break a link.
const AGGRESSIVE = new Set([
  'ref', 'ref_', 'referrer', 'referer', 'source', 'src', 'campaign', 'cmp', 'affiliate', 'aff', 'aff_id', 'affid',
  'aff_sub', 'partner', 'partnerid', 'linkcode', 'linkid', 'creative', 'creativeasin', 'ascsubtag', 'camp', 'smid',
  'psc', 'sprefix', 'crid', 'qid', 'sr', 'dib', 'dib_tag', 'content-id', 'feature', 'pp', 'ab_channel', 'from',
  'share', 'shared', 'via', 'mkt', 'cm_mmc', 'cm_ven', 'cm_cat', 'cm_pla', 'cm_ite', 'tracking', 'trackingid',
]);

const REDIRECTORS = [
  [/(^|\.)google\.[a-z.]+$/, /^\/url$/, ['q', 'url']],
  [/^(l|lm)\.facebook\.com$/, /^\/l\.php$/, ['u']],
  [/^l\.instagram\.com$/, /^\/$/, ['u']],
  [/^out\.reddit\.com$/, /./, ['url']],
  [/(^|\.)youtube\.com$/, /^\/redirect$/, ['q']],
  [/^t\.umblr\.com$/, /^\/redirect$/, ['z']],
  [/^steamcommunity\.com$/, /^\/linkfilter\/?$/, ['url', 'u']],
  [/duckduckgo\.com$/, /^\/l\/?$/, ['uddg']],
  [/(^|\.)linkedin\.com$/, /^\/redir\/redirect\/?$/, ['url']],
  [/^click\.linksynergy\.com$/, /./, ['murl']],
  [/(^|\.)awin1\.com$/, /^\/cread\.php$/, ['ued']],
  [/^(www\.)?deviantart\.com$/, /^\/users\/outgoing$/, [null]],
];

function unwrap(url) {
  for (let hops = 0; hops < 3; hops++) {
    if (/(^|\.)bing\.com$/.test(url.hostname) && url.pathname.startsWith('/ck/a')) {
      const next = parseUrl(decodeBingUrl(url.toString()));
      if (!next) return url;
      url = next;
      continue;
    }
    const rule = REDIRECTORS.find(([host, path]) => host.test(url.hostname) && path.test(url.pathname));
    if (!rule) return url;
    const raw = rule[2][0] === null ? decodeURIComponent(url.search.slice(1)) : rule[2].map((p) => url.searchParams.get(p)).find(Boolean);
    const next = raw && parseUrl(raw);
    if (!next) return url;
    url = next;
  }
  return url;
}

// https://www.google.com/amp/s/example.com/story → https://example.com/story
// https://example-com.cdn.ampproject.org/c/s/example.com/story → same
function deAmp(url) {
  let match;
  if (/(^|\.)google\.[a-z.]+$/.test(url.hostname) && (match = url.pathname.match(/^\/amp\/(s\/)?(.+)$/))) {
    return parseUrl(`${match[1] ? 'https' : 'http'}://${match[2]}${url.search}`) || url;
  }
  if (url.hostname.endsWith('.cdn.ampproject.org') && (match = url.pathname.match(/^\/[a-z]+\/(s\/)?(.+)$/))) {
    return parseUrl(`${match[1] ? 'https' : 'http'}://${match[2]}${url.search}`) || url;
  }
  return url;
}

function stripParams(url, level) {
  if (level === 'off') return url;
  // Amazon product links: keep only the product path.
  if (level === 'aggressive' && /(^|\.)amazon\.[a-z.]+$/.test(url.hostname)) {
    const asin = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
    if (asin) return new URL(`https://${url.hostname}/dp/${asin[1]}`);
  }
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    const youtubeShare = lower === 'si' && /(^|\.)(youtube\.com|youtu\.be)$/.test(url.hostname);
    const amazonTag = lower === 'tag' && /(^|\.)amazon\.[a-z.]+$/.test(url.hostname);
    if (KNOWN_TRACKERS.has(lower) || lower.startsWith('utm_') || youtubeShare || (level === 'aggressive' && (AGGRESSIVE.has(lower) || amazonTag))) {
      url.searchParams.delete(key);
    }
  }
  return url;
}

export const FRONTENDS = {
  youtube: {
    name: 'YouTube',
    hosts: /^(www\.|m\.|music\.)?youtube\.com$|^youtu\.be$|^(www\.)?youtube-nocookie\.com$/,
    options: { invidious: { name: 'Invidious', instance: 'https://yewtu.be' }, piped: { name: 'Piped', instance: 'https://piped.video' } },
    rewrite(url, base) {
      if (url.hostname === 'youtu.be') return new URL(`/watch?v=${url.pathname.slice(1)}${url.search.replace(/^\?/, '&')}`, base);
      return new URL(url.pathname + url.search, base);
    },
  },
  reddit: {
    name: 'Reddit',
    hosts: /^(www\.|new\.|m\.|np\.|amp\.)?reddit\.com$/,
    options: { old: { name: 'old.reddit.com', instance: 'https://old.reddit.com' }, redlib: { name: 'Redlib', instance: 'https://safereddit.com' } },
    rewrite: (url, base) => new URL(url.pathname + url.search, base),
  },
  twitter: {
    name: 'X (Twitter)',
    hosts: /^(www\.|mobile\.)?(twitter|x)\.com$/,
    options: { nitter: { name: 'Nitter', instance: 'https://nitter.net' }, xcancel: { name: 'XCancel', instance: 'https://xcancel.com' } },
    rewrite: (url, base) => new URL(url.pathname + url.search, base),
  },
  medium: {
    name: 'Medium',
    hosts: /^(www\.)?medium\.com$|^[a-z0-9-]+\.medium\.com$/,
    options: { scribe: { name: 'Scribe', instance: 'https://scribe.rip' } },
    rewrite(url, base) {
      const user = url.hostname.match(/^([a-z0-9-]+)\.medium\.com$/);
      const path = user && user[1] !== 'www' ? `/@${user[1]}${url.pathname}` : url.pathname;
      return new URL(path, base);
    },
  },
};

function frontend(url, prefs) {
  for (const [id, service] of Object.entries(FRONTENDS)) {
    const choice = prefs.frontends?.[id];
    if (!choice || choice === 'off' || !service.hosts.test(url.hostname)) continue;
    const base = prefs.frontendInstances?.[id] || service.options[choice]?.instance;
    if (!base) return url;
    try {
      return service.rewrite(url, base);
    } catch {
      return url;
    }
  }
  return url;
}

// Returns { url, insecure } for a result link under the given preferences.
export function cleanLink(href, prefs) {
  let url = parseUrl(href);
  if (!url) return { url: href, insecure: false };
  if (prefs.unwrap !== false) url = unwrap(url);
  if (prefs.amp !== false) url = deAmp(url);
  url = stripParams(url, prefs.strip || 'known');
  if (url.protocol === 'http:' && prefs.https === 'upgrade' && !/^(localhost|127\.|\[::1\])/.test(url.hostname)) url.protocol = 'https:';
  url = frontend(url, prefs);
  return { url: url.toString(), insecure: url.protocol === 'http:' && prefs.https === 'mark' };
}

// Advertising and tracking domains hidden by "Hide results from ad and tracking domains".
const AD_DOMAINS = [
  'doubleclick.net', 'googleadservices.com', 'googlesyndication.com', 'adservice.google.com', 'googletagmanager.com',
  'google-analytics.com', 'adnxs.com', 'taboola.com', 'outbrain.com', 'criteo.com', 'criteo.net', 'adsrvr.org',
  'amazon-adsystem.com', 'scorecardresearch.com', 'quantserve.com', 'moatads.com', 'rubiconproject.com',
  'pubmatic.com', 'openx.net', 'casalemedia.com', 'adform.net', 'smartadserver.com', 'zemanta.com', 'revcontent.com',
  'mgid.com', 'clickbank.net', 'adf.ly', 'linkvertise.com', 'ouo.io', 'shorte.st', 'propellerads.com', 'popads.net',
  'adcash.com', 'exoclick.com', 'trafficjunky.com', 'bat.bing.com', 'ads.linkedin.com', 'ads.twitter.com',
];

export const matchesDomain = (host, domain) => host === domain || host.endsWith('.' + domain);

export function isAdDomain(host) {
  return AD_DOMAINS.some((domain) => matchesDomain(host, domain));
}

// Normalises a user-entered list of sites ("example.com, *.foo.org\nbar.net").
export function parseDomainList(text, max = 40) {
  const out = [];
  for (const raw of String(text || '').split(/[\s,;]+/)) {
    let entry = raw.trim().toLowerCase();
    if (!entry) continue;
    entry = entry.replace(/^[a-z]+:\/\//, '').replace(/^\*\./, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (/^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(entry) && !out.includes(entry)) out.push(entry);
    if (out.length >= max) break;
  }
  return out;
}
