import { html, cx } from '../util/html.js';
import { icon } from './icons.js';
import { documentStart, documentEnd, topbar, searchUrl } from './layout.js';
import { answerCard, infoboxView } from './answers.js';
import { REGIONS, SAFE_LEVELS, TIME_RANGES } from '../prefs.js';
import { CATEGORIES } from '../engines/torrents/common.js';
import { SORTS } from '../search/torrents.js';
import { IMAGE_FILTERS } from '../engines/media/images.js';
import { VIDEO_FILTERS } from '../engines/media/videos.js';
import { engineName, sourceShort } from '../engines/registry.js';
import { imageSrc } from '../proxy.js';
import { breadcrumb, hostname, urlKey } from '../util/url.js';
import { highlight, formatBytes, timeAgo, formatNumber, formatCompact, formatDate, truncate, tokenize } from '../util/text.js';

const CAT_NAMES = { all: 'All', video: 'Video', audio: 'Audio', apps: 'Software', games: 'Games', books: 'Books', anime: 'Anime', other: 'Other', xxx: 'Adult' };

const targetAttr = (ctx) => (ctx.prefs.newTab ? html` target="_blank"` : '');
// "Origin only" referrers need links without noreferrer.
const rel = (ctx) => (ctx.prefs.referrer === 'origin' ? 'noopener' : 'noopener noreferrer');
const hl = (text, ctx) => (ctx.prefs.bold ? highlight(text, ctx.terms) : text);

function favicon(host, ctx) {
  if (!ctx.fx.favicons || !host) return '';
  return html`<img class="favicon" src="/fav/${host}" alt="" width="16" height="16" loading="lazy" decoding="async">`;
}

// Short relative age for dense tables: "3d", "5mo", "2y".
function shortAge(ts) {
  if (!ts) return '—';
  const days = (Date.now() - ts) / 86_400_000;
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`;
  if (days < 31) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30.4)}mo`;
  return `${Math.floor(days / 365)}y`;
}

// ---------- Filters ----------

function dropdown({ label, value, options, active = false, filterable = false }) {
  return html`<details class="${cx('dd', active && 'is-active')}" data-dd${filterable ? html` data-dd-filter` : ''}>
    <summary class="dd__btn">${label ? html`<span class="dd__label">${label}:</span> ` : ''}${value}${icon('chevronDown', 'dd__caret')}</summary>
    <div class="dd__menu" role="menu">
      ${options.map(
        (o) => html`<a class="${cx('dd__item', o.selected && 'is-on')}" role="menuitemradio" aria-checked="${o.selected ? 'true' : 'false'}" href="${o.href}" rel="nofollow">${o.label}</a>`,
      )}
    </div>
  </details>`;
}

function optionsFor(ctx, param, list, current) {
  return list.map(([id, label]) => ({ label, href: searchUrl(ctx, { [param]: id || undefined, p: undefined }), selected: id === current }));
}

