# Cut Browser

A private web browser for Windows and Linux, built on Mozilla Firefox, with
[Cut Search](../README.md#cut-search) built in. It looks and works like Zen Browser:
tabs down the side, the page as a rounded card, a compact mode, and an
address bar that opens in the middle of the window while you type.

It uses Firefox's engine and all of Firefox's own privacy and security
settings, with stricter defaults and nothing sent to Mozilla or anyone else.

## Install

Download the newest version from the
[Releases page](https://github.com/Andersxns/Cut/releases/latest), or
[build it yourself](#build):

| File | For |
| --- | --- |
| `Cut-Browser-<version>-Setup-x64.exe` | Windows 10 and 11 (64-bit). Installs for your user account, no administrator rights needed. |
| `cut-browser_<version>+firefox<firefox version>_amd64.deb` | Debian, Ubuntu, Linux Mint, Pop!_OS and other Debian-based systems: `sudo apt install ./cut-browser_*.deb` |
| `cut-browser-<version>-linux-x86_64.tar.xz` | Any other Linux: unpack it and run `./install.sh` (just you) or `sudo ./install.sh --system` (everyone). |

**Windows:** unless a release's notes say its installer is code-signed,
SmartScreen shows "Windows protected your PC" the first time; choose *More
info → Run anyway*. The
installer puts Cut Browser in the Start menu (and optionally on the desktop),
registers it as a browser so you can pick it under *Settings → Apps →
Default apps*, and adds an uninstaller to *Apps & features*. Silent install:
`Setup.exe /S [/D=<folder>] [/NoShortcut]`; uninstall with
`uninstall.exe /S [/RemoveData]`. (Windows won't start Firefox-based browsers
from a folder placed directly inside `%LOCALAPPDATA%`, so keep custom `/D=`
folders elsewhere; the default, `%LOCALAPPDATA%\Programs\Cut Browser`, is fine.)

## What's different from Firefox

**Look and feel (Zen-style)**

- Vertical tabs in a full-height sidebar, with the toolbar above the page only.
- The page sits in the window as a rounded card; pinned tabs appear as tiles.
- **Compact mode** (Ctrl+Alt+C, or the toolbar button): the sidebar and toolbar
  hide and slide back when you point at the window's edge.
- **Floating address bar**: typing opens the address bar as a palette in the
  middle of the window over the dimmed page.
- Firefox's split view and tab groups are on.
- Neutral dark and light palettes with Cut's orange, following your system theme.

**Search**

- Cut Search runs on your own computer (a small local server that starts and
  stops with the browser) and asks several search engines for you. They get
  your search, but no cookies or anything that identifies your browser, and
  never see which results you click; turn on Tor or a proxy in Cut Search's
  settings and they don't see your IP address either. It's the default in
  normal and private windows, and supplies the address bar's suggestions.
  You can point the browser at your own Cut Search server instead, or pick
  any other engine in *Settings → Search*.
- That's why search results come from `http://127.0.0.1:28800`: 127.0.0.1 is
  the computer's own loopback address, which nothing on your network or the
  internet can reach, and the server listens on nothing else. It also rejects
  attempts by other websites to change its settings, and shuts down with the
  browser.

**Privacy defaults**

- Telemetry, studies, experiments, crash reports and Mozilla's data-collection
  prompts are off.
- Enhanced Tracking Protection is set to *Strict*; HTTPS-Only Mode, Global
  Privacy Control and bounce-tracking protection are on; cookie banners are
  rejected automatically where possible.
- No prefetching or speculative connections, no WebRTC local-address leaks, no
  background check-ins (region lookups, captive-portal pings, remote download
  checks).
- AI features, sponsored shortcuts and stories, Firefox Suggest, Pocket and
  Mozilla's promotions are off.
- uBlock Origin is installed on first run (from addons.mozilla.org).

Every one of these is a normal Firefox setting you can change. *Settings → Cut
Browser* has the layout options, Cut Search's status and Tor windows;
*Settings → Privacy and security* is Firefox's.

Profiles live in `%APPDATA%\Cut` (Windows) and `~/.cut` (Linux), separate from
any Firefox profile.

## Tor windows

*New Tor window* (in the menu, or Alt+Shift+N) opens a window whose every
connection goes through Tor, like Brave's "Private window with Tor":

- **A browser of its own.** A Tor window belongs to a second copy of Cut
  Browser with its own profile (`tor-window`, inside your profile), started by
  `app/chrome/CutTor.sys.mjs`. It shares no cookies, cache, history or
  connections with your other windows, and it's always in private browsing:
  closing the last Tor window forgets everything.
- **Tor comes with Cut Browser.** The Tor client and its bridge client,
  lyrebird, from the Tor Project's expert bundle, are in `tor/`. A Tor window
  starts Tor when it opens and stops it when it closes; Tor also quits by
  itself if the window's browser goes away.
- **Nothing goes around Tor.** Firefox's proxy settings send every connection
  to Tor, which also looks up the names; local DNS is off, there's no fallback
  to a direct connection, and WebRTC is off. The one thing a Tor window reaches
  directly is its own Cut Search, which searches through Tor and can't be
  switched to a direct connection.
- **A circuit per site.** Each site's connections carry Tor credentials of
  their own, as in Tor Browser, so Tor gives each site separate circuits.
  *New Tor circuit for this site* changes them; *New identity* starts the Tor
  window again with nothing kept.
- **Alike for everyone, as far as Firefox goes.** First-party isolation and
  Firefox's resist-fingerprinting mode are on, as in Tor Browser.
- **.onion addresses** typed or bookmarked in a normal window open in a Tor
  window. When a page leads to one (a link, a script or a redirect), a bar in
  the tab offers to open it there instead, so no page can send your Tor window
  somewhere by itself. Sites that send an `Onion-Location` header get an
  *.onion* button in the address bar.
- **Bridges**, in *Settings → Cut Browser*: the Tor Project's built-in obfs4,
  Snowflake and meek bridges, or your own from bridges.torproject.org.

Tor windows aren't Tor Browser, which also hides its window size, keeps a
tighter list of fonts and more, and is built and tested for exactly this job.
Use Tor Browser when your safety depends on staying anonymous.

## Updates

Mozilla's updater would replace Cut Browser with plain Firefox, so it's
removed. **Security fixes come as new Cut Browser releases** instead: each
release is built on the newest Firefox release (Mozilla ships one about every
four weeks, with security fixes in between) and the Tor from the newest Tor
Browser, and a workflow checks every day for newer ones. Installing a new
version over the old one keeps your profile. *Settings → Cut Browser* and the
About dialog show the Firefox version you're on. If you build Cut Browser
yourself, `node build.mjs` always fetches the newest Firefox and Tor.

## Build

Needs Node.js 22.19 or newer and about 2 GB of free disk space.

```
cd browser
npm install          # resedit, for the Windows icons
node build.mjs       # Windows and Linux; or --target win / --target linux
```

- Windows builds need Windows (the installer is compiled with the C# compiler
  that comes with the .NET Framework, and Mozilla's installer is unpacked with
  Windows' `tar`).
- Linux builds need the `xz` tool (built in on Linux; included with Git for
  Windows).
- `FIREFOX_VERSION=156.0.1`, `NODE_VERSION=24.21.0` or `TOR_VERSION=15.0.24`
  (a Tor Browser version; its Tor is used) pins a version.
- `CUT_BUILD_DIR=.build-next` builds in another folder, e.g. while a copy from
  `.build` is running. The build folders can be deleted at any time.

Downloads are checked against Mozilla's, Node's and the Tor Project's
published SHA-512 and SHA-256 checksums and cached in `.cache/`.

### How it's made

Cut Browser repackages Mozilla's official release builds rather than compiling
Firefox (which takes hours and tens of gigabytes):

1. Firefox's name, profile folder and single-instance ID are compiled into its
   launcher executable; `lib/binaries.mjs` rewrites them in place ("Cut"), and
   clears the crash-report and update servers. It also swaps the icons and
   version details of the Windows executable.
2. `lib/omni.mjs` rebrands `browser/omni.ja` (names, logos, About dialog) and
   adds Cut's interface (`app/chrome/`), default prefs (`app/prefs/cut.js`) and
   the Settings pane (`app/preferences/`).
3. Mozilla's updater, crash reporter and telemetry senders are left out;
   `app/policies.json` turns off updates and installs uBlock Origin.
4. Cut Search (this repository's server plus Node's runtime) is bundled in
   `cut-search/` and started by `app/chrome/CutBrowser.sys.mjs`.
5. Tor and lyrebird, from the Tor expert bundle of the newest Tor Browser, go
   in `tor/` (`lib/tor.mjs`), for Tor windows (`app/chrome/CutTor.sys.mjs`).

`tools/session.mjs` starts a test copy and drives it with Marionette (Firefox's
remote-control protocol): `start`, `eval`, `shot`, `stop`. With
`CUT_MARIONETTE_PORT`, it reaches another copy started with `--marionette`,
such as a Tor window's.

## Known limitations

- The Linux packages are built and checked structurally but haven't been run on
  a Linux machine by the build; please report anything that misbehaves.
- Some of the Tor Project's built-in obfs4 bridges are often busy or blocked;
  if a Tor window can't connect through them, try Snowflake or meek, or
  bridges of your own.
- DRM (Widevine) works, so music and video sites that use it play. Streaming
  services that also check that the browser itself is signed by Mozilla
  (Netflix and similar) may refuse to play or lower the quality on Windows:
  Cut Browser's executable is modified, so Mozilla's signature for it is left
  out.
- English (US) only out of the box; other languages install from
  *Settings → Languages*.
- macOS isn't supported yet.

## License

Cut Browser's own files are MPL 2.0, like Firefox. Firefox is a trademark of
the Mozilla Foundation; Cut Browser is not affiliated with or endorsed by
Mozilla. Node.js is MIT-licensed (its license ships as
`cut-search/NODE-LICENSE.txt`). Tor is under the 3-clause BSD license and
lyrebird under BSD licenses; theirs and their components' licenses ship in
`tor/licenses/`. Tor is a trademark of The Tor Project, Inc.; Cut Browser is
not affiliated with the Tor Project.
