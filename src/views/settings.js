import { html, cx } from '../util/html.js';
import { page, topbar } from './layout.js';
import { THEMES, SAFE_LEVELS, REGIONS, SEARCH_TYPES } from '../prefs.js';
import { WEB_ENGINES, TORRENT_SOURCES } from '../engines/registry.js';
import { SORTS } from '../search/torrents.js';
import { FRONTENDS } from '../privacy/links.js';
import { DOH_PROVIDERS, USER_AGENTS } from '../net/settings.js';
import { formatNumber, timeAgo } from '../util/text.js';

// ---------- Controls ----------

const checked = (on) => (on ? html` checked` : '');
const selected = (on) => (on ? html` selected` : '');

function check(name, label, desc, on, attrs = '') {
  return html`<label class="row row--check" data-row>
    <input type="checkbox" name="${name}" value="1"${checked(on)}${attrs}>
    <span class="row__text"><span class="row__label">${label}</span>${desc ? html`<span class="row__desc">${desc}</span>` : ''}</span>
  </label>`;
}

function radios(name, options, current, { stacked = false, label = '' } = {}) {
  return html`<fieldset class="${cx('radios', stacked && 'radios--stacked')}" data-row>
    ${label ? html`<legend class="row__label">${label}</legend>` : ''}
    ${options.map(
      ([value, text, desc]) => html`<label class="radio">
        <input type="radio" name="${name}" value="${value}"${checked(value === current)}>
        <span class="row__text"><span>${text}</span>${desc ? html`<span class="row__desc">${desc}</span>` : ''}</span>
      </label>`,
    )}
  </fieldset>`;
}

function select(name, label, options, current, desc = '') {
  return html`<div class="row row--field" data-row>
    <span class="row__text"><label class="row__label" for="f-${name}">${label}</label>${desc ? html`<span class="row__desc">${desc}</span>` : ''}</span>
    <select id="f-${name}" name="${name}">${options.map(([value, text]) => html`<option value="${value}"${selected(value === current)}>${text}</option>`)}</select>
  </div>`;
}

const group = (title, content, { id = '', desc = '' } = {}) => html`<div class="group" data-group${id ? html` id="${id}"` : ''}>
  <h3 class="group__title">${title}</h3>
  ${desc ? html`<p class="group__desc">${desc}</p>` : ''}
  ${content}
</div>`;

const pane = (id, title, content) => html`<section class="pane" id="${id}" data-pane><h2 class="pane__title">${title}</h2>${content}</section>`;

// ---------- Panes ----------

function generalPane(p) {
  return pane(
    'general',
    'General',
    html`${group(
      'Search page',
      html`${select('home', 'Search type selected on the home page', SEARCH_TYPES.map((t) => [t, t === 'web' ? 'Web' : t[0].toUpperCase() + t.slice(1)]), p.home)}
      ${check('newTab', 'Open results in a new tab', '', p.newTab)}
      ${check('infinite', 'Load more results automatically as you scroll', 'Instead of pressing “More results”.', p.infinite)}
      ${check('shortcuts', 'Keyboard shortcuts', html`Press <kbd>?</kbd> on any page to see them.`, p.shortcuts)}`,
    )}`,
  );
}