function filterBar(ctx) {
  const items = [
    dropdown({
      value: ctx.region.name,
      filterable: true,
      active: ctx.region.code !== 'wt-wt',
      options: REGIONS.map((r) => ({ label: r.name, href: searchUrl(ctx, { kl: r.code, p: undefined }), selected: r.code === ctx.region.code })),
    }),
    dropdown({
      label: 'Safe search',
      value: SAFE_LEVELS.find((s) => s.id === ctx.safe).name,
      active: ctx.safe !== 'moderate',
      options: SAFE_LEVELS.map((s) => ({ label: s.name, href: searchUrl(ctx, { kp: s.id, p: undefined }), selected: s.id === ctx.safe })),
    }),
  ];
  if (ctx.type === 'web' || ctx.type === 'news' || ctx.type === 'torrents') {
    const ranges = ctx.type === 'news' ? TIME_RANGES.filter((r) => r.id !== 'y') : TIME_RANGES;
    items.push(
      dropdown({
        value: TIME_RANGES.find((r) => r.id === ctx.time)?.name || 'Any time',
        active: !!ctx.time,
        options: ranges.map((r) => ({ label: r.name, href: searchUrl(ctx, { df: r.id || undefined, p: undefined }), selected: r.id === ctx.time })),
      }),
    );
  }
  const typeFilters = ctx.type === 'images' ? IMAGE_FILTERS : ctx.type === 'videos' ? VIDEO_FILTERS : [];
  for (const f of typeFilters) {
    const current = ctx.filters[f.key] || '';
    items.push(dropdown({ value: f.options.find(([id]) => id === current)?.[1] || f.options[0][1], active: !!current, options: optionsFor(ctx, f.param, f.options, current) }));
  }
  if (ctx.type === 'news') {
    items.push(dropdown({ label: 'Sort', value: ctx.sort === 'newest' ? 'Newest' : 'Relevance', active: ctx.sort === 'newest', options: optionsFor(ctx, 'sort', [['', 'Relevance'], ['newest', 'Newest']], ctx.sort === 'newest' ? 'newest' : '') }));
  }
  if (ctx.type === 'torrents') {
    items.push(
      dropdown({
        label: 'Sort',
        value: SORTS.find((s) => s.id === ctx.sort)?.name,
        active: ctx.sort !== 'best',
        options: SORTS.map((s) => ({ label: s.name, href: searchUrl(ctx, { sort: s.id === ctx.defaultSort ? undefined : s.id, p: undefined }), selected: s.id === ctx.sort })),
      }),
    );
  }
  const hasTypeFilters = ctx.type !== 'torrents' && Object.values(ctx.typeParams).some(Boolean);
  return html`<div class="filters wrap">${items}${hasTypeFilters ? html`<a class="filters__reset" href="${searchUrl(ctx, {}, { keepTypeParams: false })}">Clear filters</a>` : ''}</div>`;
}

// ---------- Shared bits ----------

function skeleton(type) {
  if (type === 'images' || type === 'videos') {
    return html`<div class="sk-grid">${Array.from({ length: 12 }, () => html`<span class="sk sk-block"></span>`)}</div>`;
  }
  return html`<div class="sk-list">${Array.from({ length: 5 }, () => html`<div class="sk-row"><span class="sk sk-a"></span><span class="sk sk-b"></span><span class="sk sk-c"></span></div>`)}</div>`;
}

function moreButton(ctx, hasMore, label = 'More results') {
  if (!hasMore) return '';
  return html`<div class="more"><a class="btn btn--more" href="${searchUrl(ctx, { p: ctx.page + 1 })}" data-more rel="nofollow"><span>${label}</span></a></div>`;
}

function emptyState(ctx, data) {
  const failed = data.error || (data.sources?.length > 0 && data.sources.every((s) => !s.ok));
  const none = !data.error && data.sources?.length === 0;
  const alternatives =
    ctx.type === 'torrents'
      ? [['The Pirate Bay', `!tpb ${ctx.query}`], ['Internet Archive', `!ia ${ctx.query}`]]
      : [['Google', `${ctx.query} !g`], ['Bing', `${ctx.query} !b`], ['Wikipedia', `${ctx.query} !w`]];
  return html`<div class="empty">
    ${
      none
        ? html`<p><strong>No sources are enabled.</strong> Turn some on in <a href="/settings">Settings</a>.</p>`
        : failed && ctx.network.mode !== 'direct'
          ? html`<p><strong>None of the sources responded.</strong> Cut is set to connect ${ctx.network.mode === 'tor' ? 'through Tor' : 'through a proxy'}. Make sure it’s running, or check <a href="/settings#connection">connection settings</a>. <a href="${searchUrl(ctx, {})}">Try again</a></p>`
        : failed
          ? html`<p><strong>None of the sources responded.</strong> This is usually temporary. <a href="${searchUrl(ctx, {})}">Try again</a></p>`
          : html`<p>No results found for <strong>${ctx.query}</strong>.</p><p class="empty__hint">Check the spelling, try fewer or different words, or remove filters.</p>`
    }
    <p class="empty__hint">Search elsewhere: ${alternatives.map(([name, query], i) => html`${i ? ' · ' : ''}<a href="/search?q=${encodeURIComponent(query)}">${name}</a>`)}</p>
  </div>`;
}

