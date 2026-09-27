<div align="center">

<img src="public/img/icon-512.png" width="96" height="96" alt="Cut logo">

# Cut

**A private web browser and search engine.**
Cut Browser is a Firefox-based browser for Windows and Linux, laid out like Zen Browser, with Cut Search built in: a metasearch engine for the web, images, videos, news and torrents that runs on your own computer, strips the tracking out of every link and keeps no record of you.

[![Build](https://github.com/Andersxns/Cut/actions/workflows/build.yml/badge.svg)](https://github.com/Andersxns/Cut/actions/workflows/build.yml)
[![Cut Search: MIT](https://img.shields.io/badge/Cut%20Search-MIT-blue.svg)](LICENSE)
[![Cut Browser: MPL 2.0](https://img.shields.io/badge/Cut%20Browser-MPL%202.0-blue.svg)](browser/LICENSE)
![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20Linux-lightgrey)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/browser-dark.png">
  <img src="docs/screenshots/browser.png" alt="Cut Browser showing Cut Search results" width="900">
</picture>

</div>

## Contents

- [Download and install](#download-and-install)
- [Cut Browser](#cut-browser)
- [Cut Search](#cut-search)
- [Run Cut Search on its own](#run-cut-search-on-its-own)
- [Build from source](#build-from-source)
- [Contributing](#contributing)
- [Code signing policy](#code-signing-policy)
- [License](#license)

## Download and install

Cut Browser's installers are built automatically by the [Build workflow](https://github.com/Andersxns/Cut/actions/workflows/build.yml). There are two places to get them:

- **Releases**: each version is published on the [**Releases page**](https://github.com/Andersxns/Cut/releases/latest), with the files below and a `SHA256SUMS.txt` to check your download.
- **Latest build**: every change to the default branch is built too. Open the newest run with a green tick in the [Build workflow](https://github.com/Andersxns/Cut/actions/workflows/build.yml), scroll down to **Artifacts** and download **cut-browser-Windows** or **cut-browser-Linux**. Each is a zip with the files below for that system. You need to be signed in to GitHub, and builds are kept for 90 days.

### Windows (10 and 11)

| File | Use it for |
| --- | --- |
| `Cut-Browser-<version>-Setup-x64.exe` | The installer, for 64-bit Windows. |

The installer puts Cut Browser in your user account, so it doesn't need administrator rights. It adds a Start menu shortcut (and a desktop one if you like), registers Cut Browser so you can make it your default browser in **Settings → Apps → Default apps**, and adds an uninstaller to **Settings → Apps → Installed apps**. Windows SmartScreen warns about installers that aren't code-signed, such as the builds from the Actions tab: choose **More info → Run anyway**. Each release's notes say whether its installer is signed (see the [code signing policy](#code-signing-policy)).

To install without questions, run `Cut-Browser-<version>-Setup-x64.exe /S`, optionally with `/D=<folder>` and `/NoShortcut`; `uninstall.exe /S` in the install folder removes it again (add `/RemoveData` to delete your profile too).

### Linux

| File | Use it for |
| --- | --- |
| `cut-browser_<version>+firefox<firefox version>_amd64.deb` | Debian, Ubuntu, Linux Mint, Pop!_OS… `sudo apt install ./cut-browser_*_amd64.deb` |
| `cut-browser-<version>-linux-x86_64.tar.xz` | Any other 64-bit distribution. Unpack it and run `./install.sh` (just for you) or `sudo ./install.sh --system` (for everyone). |

### Updates

Cut Browser doesn't update itself from Mozilla, because Mozilla's updates would turn it back into plain Firefox. Security fixes come as new Cut Browser releases instead, built on each new Firefox release: install the new version over the old one and your bookmarks, history and settings stay. **Menu → Help → About Cut** shows the Firefox version you're on. To hear about new versions, choose **Watch → Custom → Releases** at the top of this page.

## Cut Browser

Cut Browser is built on Firefox: the same engine, the same extensions and all of Firefox's settings, with a calmer layout, stricter privacy defaults and Cut Search built in.

- **Tabs down the side.** A full-height sidebar holds your tabs, with pinned tabs as tiles and tab groups, and the page sits in the window as a rounded card.
- **A floating address bar.** Start typing and the address bar opens in the middle of the window, over the dimmed page, with suggestions from Cut Search.

  <img src="docs/screenshots/address-bar.png" alt="The floating address bar with suggestions from Cut Search" width="820">

- **Split view.** Two tabs side by side, each with its own page.

  <img src="docs/screenshots/split-view.png" alt="Split view: Cut Search results beside a Wikipedia article" width="820">

- **Compact mode** (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd>). The sidebar and toolbar tuck away and slide back when you point at the window's edge, and the page gets the whole window.

  <img src="docs/screenshots/compact.jpg" alt="Compact mode: Cut Search image results fill the window" width="820">

- **Private by default.**
  - No telemetry, studies, experiments or crash reports, and none of Mozilla's data-collection prompts.
  - Enhanced Tracking Protection is set to *Strict*; HTTPS-Only Mode, Global Privacy Control and bounce-tracking protection are on, and cookie banners are rejected where possible.
  - No prefetching or speculative connections, no WebRTC local-address leaks and no background check-ins.
  - AI features, sponsored shortcuts and stories, Firefox Suggest and Pocket are off.
  - uBlock Origin is installed on first run.
- **Cut Search built in.** It runs on your own computer and starts and stops with the browser. It listens only on `127.0.0.1`, the computer's own loopback address, which nothing on your network or the internet can reach. It's the default search in normal and private windows and supplies the address bar's suggestions. You can point Cut Browser at your own Cut Search server instead, or choose any other search engine.
- **Firefox's own settings**, all still there, plus a **Cut Browser** section for the layout and Cut Search. Every privacy default above is a normal Firefox setting you can change.

  <img src="docs/screenshots/settings.png" alt="The Cut Browser section of Settings" width="820">

Profiles live in `%APPDATA%\Cut` on Windows and `~/.cut` on Linux, separate from any Firefox profile. How Cut Browser is made, and its known limitations, are in [browser/README.md](browser/README.md).

## Cut Search

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/search-home-dark.png">
  <img src="docs/screenshots/search-home.png" alt="The Cut Search home page" width="820">
</picture>

**Cut Search** is a private metasearch engine for the web, images, news, videos and torrents. It asks several search engines at once, merges what they say, strips the tracking out of every link, and forgets you the moment the page is sent. It looks and feels like DuckDuckGo, and it's a small Node.js app with two dependencies (cheerio for parsing, undici for networking). It's built into Cut Browser, and it also runs on its own, on your computer or as a website for other people (see [Run Cut Search on its own](#run-cut-search-on-its-own)).

### What it does

| Tab | Sources | Notes |
| --- | --- | --- |
| **All** (web) | DuckDuckGo, Bing, Wikipedia, Marginalia · optional Mwmbl, Wiby | Queried in parallel, merged by weighted reciprocal-rank fusion. Pages several engines agree on rise; duplicates fold together. |
| **Images** | DuckDuckGo → Bing fallback | Justified grid, lightbox, filters for size, color, type, layout and license. |
| **Videos** | DuckDuckGo → YouTube fallback | Links straight to the host; players are never embedded. |
| **News** | DuckDuckGo + Bing News | Blended and de-duplicated; sort by relevance or newest. |
| **Torrents** | The Pirate Bay, Nyaa, Torrents-CSV, Knaben, Internet Archive · optional BT4G | Merged by info hash, relevance-filtered, with seed health, category filters, sorting, magnet links and `.torrent` files where available. |

<img src="docs/screenshots/search-torrents.png" alt="Cut Search torrent results for Big Buck Bunny" width="820">

Also included:

- **Instant answers**: calculator, unit and currency conversion (ECB rates),
  weather (Open-Meteo), world clock, dictionary (Wiktionary), color codes,
  hashes, Base64/URL encoding, UUIDs, dice, coin flips, random numbers,
  timestamps, lorem ipsum, a stopwatch and a timer. Passwords are generated
  in your browser, never on the server.
- **Knowledge panel** from DuckDuckGo's Instant Answer API and Wikipedia.
- **!bangs**: 93 shortcuts (`!w`, `!gh`, `!yt`, `!tpb`…), usable anywhere in a
  query. `!i`, `!v`, `!n` and `!t` switch tabs inside Cut Search, and a
  leading `\` jumps straight to the first result.
- **Autocomplete** proxied through Cut Search, with bang suggestions.
- **Five themes**: System, Light, Dark, Midnight (true black) and Terminal.
- **Keyboard shortcuts**: `/` to search, `j`/`k` to move between results,
  `Enter` to open, `m` to copy a magnet link, `?` for help.
- **OpenSearch** support, so you can add Cut Search to your browser's search bar.
- Works without JavaScript; JavaScript only adds conveniences.

Results pages stream: the header and a skeleton are sent immediately, and the
results follow as soon as the main engines answer. A slow minor engine gets a
short grace period rather than holding up the page, and its results are cached
for the next identical search.

### Settings

<img src="docs/screenshots/search-settings.png" alt="The Privacy & Security section of Cut Search's settings" width="820">

The settings page follows Firefox's: a sidebar of sections, a *Find in
Settings* box, and changes that apply as you make them (a Save button covers
browsers without JavaScript).

- **General**: the tab the home page starts on, opening results in a new tab,
  infinite scroll and keyboard shortcuts.
- **Search**: region and safe search; suggestions (DuckDuckGo, bangs only, or
  off); instant answers, the knowledge panel, related searches, bold query
  words and site icons; which web engines to ask; sites to **block** from
  results or **boost** to the top.
- **Privacy & Security**
  - *Enhanced Tracking Protection*: Standard, Strict or Custom, as in Firefox.
    Standard unwraps redirect links (Google, Bing, DuckDuckGo, Facebook,
    Reddit, YouTube, Steam, affiliate networks…), swaps AMP pages for the
    original and strips known tracking parameters. Strict also removes
    referral and affiliate codes, trims Amazon links down to the product, and
    hides results on ad and tracking domains. Custom lets you pick each one.
  - *Privacy-friendly alternatives*: rewrite YouTube links to Invidious or
    Piped, Reddit to old.reddit or Redlib, X/Twitter to Nitter or XCancel and
    Medium to Scribe, on a public instance or your own.
  - *Website Privacy Preferences*: Global Privacy Control (on by default) and
    Do Not Track, sent with every request Cut Search makes; and whether sites
    you click through to may learn that you came from Cut Search.
  - *Cookies and Site Data*: keep the settings cookie for a year, 30 days, or
    until the browser closes; clear it with one button.
  - *History*: search with POST so queries stay out of the address bar and
    history, and keep queries out of page titles.
  - *Permissions* and *Images*: the timer's sound; whether thumbnails load
    through Cut Search (private) or directly (faster).
  - *Security*: warnings for dangerous and deceptive sites (URLhaus, Phishing
    Army and OpenPhish lists, checked on Cut Search's server — nothing you
    search is sent to them), warnings for suspicious torrents (disguised `.exe`
    files, programs in media torrents, "codec required" scams), and HTTPS-Only
    Mode (upgrade links, or only mark insecure ones).
  - *Security level*: Standard, Safer or Safest, like Tor Browser. Safer drops
    web fonts, site icons and thumbnails. Safest also turns JavaScript off
    (`script-src 'none'`) and lists images as links instead of loading them.
- **Torrents**: default sort, a minimum seeder count, whether magnet links
  include public trackers, and which sources to search.
- **Appearance**: theme, text size and density.
- **Connection**: proxies, Tor and DNS over HTTPS — see below.
- **Your data**: the exact contents of Cut Search's cookie, and a settings code
  (`cut1.…`) that copies your settings to another browser without an account.

Personal settings live in one cookie in your browser and never on the server.
With everything at its default, Cut Search sets no cookie at all.

### Proxies, Tor and DNS over HTTPS

<img src="docs/screenshots/search-connection.png" alt="The Connection section of Cut Search's settings" width="820">

The *Connection* section decides how Cut Search reaches the search engines.
It applies to everyone using the instance, so it can only be changed from the
computer running Cut Search (a loopback connection with a `localhost` Host
header, which also defeats DNS rebinding), or by anyone who knows
`CUT_ADMIN_TOKEN`. Choices are saved to `data/network.json` (on Linux and
macOS, readable only by the account running Cut Search), since they can
include proxy credentials.

- **No proxy**, **use system proxy settings** (`HTTP(S)_PROXY`, `NO_PROXY`), or
  a **manual proxy**: HTTP, HTTPS, SOCKS4/4a or SOCKS5, with an optional
  username and password, and host names resolved by the proxy (like Firefox's
  "Proxy DNS when using SOCKS v5") so your DNS server never sees them.
- **Tor**: point Cut Search at a Tor SOCKS port — `9050` for the tor service,
  `9150` for a running Tor Browser. Circuit isolation gives **each search its
  own circuit** by default, so the engines can't link your searches together
  by exit address. It can also rotate every 10 minutes or share one circuit.
- **No proxy for**: hosts and domains that bypass the proxy.
- **DNS over HTTPS** with Cloudflare, Quad9, Mullvad, AdGuard, NextDNS, Google or
  your own resolver — either falling back to system DNS when it fails, or
  strict (never falling back).
- **Identity and timeouts**: the browser Cut Search presents itself as
  (Firefox, Chrome, Safari, Tor Browser or custom), and how long to wait for
  engines. *Automatic* allows more time through a proxy and more still through
  Tor.

*Test connection* fetches Tor Project's check page through the current
settings and reports the exit address and whether it is a Tor exit.

To run Cut Search over Tor, start Tor and then either choose *Tor* in settings
or start Cut Search with `CUT_TOR=1` (or `CUT_PROXY=socks5h://127.0.0.1:9050`).
Expect searches to be slower and some engines to refuse Tor exits; Cut Search
shows results from whichever engines answer.

### Privacy model

- **No logs.** There is no request logger and no analytics. Errors are logged
  without request details. The only file Cut Search writes is
  `data/network.json`, when whoever runs it saves connection settings.
- **No identifiers.** The only cookie holds the settings you choose (theme,
  region, engines…). Two people with the same settings send identical cookies.
- **Engines never see your browser.** Cut Search's server talks to every
  upstream engine, without cookies. Autocomplete, favicons and every thumbnail
  are proxied too, so the sites in your results don't see your IP address
  until you click through. The engines see the server's address: your own when
  Cut Search runs on your computer, as it does in Cut Browser. Add a proxy or
  Tor (above) and they see the proxy's or the Tor exit's instead.
- **Links, uncut.** Redirect wrappers are unwrapped, AMP pages replaced, and
  tracking parameters like `utm_*`, `fbclid`, `gclid` and `msclkid` stripped
  before a link reaches you (see *Enhanced Tracking Protection*).
- **Headers.** Every response sends `Referrer-Policy: no-referrer` (or
  `strict-origin` if you let sites know you came from Cut Search), a strict CSP
  with no inline scripts or third-party origins, and
  `X-DNS-Prefetch-Control: off`, and opts out of FLoC, Topics and Attribution
  Reporting.
- **What exists briefly, in memory only:**
  - Engine results for 10 minutes, keyed by salted hashes, so "More results"
    is instant. The salt is regenerated on every start.
  - Icons and thumbnails for a few hours.
  - Rate-limit buckets keyed by an HMAC of the client address, with a salt
    that rotates daily and buckets that expire after two minutes.

### A note on torrents

Cut Search searches metadata published by public indexes. It hosts no files
and tracks nothing about what you download. Only download what you have the
right to. The Internet Archive source is full of public-domain films, music,
books and software, all web-seeded so they download even with no peers.

Torrent swarms are public. When you open a magnet link, your torrent client —
not Cut Search — connects to peers who can see your IP address. Cut Search
says so on its privacy page.

## Run Cut Search on its own

You need [Node.js](https://nodejs.org/) 22.19 or newer.

```bash
git clone https://github.com/Andersxns/Cut.git
cd Cut
npm install
npm start          # → http://localhost:8080
```

### Configuration

All optional, via environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Port to listen on. |
| `HOST` | `127.0.0.1` | Interface to bind. Use `0.0.0.0` to expose Cut Search on your network. |
| `CUT_SECRET` | random per start | Signs image-proxy URLs. Set it if you run several instances behind a load balancer. |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For`/`-Proto` from your reverse proxy (needed for per-client rate limits and `Secure` cookies). |
| `RATE_LIMIT` | `true` | Per-client limits so upstream engines don't block your instance. |
| `RATE_LIMIT_SEARCH` | `40` | Searches per client per minute. |
| `RATE_LIMIT_SUGGEST` | `300` | Autocomplete requests per client per minute. |
| `DEBUG` | `false` | Log upstream engine failures and slow engines (never queries). |
| `CUT_PROXY` | — | Proxy for upstream requests, e.g. `socks5h://127.0.0.1:9050` (`h` = the proxy resolves names), `socks5://`, `socks4a://`, `http://user:pass@host:3128`. |
| `CUT_TOR` | `false` | Connect through Tor at `127.0.0.1:9050` with per-search circuits. |
| `CUT_DOH` | `off` | DNS over HTTPS: `cloudflare`, `quad9`, `mullvad`, `adguard`, `nextdns`, `google` or an `https://` URL. |
| `CUT_USER_AGENT` | Firefox UA | User-Agent sent to upstream engines. |
| `CUT_ADMIN_TOKEN` | — | Lets someone who isn't on the Cut Search machine change connection settings by entering this token. |
| `CUT_DATA_DIR` | `data/` | Where connection settings are saved (Cut Browser uses its profile folder). |

The connection variables take precedence over `data/network.json` each time
Cut Search starts. `npm run dev` restarts on code changes and serves static
files without caching.

### Running it for other people

Put Cut Search behind a reverse proxy that terminates HTTPS (Caddy, nginx…),
then set `HOST=0.0.0.0 TRUST_PROXY=1`. Search engines throttle busy scrapers,
so a public instance with heavy traffic will see engines drop out; run with
`DEBUG=1` to log which ones fail. A `Dockerfile` is included:

```bash
docker build -t cut-search .
docker run -p 8080:8080 -v cut-data:/app/data cut-search
```

Inside a container, requests don't arrive from localhost, so choose the
connection with the environment variables above (for example
`-e CUT_PROXY=socks5h://tor:9050`) or set `CUT_ADMIN_TOKEN`.

## Build from source

You need [Node.js](https://nodejs.org/) 22.19 or newer and Git.

```bash
git clone https://github.com/Andersxns/Cut.git
cd Cut
npm install
npm run dev          # Cut Search at http://localhost:8080, restarting on changes
npm test             # Cut Search's tests
```

Cut Browser is built from Mozilla's official Firefox release builds, so there is no compiler to install, but you need about 2 GB of free disk space:

```bash
cd browser
npm install
node build.mjs                  # the Windows installer and the Linux packages, into browser/dist/
node build.mjs --target win     # just Windows (needs Windows), or --target linux (needs xz)
```

The build downloads the newest Firefox release and Node.js LTS and checks them against Mozilla's and Node's published checksums. More options are in [browser/README.md](browser/README.md).

Pushing a tag such as `v1.0.1` makes the [Build workflow](.github/workflows/build.yml) build every package and publish them as a GitHub release, with the notes from `docs/releases/v1.0.1.md`.

## Contributing

Bug reports, ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how the code is organised and how to get started. Please report security problems privately, through **Report a vulnerability** on the [Security tab](https://github.com/Andersxns/Cut/security).

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Signing starts once SignPath Foundation has accepted the project. Releases published before that aren't signed, and their notes say so.

- **What is signed:** the Windows installer of each Cut Browser release, built by the [Build workflow](.github/workflows/build.yml) on GitHub-hosted runners from this repository's source code. Builds from other branches and pull requests aren't signed.
- **Committers and reviewers:** [Andersxns](https://github.com/Andersxns). Changes from other contributors are reviewed by a committer before they are merged.
- **Approvers:** [Andersxns](https://github.com/Andersxns). Every release is approved in SignPath before it is signed.

**Privacy:** Cut Browser and Cut Search have no telemetry, ads or usage statistics, and send nothing about you anywhere you haven't asked them to. Cut Search contacts search engines only when you search. Like Firefox, Cut Browser also keeps its security lists up to date on its own (Safe Browsing, certificate revocations and add-on blocklists), updates uBlock Origin and its filter lists, and installs uBlock Origin from addons.mozilla.org the first time it starts.

## License

Cut Search (everything outside `browser/`) is released under the [MIT License](LICENSE). Cut Browser's own files, in `browser/`, are released under the [Mozilla Public License 2.0](browser/LICENSE), like Firefox.

Cut Browser includes Mozilla Firefox (MPL 2.0) and Node.js (MIT), and installs uBlock Origin (GPL 3.0) from addons.mozilla.org on first run. Cut Search uses cheerio (MIT) and undici (MIT). The Figtree font in `public/fonts` is licensed under the SIL Open Font License (see `public/fonts/OFL.txt`). Firefox is a trademark of the Mozilla Foundation; Cut Browser is not affiliated with or endorsed by Mozilla.
