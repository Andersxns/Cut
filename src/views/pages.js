import { html } from '../util/html.js';
import { logoMark } from './icons.js';
import { page, topbar, homeHeader, searchForm } from './layout.js';
import { describeNetwork } from '../net/settings.js';
import { BANGS } from '../bangs.js';

export function homePage(ctx) {
  return page(
    ctx,
    {
      title: 'Cut Search',
      bodyClass: 'home-page',
      robots: 'index, follow',
      description: 'Cut Search is a private metasearch engine for the web, images, news, videos and torrents.',
    },
    html`${homeHeader()}
<main class="home" id="main">
  <h1 class="home__brand"><span class="logo-glow">${logoMark(56)}</span><span>Cut <span class="home__brand-product">Search</span></span></h1>
  <p class="home__tag">Private search for the web and torrents</p>
  ${searchForm(ctx, { variant: 'hero', autofocus: true })}
</main>`,
  );
}

// ---------- Privacy ----------

export function privacyPage(ctx) {
  return page(
    ctx,
    { title: 'Privacy · Cut Search', bodyClass: 'doc-page', robots: 'index, follow' },
    html`${topbar(ctx, { tabs: false })}
<main class="doc prose" id="main">
  <h1>Privacy</h1>
  <p class="doc__lead">Cut is a metasearch engine: it passes your search to other search engines and shows you what they return. It is built to keep nothing about you.</p>

  <h2>What Cut stores</h2>
  <p>Nothing that identifies you. There are no accounts, no analytics and no request logs. Searches and IP addresses are never written to disk.</p>
  <p>A few things are held in memory for a short time so the site works:</p>
  <ul>
    <li>Results from each engine are cached for 10 minutes so that “More results” loads quickly. Cache keys are hashed with a random value that changes every time Cut starts.</li>
    <li>Site icons and image thumbnails are cached for a few hours.</li>
    <li>Requests are rate-limited so upstream engines don’t block the server. The limiter keys on a salted hash of your IP address, keeps it for about two minutes, and the salt changes daily.</li>
  </ul>

  <h2>Cookies</h2>
  <p>Cut sets one cookie, <code>cut</code>, and only when you change a setting. It contains your settings (theme, region, safe search and which engines to use) and nothing else. You can see its exact contents on the <a href="/settings">settings page</a>.</p>

  <h2>What search engines see</h2>
  <p>Your browser only talks to Cut. Cut sends your query to the engines you have enabled from its own server, without your IP address, cookies or browser details. Suggestions, site icons and image previews are fetched the same way, along with a Global Privacy Control signal unless you turn it off.</p>
  <p>Cut can send all of this through a proxy or the Tor network, with a new Tor circuit for every search, and look up engines with DNS over HTTPS. This server currently uses: <strong>${describeNetwork(ctx.network)}</strong>. See <a href="/settings#connection">connection settings</a>.</p>

  <h2>Links</h2>
  <p>Result links point straight to the destination. Cut removes click-tracking redirects and tracking parameters such as <code>utm_source</code>, <code>fbclid</code> and <code>gclid</code>, replaces Google AMP pages with the original, and can open YouTube, Reddit, X and Medium links in privacy-friendly front-ends. Pages are served with <code>Referrer-Policy: no-referrer</code>, so the sites you visit aren’t told what you searched for.</p>
  <p>Result links are also checked, on Cut’s server, against public lists of phishing and malware sites.</p>

  <h2>Torrents</h2>
  <p>Cut only searches torrent listings published by public indexes. It doesn’t host or transfer files. When you open a magnet link, your torrent client connects to other peers, and they can see your IP address. Use a VPN in your torrent client if that concerns you, and only download material you have the right to.</p>

  <h2>Running your own copy</h2>
  <p>Cut is a small Node.js application. If you run it on your own computer or server, nobody else is in a position to see your searches.</p>
</main>`,
  );
}

// ---------- Bangs ----------

export function bangsPage(ctx) {
  const groups = new Map();
  for (const bang of BANGS) {
    if (!groups.has(bang.category)) groups.set(bang.category, []);
    groups.get(bang.category).push(bang);
  }
  return page(
    ctx,
    { title: 'Bangs · Cut Search', bodyClass: 'doc-page', robots: 'index, follow' },
    html`${topbar(ctx, { tabs: false })}
<main class="doc" id="main">
  <h1>Bangs</h1>
  <p class="doc__lead">Put a bang anywhere in a search to go straight to another site: <code>!w cats</code> searches Wikipedia, <code>!gh react</code> searches GitHub. Start a search with <code>\\</code> to go directly to the first result.</p>
  <p class="doc__note"><code>!i</code>, <code>!v</code>, <code>!n</code> and <code>!t</code> switch to Images, Videos, News and Torrents.</p>
  <p><input class="bang-filter" type="search" placeholder="Filter ${BANGS.length} bangs" aria-label="Filter bangs" data-bang-filter autocomplete="off"></p>
  ${[...groups].map(
    ([category, bangs]) => html`<section data-bang-group>
      <h2>${category}</h2>
      <table class="bangs">
        ${bangs.map(
          (b) => html`<tr data-bang="${[...b.triggers, b.name, b.domain].join(' ').toLowerCase()}">
            <td class="bangs__trigger">${b.triggers.map((t) => `!${t}`).join(' ')}</td>
            <td>${b.name}</td>
            <td class="bangs__domain">${b.domain}</td>
          </tr>`,
        )}
      </table>
    </section>`,
  )}
  <p data-bang-empty hidden>No bangs match.</p>
</main>`,
  );
}

// ---------- Errors ----------

export function errorPage(ctx, { status, title, message }) {
  return page(
    ctx,
    { title: `${title} · Cut Search`, bodyClass: 'doc-page' },
    html`${topbar(ctx, { tabs: false })}
<main class="doc" id="main">
  <h1>${title}</h1>
  <p class="doc__lead">${message}</p>
  <p class="doc__note">Error ${status} · <a href="/">Back to Cut</a></p>
</main>`,
  );
}