// ---------- Web ----------

// Warnings from dangerous-site protection and HTTPS-only mode.
function linkLabels(r) {
  return html`${r.threat ? html`<span class="label label--danger">${r.threat === 'phishing' ? 'Deceptive site' : 'Dangerous site'}</span>` : ''}${
    r.insecure ? html`<span class="label label--warn" title="This link doesn’t use HTTPS">Not secure</span>` : ''
  }`;
}

const threatWarning = (r) =>
  r.threat
    ? html`<p class="warning">Cut’s blocklists list this site as ${r.threat === 'phishing' ? 'a phishing site that may try to steal passwords or payment details' : 'a source of malware'}. <a href="/settings#security">Protection settings</a></p>`
    : '';

function webResult(r, ctx) {
  const crumb = breadcrumb(r.url);
  return html`<li class="${cx('result', r.threat && 'result--danger')}" data-key="${r.key}">
    <div class="result__url">${favicon(crumb.host, ctx)}<span class="result__host">${crumb.host}</span>${crumb.parts.map((p) => html`<span class="result__path"> › ${p}</span>`)}${r.official ? html`<span class="label">Official site</span>` : ''}${linkLabels(r)}</div>
    <h2 class="result__title"><a href="${r.url}" rel="${rel(ctx)}"${targetAttr(ctx)} data-result-link>${r.title}</a></h2>
    ${threatWarning(r)}
    ${r.snippet ? html`<p class="result__snippet">${hl(truncate(r.snippet, 300), ctx)}</p>` : ''}
  </li>`;
}

function related(ctx, phrases) {
  const own = new Set(tokenize(ctx.query));
  return html`<section class="related" aria-labelledby="related-title">
    <h2 class="related__title" id="related-title">Related searches</h2>
    <ul class="related__list">
      ${phrases.map(
        (p) => html`<li><a href="${searchUrl(ctx, { q: p, p: undefined })}">${p.split(/(\s+)/).map((w) => (w.trim() && !own.has(w.toLowerCase()) ? html`<b>${w}</b>` : w))}</a></li>`,
      )}
    </ul>
  </section>`;
}

function webContent(ctx, data) {
  const answer = data.answer ? answerCard(data.answer) : '';
  if (!data.results.length) return html`${answer}${emptyState(ctx, data)}`;
  return html`${answer}
    <ol class="results" data-results>${data.results.map((r) => webResult(r, ctx))}</ol>
    ${moreButton(ctx, data.hasMore)}
    ${data.related?.length ? related(ctx, data.related) : ''}`;
}

// ---------- Torrents ----------

function sortHeader(ctx, label, sortId, className) {
  const on = ctx.sort === sortId;
  return html`<th class="${className}"${on ? html` aria-sort="descending"` : ''}><a href="${searchUrl(ctx, { sort: sortId === ctx.defaultSort ? undefined : sortId, p: undefined })}" rel="nofollow">${label}${on ? ' ▾' : ''}</a></th>`;
}