function searchPane(p) {
  return pane(
    'search',
    'Search',
    html`${group(
      'Region and safe search',
      html`${select('region', 'Region', REGIONS.map((r) => [r.code, r.name]), p.region, '“All regions” gives the most neutral results.')}
      ${radios('safe', SAFE_LEVELS.map((s) => [s.id, s.name, s.desc]), p.safe, { label: 'Safe search', stacked: true })}`,
    )}
    ${group(
      'Search suggestions',
      radios(
        'suggest',
        [
          ['ddg', 'Show suggestions as you type', 'Fetched from DuckDuckGo by Cut’s server, so the provider never sees you.'],
          ['bangs', 'Only suggest !bang shortcuts', 'Nothing you type leaves Cut.'],
          ['off', 'Don’t show suggestions', ''],
        ],
        p.suggest,
        { stacked: true },
      ),
    )}
    ${group(
      'Results page',
      html`${check('instant', 'Instant answers', 'Calculator, conversions, weather, definitions and more.', p.instant)}
      ${check('infobox', 'Information panel', 'A summary from Wikipedia beside results about people, places and things.', p.infobox)}
      ${check('related', 'Related searches', '', p.related)}
      ${check('bold', 'Bold your search terms in results', '', p.bold)}
      ${check('favicons', 'Site icons', 'Loaded through Cut’s image proxy.', p.favicons)}`,
    )}
    ${group(
      'Search engines',
      html`${WEB_ENGINES.map((e) => html`<label class="row row--check" data-row><input type="checkbox" name="engines" value="${e.id}"${checked(p.engines.includes(e.id))}><span class="row__text"><span class="row__label">${e.name}</span><span class="row__desc">${e.description}</span></span></label>`)}`,
      { desc: 'Cut asks every enabled engine at the same time and merges the results.' },
    )}
    ${group(
      'Site preferences',
      html`<div class="row row--area" data-row>
        <label class="row__label" for="f-block">Never show results from</label>
        <textarea id="f-block" name="blockSites" rows="3" placeholder="pinterest.com&#10;example.org" spellcheck="false">${p.blockSites.join('\n')}</textarea>
      </div>
      <div class="row row--area" data-row>
        <label class="row__label" for="f-boost">Rank these sites higher</label>
        <textarea id="f-boost" name="boostSites" rows="3" placeholder="wikipedia.org&#10;stackoverflow.com" spellcheck="false">${p.boostSites.join('\n')}</textarea>
      </div>`,
      { desc: 'One site per line. Subdomains are included. Up to 40 sites each.' },
    )}`,
  );
}

