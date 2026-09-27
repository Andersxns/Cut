import { html, cx } from '../util/html.js';
import { icon, logoMark } from './icons.js';
import { THEMES } from '../prefs.js';

export const TABS = [
  { id: 'web', name: 'All' },
  { id: 'images', name: 'Images' },
  { id: 'videos', name: 'Videos' },
  { id: 'news', name: 'News' },
  { id: 'torrents', name: 'Torrents' },
];

// Builds a search URL that keeps the explicit filters in the current URL.
export function searchUrl(ctx, overrides = {}, { keepTypeParams = true } = {}) {
  const params = new URLSearchParams();
  const type = overrides.t ?? ctx.type;
  params.set('q', overrides.q ?? ctx.query);
  if (type !== 'web') params.set('t', type);
  const sticky = { ...ctx.explicit, ...(keepTypeParams && type === ctx.type ? ctx.typeParams : {}) };
  for (const [key, value] of Object.entries({ ...sticky, ...overrides })) {
    if (key === 'q' || key === 't') continue;
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  }
  return '/search?' + params.toString();
}

export function searchForm(ctx, { variant = 'bar', autofocus = false } = {}) {
  const method = ctx.prefs.post ? 'post' : 'get';
  const hidden = [];
  if (variant === 'bar') {
    if (ctx.type && ctx.type !== 'web') hidden.push(['t', ctx.type]);
    for (const [k, v] of Object.entries(ctx.explicit || {})) if (v) hidden.push([k, v]);
  }
  return html`<form class="${cx('search', `search--${variant}`)}" action="/search" method="${method}" role="search" data-search>
    <div class="search__box">
      <input class="search__input" name="q" type="search" value="${ctx.query || ''}" placeholder="Search"
        aria-label="Search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" maxlength="500"
        role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ac-${variant}"${autofocus ? html` autofocus` : ''}>
      <button class="search__clear" type="button" data-clear aria-label="Clear"${ctx.query ? '' : html` hidden`}>${icon('x')}</button>
      <button class="search__go" type="submit" aria-label="Search">${icon('search')}</button>
      <ul class="ac" id="ac-${variant}" role="listbox" aria-label="Suggestions" hidden></ul>
    </div>
    ${hidden.map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
    ${variant === 'hero' ? modePicker(ctx.prefs.home) : ''}
  </form>`;
}

function modePicker(selected) {
  return html`<fieldset class="modes">
    <legend class="sr-only">Search in</legend>
    ${TABS.map(
      (tab) => html`<label class="mode"><input type="radio" name="t" value="${tab.id}"${tab.id === selected ? html` checked` : ''}><span>${tab.id === 'web' ? 'Web' : tab.name}</span></label>`,
    )}
  </fieldset>`;
}

const menuButton = () =>
  html`<a class="iconbtn" href="/settings" data-menu-open aria-label="Menu" title="Menu">${icon('menu')}</a>`;

export function topbar(ctx, { tabs = true } = {}) {
  return html`<header class="topbar">
    <div class="topbar__row wrap">
      <a class="topbar__brand" href="/" aria-label="Cut Search home"><span class="logo-glow logo-glow--sm">${logoMark(30)}</span></a>
      ${searchForm(ctx)}
      <div class="topbar__actions">${menuButton()}</div>
    </div>
    ${tabs ? tabBar(ctx) : ''}
  </header>`;
}

function tabBar(ctx) {
  return html`<nav class="tabs wrap" aria-label="Search type">
    ${TABS.map(
      (tab) => html`<a class="${cx('tab', ctx.type === tab.id && 'is-active')}" href="${searchUrl(ctx, { t: tab.id }, { keepTypeParams: false })}"${ctx.type === tab.id ? html` aria-current="page"` : ''}>${tab.name}</a>`,
    )}
    <a class="tab tab--end" href="/settings">Settings</a>
  </nav>`;
}

export function homeHeader() {
  return html`<header class="homebar">
    <a href="/bangs">Bangs</a>
    <a href="/privacy">Privacy</a>
    <a href="/settings">Settings</a>
    ${menuButton()}
  </header>`;
}