function torrentRow(t, ctx) {
  const sources = t.sources.map((s) => sourceShort(s.id)).join(', ');
  return html`<tr class="torrent" data-key="${t.hash}">
    <td class="tt-name">
      <details class="torrent__details">
        <summary><span class="torrent__title">${t.name}</span></summary>
        <dl class="tinfo">
          <dt>Info hash</dt><dd><code>${t.hash}</code> <button class="linkbtn" type="button" data-copy="${t.hash}" data-copy-label="Info hash copied">Copy</button></dd>
          ${t.uploader ? html`<dt>Uploader</dt><dd>${t.uploader}${t.trusted ? ' (trusted)' : ''}</dd>` : ''}
          ${t.date ? html`<dt>Added</dt><dd>${formatDate(t.date)}</dd>` : ''}
          ${t.files ? html`<dt>Files</dt><dd>${formatNumber(t.files)}</dd>` : ''}
          ${t.webseed ? html`<dt>Availability</dt><dd>Web-seeded by the Internet Archive; downloads even with no peers.</dd>` : ''}
          <dt>Found on</dt><dd>${t.sources.map(
            (s, i) => html`${i ? ', ' : ''}<a href="${s.url}" rel="${rel(ctx)}"${targetAttr(ctx)}>${engineName(s.id)}</a>${s.via && s.via !== engineName(s.id) ? html` (via ${s.via})` : ''}`,
          )}</dd>
        </dl>
      </details>
      <div class="tt-sub">${CAT_NAMES[t.category] || 'Other'} · ${sources}${t.trusted ? ' · Trusted' : ''}${t.risk ? html`<span class="label label--danger" title="${t.risk}">Suspicious: ${t.risk.toLowerCase()}</span>` : ''}</div>
    </td>
    <td class="tt-size">${formatBytes(t.size) || '—'}</td>
    <td class="tt-age" title="${t.date ? formatDate(t.date) : ''}">${shortAge(t.date)}</td>
    ${
      t.seeders != null
        ? html`<td class="tt-num seeds">${formatNumber(t.seeders)}</td><td class="tt-num tt-leech peers">${formatNumber(t.leechers ?? 0)}</td>`
        : html`<td class="tt-num tt-na">${t.webseed ? 'Web seed' : '—'}</td><td class="tt-num tt-leech"></td>`
    }
    <td class="tt-act">
      <a class="iconbtn iconbtn--sm" href="${t.magnet}" data-magnet title="Magnet link" aria-label="Magnet link">${icon('magnet')}</a>
      <button class="iconbtn iconbtn--sm" type="button" data-copy="${t.magnet}" data-copy-label="Magnet link copied" title="Copy magnet link" aria-label="Copy magnet link">${icon('copy')}</button>
      ${t.torrentUrl ? html`<a class="iconbtn iconbtn--sm" href="${t.torrentUrl}" rel="${rel(ctx)}" title="Download .torrent file" aria-label="Download .torrent file">${icon('download')}</a>` : ''}
    </td>
  </tr>`;
}

function torrentsContent(ctx, data) {
  const cats = CATEGORIES.filter((c) => (!c.adult || ctx.safe === 'off') && (c.id === 'all' || data.counts?.[c.id] || c.id === ctx.cat));
  const catBar = html`<nav class="cats" aria-label="Category">
    ${cats.map(
      (c) => html`<a class="${cx('cat', ctx.cat === c.id && 'is-on')}" href="${searchUrl(ctx, { cat: c.id === 'all' ? undefined : c.id, p: undefined })}"${ctx.cat === c.id ? html` aria-current="true"` : ''}>${CAT_NAMES[c.id]} <span class="cat__n">${formatNumber(data.counts?.[c.id] || 0)}</span></a>`,
    )}
  </nav>`;
  if (!data.results.length) return html`${catBar}${emptyState(ctx, data)}`;
  return html`${catBar}
    <table class="ttable">
      <thead><tr>
        ${sortHeader(ctx, 'Name', 'best', 'tt-name')}
        ${sortHeader(ctx, 'Size', 'largest', 'tt-size')}
        ${sortHeader(ctx, 'Age', 'newest', 'tt-age')}
        ${sortHeader(ctx, 'Seed', 'seeders', 'tt-num')}
        <th class="tt-num tt-leech">Leech</th>
        <th class="tt-act"><span class="sr-only">Links</span></th>
      </tr></thead>
      <tbody data-results>${data.results.map((t) => torrentRow(t, ctx))}</tbody>
    </table>
    ${moreButton(ctx, data.hasMore, 'More torrents')}`;
}

// ---------- Images ----------