function privacyPane(p, threats) {
  const etpCard = (value, title, desc, items) => html`<label class="${cx('choice', p.etp === value && 'is-on')}">
    <input type="radio" name="etp" value="${value}"${checked(p.etp === value)} data-etp>
    <span class="choice__title">${title}</span>
    <span class="choice__desc">${desc}</span>
    ${items.length ? html`<ul class="choice__list">${items.map((i) => html`<li>${i}</li>`)}</ul>` : ''}
  </label>`;
  const status = threats.count
    ? `${formatNumber(threats.count)} sites from ${threats.feeds.join(', ')}. Updated ${timeAgo(threats.updated)}.`
    : threats.loading
      ? 'Downloading the lists…'
      : threats.error
        ? `The lists couldn’t be downloaded (${threats.error}). Cut will try again later.`
        : 'The lists are downloaded when first needed.';
  return pane(
    'privacy',
    'Privacy & Security',
    html`${group(
      'Enhanced Tracking Protection',
      html`<div class="choices">
        ${etpCard('standard', 'Standard', 'Balanced for protection and compatibility.', ['Tracking parameters removed from links', 'Click-tracking redirects undone', 'AMP pages replaced with the original'])}
        ${etpCard('strict', 'Strict', 'Stronger protection. A few links may break.', ['Everything in Standard', 'Referral and affiliate parameters removed', 'Results from ad and tracking domains hidden'])}
        ${etpCard('custom', 'Custom', 'Choose exactly what to remove.', [])}
      </div>
      <div class="subrows" data-etp-custom>
        ${select('strip', 'Remove tracking from links', [['known', 'Known trackers (utm_*, fbclid, gclid…)'], ['aggressive', 'Trackers, referral and affiliate codes'], ['off', 'Don’t change links']], p.strip)}
        ${check('unwrap', 'Undo click-tracking redirects', 'Links go straight to the page instead of through Google, Facebook or Bing redirects.', p.unwrap)}
        ${check('amp', 'Replace AMP pages with the original', 'Avoids Google’s AMP cache.', p.amp)}
        ${check('adblock', 'Hide results from ad and tracking domains', 'DoubleClick, Taboola, Outbrain, link shorteners with ads and similar.', p.adblock)}
      </div>`,
      { id: 'tracking', desc: 'Cut cleans every result link before you see it. Choose Custom to pick each protection yourself.' },
    )}
    ${group(
      'Privacy-friendly alternatives',
      html`${Object.entries(FRONTENDS).map(
        ([id, service]) => html`<div class="row row--frontend" data-row>
          <label class="row__label" for="f-fe-${id}">Open ${service.name} links with</label>
          <select id="f-fe-${id}" name="fe_${id}">
            <option value="off"${selected(p[`fe_${id}`] === 'off')}>${service.name} itself</option>
            ${Object.entries(service.options).map(([key, option]) => html`<option value="${key}"${selected(p[`fe_${id}`] === key)}>${option.name}</option>`)}
          </select>
          <input type="url" name="fi_${id}" value="${p[`fi_${id}`]}" placeholder="Default server, or your own https://…" aria-label="${service.name} alternative server" spellcheck="false">
        </div>`,
      )}`,
      { id: 'frontends', desc: 'Rewrites result links to open-source front-ends that don’t track you. Public servers come and go; you can enter your own.' },
    )}
    ${group(
      'Website Privacy Preferences',
      html`${check('gpc', 'Tell search engines not to sell or share my data', 'Sends the Global Privacy Control signal with every request Cut makes.', p.gpc)}
      ${check('dnt', 'Send a “Do Not Track” request', 'An older signal that most sites ignore.', p.dnt)}
      ${radios(
        'referrer',
        [
          ['none', 'Don’t tell sites where you came from', 'Recommended. Sites can’t see that you came from a search.'],
          ['origin', 'Send only “from Cut”', 'Sites see the address of this Cut server, but never your search.'],
        ],
        p.referrer,
        { label: 'When you open a result', stacked: true },
      )}`,
    )}
    ${group(
      'Cookies and Site Data',
      html`${radios(
        'keep',
        [
          ['365', 'Keep my settings for a year', ''],
          ['30', 'Keep my settings for 30 days', ''],
          ['session', 'Forget my settings when I close the browser', ''],
        ],
        p.keep,
        { stacked: true },
      )}
      <p class="row__desc">Cut’s only cookie holds these settings — no identifier. With every setting at its default, there is no cookie at all.</p>
      <p><button class="btn btn--sm" type="submit" form="clear-form">Clear all Cut data</button></p>`,
    )}
    ${group(
      'History',
      html`${check('post', 'Use POST requests', 'Keeps searches out of the address bar and browser history. Result pages can’t be bookmarked.', p.post)}
      ${check('hideQuery', 'Hide searches from page titles', 'Tabs and history show “Cut Search” instead of what you searched for.', p.hideQuery)}`,
    )}
    ${group(
      'Permissions',
      html`<p class="row__desc">Cut never asks for your location, camera, microphone or notifications, and blocks them for good measure.</p>
      ${check('sound', 'Play a sound when a timer ends', '', p.sound)}`,
    )}
    ${group(
      'Images',
      check('proxyImages', 'Load images through Cut', 'Thumbnails and previews come from Cut, so image hosts never see your IP address. Turning this off is faster but less private.', p.proxyImages),
    )}
    ${group(
      'Security',
      html`${radios(
        'safeBrowsing',
        [
          ['warn', 'Warn me about dangerous and deceptive sites', ''],
          ['hide', 'Hide dangerous and deceptive sites', ''],
          ['off', 'Don’t check', ''],
        ],
        p.safeBrowsing,
        { label: 'Deceptive content and dangerous software protection', stacked: true },
      )}
      <p class="row__desc">${status} Checks happen on Cut’s server; nothing you search is sent anywhere.</p>
      ${radios(
        'safeDownloads',
        [
          ['warn', 'Warn me about suspicious torrents', 'Disguised program files, malware bait and torrents flagged by Knaben.'],
          ['hide', 'Hide suspicious torrents', ''],
          ['off', 'Don’t check', ''],
        ],
        p.safeDownloads,
        { label: 'Dangerous downloads', stacked: true },
      )}
      ${radios(
        'https',
        [
          ['upgrade', 'Upgrade result links to HTTPS', 'Links to http:// pages open over an encrypted connection.'],
          ['mark', 'Label links that don’t use HTTPS', ''],
          ['off', 'Leave links as they are', ''],
        ],
        p.https,
        { label: 'HTTPS-Only Mode', stacked: true },
      )}`,
      { id: 'security' },
    )}
    ${group(
      'Security level',
      html`<div class="choices">
        ${[
          ['standard', 'Standard', 'All of Cut’s features are enabled.'],
          ['safer', 'Safer', 'No site icons, thumbnails or web fonts. Pages use only text and Cut’s own files.'],
          ['safest', 'Safest', 'Also turns off JavaScript and shows images as links. Pages are text only.'],
        ].map(
          ([value, title, desc]) => html`<label class="${cx('choice', p.level === value && 'is-on')}">
            <input type="radio" name="level" value="${value}"${checked(p.level === value)}>
            <span class="choice__title">${title}</span><span class="choice__desc">${desc}</span>
          </label>`,
        )}
      </div>`,
      { desc: 'Like Tor Browser’s security levels: turn off features that could be used against you.' },
    )}
    ${group('Data collection', html`<p class="row__desc">Cut collects nothing: no telemetry, crash reports, studies or analytics. There’s nothing to switch off.</p>`)}`,
  );
}