export function drawer(ctx) {
  return html`<dialog class="drawer" id="drawer" aria-label="Menu">
    <div class="drawer__head">
      <span class="drawer__title">Menu</span>
      <button class="iconbtn" type="button" data-drawer-close aria-label="Close menu">${icon('x')}</button>
    </div>
    <nav class="drawer__nav">
      <a href="/settings">Settings</a>
      <a href="/privacy">Privacy</a>
      <a href="/bangs">Bangs</a>
      <a href="/opensearch.xml" data-add-search>Add Cut to your browser</a>
      <button type="button" data-shortcuts>Keyboard shortcuts</button>
    </nav>
    <div class="drawer__themes" role="radiogroup" aria-label="Theme">
      <span class="drawer__label">Theme</span>
      ${THEMES.map(
        (t) => html`<button class="${cx('drawer__theme', ctx.prefs.theme === t.id && 'is-on')}" type="button" data-set-theme="${t.id}" role="radio" aria-checked="${ctx.prefs.theme === t.id}">${t.name}</button>`,
      )}
    </div>
  </dialog>`;
}

function shortcutsDialog() {
  const keys = [
    ['/', 'Focus the search box'],
    ['j / ↓', 'Next result'],
    ['k / ↑', 'Previous result'],
    ['Enter / o', 'Open the selected result'],
    ['Shift + Enter', 'Open in a new tab'],
    ['m', 'Copy magnet link (torrents)'],
    ['Esc', 'Leave the search box'],
    ['?', 'Show this list'],
  ];
  return html`<dialog class="modal" id="shortcuts" aria-labelledby="shortcuts-title">
    <div class="modal__head"><h2 id="shortcuts-title">Keyboard shortcuts</h2><button class="iconbtn" type="button" data-modal-close aria-label="Close">${icon('x')}</button></div>
    <table class="keys">${keys.map(([k, d]) => html`<tr><td>${k.split(' / ').map((part, i) => html`${i ? ' or ' : ''}<kbd>${part}</kbd>`)}</td><td>${d}</td></tr>`)}</table>
  </dialog>`;
}

export function documentStart(ctx, { title, bodyClass = '', robots = 'noindex, nofollow', description } = {}) {
  const { prefs, fx } = ctx;
  const theme = prefs.theme;
  const flags = { ac: prefs.suggest !== 'off', newtab: prefs.newTab, infinite: prefs.infinite, keys: prefs.shortcuts, sound: prefs.sound };
  return html`<!doctype html>
<html lang="en" data-theme="${theme}" data-size="${prefs.size}" data-density="${prefs.density}"${fx.webfont ? '' : html` class="sysfont"`}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="${robots}">
<meta name="color-scheme" content="${theme === 'light' ? 'light' : theme === 'system' ? 'light dark' : 'dark'}">
${description ? html`<meta name="description" content="${description}">` : ''}
<title>${title}</title>
<link rel="icon" href="/static/img/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/static/img/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="search" type="application/opensearchdescription+xml" href="/opensearch.xml" title="Cut Search">
${fx.webfont ? html`<link rel="preload" href="/static/fonts/figtree-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>` : ''}
<link rel="stylesheet" href="/static/css/cut.css?v=${ctx.assetVersion}">
${fx.js ? html`<script src="/static/js/cut.js?v=${ctx.assetVersion}" defer></script>` : ''}
</head>
<body class="${bodyClass}"${Object.entries(flags).map(([k, v]) => html` data-${k}="${v ? '1' : '0'}"`)}>
<a class="skip" href="#main">Skip to content</a>
`;
}

export function documentEnd(ctx) {
  return html`${drawer(ctx)}${shortcutsDialog()}<div class="toast" role="status" aria-live="polite" hidden></div>
</body>
</html>`;
}

export function page(ctx, options, content) {
  return html`${documentStart(ctx, options)}${content}${documentEnd(ctx)}`;
}