function aspectClass(w, h) {
  const ratio = w && h ? w / h : 1.5;
  return 'r' + Math.max(5, Math.min(25, Math.round(ratio * 10)));
}

function imageTile(img, ctx) {
  if (!ctx.fx.images) {
    return html`<li class="textlist__item" data-key="${img.image}"><a href="${img.url}" rel="${rel(ctx)}"${targetAttr(ctx)}>${img.title || img.domain}</a> <span class="textlist__meta">${img.domain}${img.width ? ` · ${img.width}×${img.height}` : ''} · <a href="${img.image}" rel="${rel(ctx)}"${targetAttr(ctx)}>image file</a></span></li>`;
  }
  const thumb = imageSrc(img.thumbnail || img.image, ctx);
  return html`<a class="${cx('tile', aspectClass(img.width, img.height), img.threat && 'tile--danger')}" href="${img.url}" rel="${rel(ctx)}" data-key="${img.image}" data-tile
      data-full="${imageSrc(img.image, ctx)}" data-thumb="${thumb}" data-src="${img.image}" data-title="${img.title}" data-domain="${img.domain}" data-w="${img.width}" data-h="${img.height}">
    <img src="${thumb}" alt="${img.title}" loading="lazy" decoding="async">
    <span class="tile__cap">${img.domain}${img.width ? html` · ${img.width}×${img.height}` : ''}</span>
  </a>`;
}

function imagesContent(ctx, data) {
  if (!data.results.length) return emptyState(ctx, data);
  if (!ctx.fx.images) {
    return html`<p class="notice">Images aren’t loaded at the Safest security level. <a href="/settings#security">Change it</a></p>
      <ol class="textlist" data-results>${data.results.map((img) => imageTile(img, ctx))}</ol>${moreButton(ctx, data.hasMore, 'More images')}`;
  }
  return html`<div class="igrid" data-results>${data.results.map((img) => imageTile(img, ctx))}</div>${moreButton(ctx, data.hasMore, 'More images')}`;
}

function lightbox() {
  return html`<dialog class="lightbox" id="lightbox" aria-label="Image preview">
    <div class="lightbox__stage">
      <button class="lightbox__nav lightbox__nav--prev" type="button" data-lb-prev aria-label="Previous image">${icon('chevronLeft')}</button>
      <img class="lightbox__img" data-lb-img alt="">
      <button class="lightbox__nav lightbox__nav--next" type="button" data-lb-next aria-label="Next image">${icon('chevronRight')}</button>
    </div>
    <aside class="lightbox__info">
      <button class="iconbtn lightbox__close" type="button" data-lb-close aria-label="Close">${icon('x')}</button>
      <h2 class="lightbox__title" data-lb-title></h2>
      <p class="lightbox__meta"><span data-lb-domain></span> <span data-lb-dims></span></p>
      <p class="lightbox__links"><a data-lb-page href="#" rel="noopener noreferrer">Visit page</a> · <a data-lb-src href="#" rel="noopener noreferrer">View image</a></p>
    </aside>
  </dialog>`;
}

// ---------- News ----------

function newsItem(n, ctx) {
  const host = hostname(n.url);
  return html`<li class="story" data-key="${urlKey(n.url)}">
    <div class="story__body">
      <div class="story__meta">${favicon(host, ctx)}<span class="story__source">${n.source}</span>${
        n.date ? html` · <time datetime="${new Date(n.date).toISOString()}" title="${formatDate(n.date)}">${timeAgo(n.date)}</time>` : ''
      }${linkLabels(n)}</div>
      <h2 class="story__title"><a href="${n.url}" rel="${rel(ctx)}"${targetAttr(ctx)} data-result-link>${n.title}</a></h2>
      ${threatWarning(n)}
      ${n.excerpt ? html`<p class="story__excerpt">${hl(truncate(n.excerpt, 240), ctx)}</p>` : ''}
    </div>
    ${n.image && ctx.fx.thumbnails ? html`<a class="story__thumb" href="${n.url}" rel="${rel(ctx)}"${targetAttr(ctx)} tabindex="-1" aria-hidden="true"><img src="${imageSrc(n.image, ctx)}" alt="" loading="lazy" decoding="async"></a>` : ''}
  </li>`;
}