function torrentsPane(p) {
  return pane(
    'torrents',
    'Torrents',
    html`${group(
      'Results',
      html`${select('torrentSort', 'Sort torrents by', SORTS.map((s) => [s.id, s.name]), p.torrentSort)}
      ${select('minSeeders', 'Hide torrents with fewer seeders than', [['0', 'Show all'], ['1', '1 (hide dead torrents)'], ['5', '5'], ['20', '20']], p.minSeeders)}
      ${check('trackers', 'Add public trackers to magnet links', 'Helps torrents find peers faster. Trackers can see which torrents you download.', p.trackers)}`,
    )}
    ${group(
      'Torrent sources',
      html`${TORRENT_SOURCES.map((s) => html`<label class="row row--check" data-row><input type="checkbox" name="torrents" value="${s.id}"${checked(p.torrents.includes(s.id))}><span class="row__text"><span class="row__label">${s.name}</span><span class="row__desc">${s.description}</span></span></label>`)}`,
    )}`,
  );
}

function appearancePane(p) {
  return pane(
    'appearance',
    'Appearance',
    html`${group('Theme', radios('theme', THEMES.map((t) => [t.id, t.name, t.desc]), p.theme, { stacked: true }))}
    ${group('Text size', radios('size', [['s', 'Small'], ['m', 'Default'], ['l', 'Large']], p.size))}
    ${group('Density', radios('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']], p.density))}`,
  );
}