function newsContent(ctx, data) {
  if (!data.results.length) return emptyState(ctx, data);
  return html`<ol class="news" data-results>${data.results.map((n) => newsItem(n, ctx))}</ol>${moreButton(ctx, data.hasMore, 'More news')}`;
}

// ---------- Videos ----------

function videoCard(v, ctx) {
  const meta = [v.uploader, v.views ? `${formatCompact(v.views)} views` : '', v.date ? timeAgo(v.date) : ''].filter(Boolean).join(' · ');
  if (!ctx.fx.thumbnails) {
    return html`<li class="textlist__item" data-key="${urlKey(v.url)}"><a href="${v.url}" rel="${rel(ctx)}"${targetAttr(ctx)} data-result-link>${v.title}</a>${v.duration ? ` (${v.duration})` : ''}${linkLabels(v)} <span class="textlist__meta">${[v.publisher, meta].filter(Boolean).join(' · ')}</span></li>`;
  }
  return html`<li class="vcard" data-key="${urlKey(v.url)}">
    <a class="vcard__link" href="${v.url}" rel="${rel(ctx)}"${targetAttr(ctx)} data-result-link>
      <span class="vcard__thumb">${v.thumbnail ? html`<img src="${imageSrc(v.thumbnail, ctx)}" alt="" loading="lazy" decoding="async">` : ''}${v.duration ? html`<span class="vcard__dur">${v.duration}</span>` : ''}</span>
      <span class="vcard__title">${v.title}</span>
    </a>
    <p class="vcard__meta">${v.publisher ? html`${v.publisher}${meta ? ' · ' : ''}` : ''}${meta}</p>
  </li>`;
}

function videosContent(ctx, data) {
  if (!data.results.length) return emptyState(ctx, data);
  if (!ctx.fx.thumbnails) return html`<ol class="textlist" data-results>${data.results.map((v) => videoCard(v, ctx))}</ol>${moreButton(ctx, data.hasMore, 'More videos')}`;
  return html`<ol class="vgrid" data-results>${data.results.map((v) => videoCard(v, ctx))}</ol>${moreButton(ctx, data.hasMore, 'More videos')}`;
}

// ---------- Page assembly ----------

const CONTENT = { web: webContent, torrents: torrentsContent, images: imagesContent, news: newsContent, videos: videosContent };

// First chunk: everything up to the results, streamed before engines answer.
export function searchShell(ctx) {
  return html`${documentStart(ctx, { title: ctx.prefs.hideQuery ? 'Cut Search' : `${ctx.query} at Cut Search`, bodyClass: `serp-page serp-page--${ctx.type}` })}
${topbar(ctx)}
${filterBar(ctx)}
<main class="${cx('serp', 'wrap', `serp--${ctx.type}`)}" id="main">
<div class="serp__main">
<div class="loading" aria-hidden="true">${skeleton(ctx.type)}</div>
`;
}

export function searchBody(ctx, data) {
  return html`<div class="serp__content">${CONTENT[ctx.type](ctx, data)}</div>
</div>
${ctx.type === 'web' ? html`<aside class="serp__side" aria-label="About this topic">${data.infobox ? infoboxView(data.infobox, ctx) : ''}</aside>` : ''}
</main>
${ctx.type === 'images' && ctx.fx.js ? lightbox() : ''}
${documentEnd(ctx)}`;
}

// "More results" fragments: just the new items.
export function resultsFragment(ctx, data) {
  const render = { web: (r) => webResult(r, ctx), torrents: (t) => torrentRow(t, ctx), images: (img) => imageTile(img, ctx), news: (n) => newsItem(n, ctx), videos: (v) => videoCard(v, ctx) }[ctx.type];
  return String(html`${data.results.map(render)}`);
}