// After a save the page lands on this pane, so its notices are shown here.
function connectionPane(network, status) {
  const s = network.settings;
  const locked = !network.canManage && !network.tokenAllowed;
  const statusText = NOTICES[`network:${status}`];
  const input = (name, value, attrs = '') => html`<input name="${name}" value="${value}"${attrs}>`;
  return pane(
    'connection',
    'Connection',
    html`<form class="netform" method="post" action="/settings/network" data-network>
      <input type="hidden" name="_full" value="1">
      ${statusText ? html`<p class="${WARNINGS.has(status) ? 'notice notice--warn' : 'notice'}">${statusText}</p>` : ''}
      <p class="notice notice--quiet">Currently: <strong>${network.description}</strong></p>
      ${network.errors.length ? html`<ul class="notice notice--error">${network.errors.map((e) => html`<li>${e}</li>`)}</ul>` : ''}
      ${locked ? html`<p class="notice">These settings apply to the whole server, so they can only be changed on the computer running Cut.</p>` : ''}
      <fieldset class="netform__body"${locked ? html` disabled` : ''}>
        ${group(
          'Connection settings',
          html`<fieldset class="radios radios--stacked" data-row>
            <legend class="row__label">How Cut connects to search engines</legend>
            <label class="radio"><input type="radio" name="mode" value="direct"${checked(s.mode === 'direct')}><span class="row__text"><span>No proxy</span></span></label>
            <label class="radio"><input type="radio" name="mode" value="system"${checked(s.mode === 'system')}><span class="row__text"><span>Use system proxy settings</span><span class="row__desc">From the HTTP_PROXY, HTTPS_PROXY and NO_PROXY environment variables.</span></span></label>
            <label class="radio"><input type="radio" name="mode" value="manual"${checked(s.mode === 'manual')}><span class="row__text"><span>Manual proxy configuration</span></span></label>
            <div class="subrows" data-mode-panel="manual">
              <div class="fields">
                <label>Type <select name="proxyType">${[['http', 'HTTP'], ['https', 'HTTPS'], ['socks4', 'SOCKS v4'], ['socks5', 'SOCKS v5']].map(([v, t]) => html`<option value="${v}"${selected(s.proxyType === v)}>${t}</option>`)}</select></label>
                <label class="fields__grow">Host ${input('proxyHost', s.proxyHost, html` placeholder="proxy.example.com" spellcheck="false" autocomplete="off"`)}</label>
                <label>Port ${input('proxyPort', s.proxyPort, html` type="number" min="1" max="65535" class="port"`)}</label>
              </div>
              <div class="fields">
                <label class="fields__grow">Username ${input('proxyUser', s.proxyUser, html` autocomplete="off" spellcheck="false"`)}</label>
                <label class="fields__grow">Password <input type="password" name="proxyPass" value="${s.proxyPass}" autocomplete="new-password"></label>
              </div>
              <label class="radio"><input type="checkbox" name="remoteDns" value="1"${checked(s.remoteDns)}><span class="row__text"><span>Proxy DNS when using SOCKS</span><span class="row__desc">Recommended. Host names are looked up by the proxy, not on this computer.</span></span></label>
            </div>
            <label class="radio"><input type="radio" name="mode" value="tor"${checked(s.mode === 'tor')}><span class="row__text"><span>Tor</span><span class="row__desc">Needs Tor running on this computer: the Tor service (port 9050) or Tor Browser (port 9150).</span></span></label>
            <div class="subrows" data-mode-panel="tor">
              <div class="fields">
                <label class="fields__grow">Tor SOCKS host ${input('torHost', s.torHost, html` spellcheck="false"`)}</label>
                <label>Port ${input('torPort', s.torPort, html` type="number" min="1" max="65535" class="port" list="tor-ports"`)}</label>
                <datalist id="tor-ports"><option value="9050">Tor service</option><option value="9150">Tor Browser</option></datalist>
              </div>
              ${radios(
                'isolation',
                [
                  ['search', 'New circuit for every search', 'Engines can’t link one search to the next. Slightly slower.'],
                  ['session', 'Change circuit every 10 minutes', ''],
                  ['none', 'Share one circuit', 'Tor still changes circuits on its own schedule.'],
                ],
                s.isolation,
                { label: 'Circuits', stacked: true },
              )}
            </div>
          </fieldset>
          <div class="row row--field" data-row>
            <span class="row__text"><label class="row__label" for="f-bypass">No proxy for</label><span class="row__desc">Separate with commas. “.example.com” includes subdomains.</span></span>
            ${input('bypass', s.bypass, html` id="f-bypass" spellcheck="false"`)}
          </div>`,
        )}
        ${group(
          'DNS over HTTPS',
          html`${radios(
            'doh',
            [
              ['off', 'Off', 'Use this computer’s normal DNS.'],
              ['fallback', 'Default protection', 'Look up engines over HTTPS; use normal DNS only if that fails.'],
              ['strict', 'Max protection', 'Always use DNS over HTTPS. If it fails, the search fails.'],
            ],
            s.doh,
            { stacked: true },
          )}
          <div class="fields">
            <label>Provider <select name="dohProvider">${Object.entries(DOH_PROVIDERS).map(([k, v]) => html`<option value="${k}"${selected(s.dohProvider === k)}>${v.name}</option>`)}</select></label>
            <label class="fields__grow">Custom address ${input('dohUrl', s.dohUrl, html` type="url" placeholder="https://dns.example/dns-query" spellcheck="false"`)}</label>
          </div>
          <p class="row__desc">Applies to direct connections. With a proxy or Tor, look-ups happen at the proxy.</p>`,
        )}
        ${group(
          'Identity and timeouts',
          html`<div class="fields">
            <label>User agent sent to engines <select name="userAgent">${Object.entries(USER_AGENTS).map(([k, v]) => html`<option value="${k}"${selected(s.userAgent === k)}>${v.name}</option>`)}</select></label>
            <label class="fields__grow">Custom user agent ${input('customUserAgent', s.customUserAgent, html` spellcheck="false"`)}</label>
          </div>
          ${select('timeout', 'Wait for each engine', [['auto', 'Automatic (longer over Tor)'], ['3', '3 seconds'], ['5', '5 seconds'], ['8', '8 seconds'], ['12', '12 seconds'], ['20', '20 seconds']], s.timeout)}`,
        )}
        ${!network.canManage && network.tokenAllowed ? html`<div class="row row--field"><label class="row__label" for="f-token">Admin token</label><input id="f-token" type="password" name="admin_token" autocomplete="off"></div>` : ''}
        <p class="actions">
          <button class="btn btn--primary" type="submit">Save connection settings</button>
          <button class="btn" type="button" data-network-test>Test connection</button>
          <span class="actions__status" data-network-status role="status" aria-live="polite"></span>
        </p>
      </fieldset>
    </form>`,
  );
}

function dataPane(code, cookie, notice) {
  return pane(
    'data',
    'Your data',
    html`${group(
      'Settings code',
      html`<div class="row row--area" data-row>
        <label class="row__label" for="f-code">Your settings as a code</label>
        <textarea id="f-code" rows="2" readonly spellcheck="false" data-code>${code}</textarea>
        <p><button class="btn btn--sm" type="button" data-copy-from="[data-code]" data-copy-label="Settings code copied">Copy code</button></p>
      </div>
      <form class="row row--area" method="post" action="/settings/import" data-row>
        <label class="row__label" for="f-import">Paste a code from another device</label>
        <textarea id="f-import" name="code" rows="2" spellcheck="false" placeholder="cut1.…"></textarea>
        <p><button class="btn btn--sm" type="submit">Import settings</button> ${notice.import === 'invalid' ? html`<span class="warning">That isn’t a valid settings code.</span>` : ''}</p>
      </form>`,
      { desc: 'Move your settings to another browser without an account. The code contains only your settings.' },
    )}
    ${group(
      'Stored on this device',
      html`${cookie ? html`<pre class="cookie">${cookie}</pre>` : html`<p class="row__desc">Nothing. Your settings are all at their defaults, so Cut doesn’t store a cookie.</p>`}
      <p><button class="btn btn--sm" type="submit" form="clear-form">Clear all Cut data</button></p>`,
    )}`,
  );
}

const NOTICES = {
  saved: 'Settings saved.',
  cleared: 'All Cut data on this device was cleared.',
  'import:ok': 'Settings imported.',
  'network:saved': 'Connection settings saved.',
  'network:denied': 'Connection settings can only be changed on the computer running Cut.',
  'network:unsaved': 'Connection settings are in use, but Cut couldn’t write them to data/network.json, so they’ll reset when Cut restarts.',
};
const WARNINGS = new Set(['denied', 'unsaved']);

export function settingsPage(ctx, { notice = {}, returnTo = '', code, cookie, threats, network }) {
  const p = ctx.prefs;
  const message =
    (notice.saved && NOTICES.saved) ||
    (notice.cleared && NOTICES.cleared) ||
    (notice.import === 'ok' && NOTICES['import:ok']) ||
    '';
  const nav = [
    ['general', 'General'],
    ['search', 'Search'],
    ['privacy', 'Privacy & Security'],
    ['torrents', 'Torrents'],
    ['appearance', 'Appearance'],
    ['connection', 'Connection'],
    ['data', 'Your data'],
  ];
  return page(
    ctx,
    { title: 'Settings · Cut Search', bodyClass: 'doc-page prefs-page' },
    html`${topbar(ctx, { tabs: false })}
<div class="prefs wrap">
  <aside class="prefs__side">
    <input class="prefs__find" type="search" placeholder="Find in settings" aria-label="Find in settings" data-prefs-find>
    <nav class="prefs__nav" aria-label="Settings sections">${nav.map(([id, name]) => html`<a href="#${id}">${name}</a>`)}</nav>
  </aside>
  <main class="prefs__main" id="main">
    ${message ? html`<p class="notice">${message}</p>` : ''}
    <p class="prefs__empty" data-prefs-empty hidden>No settings match your search.</p>
    <form method="post" action="/settings" data-settings>
      <input type="hidden" name="_full" value="1">
      ${returnTo ? html`<input type="hidden" name="return" value="${returnTo}">` : ''}
      ${generalPane(p)}
      ${searchPane(p)}
      ${privacyPane(p, threats)}
      ${torrentsPane(p)}
      ${appearancePane(p)}
      <div class="prefs__bar">
        <button class="btn btn--primary" type="submit">Save</button>
        <button class="btn" type="submit" name="reset" value="1">Reset to defaults</button>
        <span class="actions__status" data-settings-status role="status" aria-live="polite"></span>
      </div>
    </form>
    ${connectionPane(network, notice.network)}
    ${dataPane(code, cookie, notice)}
  </main>
</div>
<form id="clear-form" method="post" action="/settings/clear" hidden></form>`,
  );
}
