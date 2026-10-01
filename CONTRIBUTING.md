# Contributing to Cut

Thanks for helping make Cut better! This repository holds two projects:

- **Cut Search**, the private metasearch engine, in the root of the repository;
- **Cut Browser**, the Firefox-based browser with Cut Search built in, in [`browser/`](browser/).

This guide explains how to run them, how the code is organised and what we look for in a pull request.

## Getting started

You need [Node.js](https://nodejs.org/) 22.19 or newer.

### Cut Search

```bash
npm install
npm run dev        # http://localhost:8080, restarts when you change the code
npm test
```

### Cut Browser

Cut Browser repackages Mozilla's official Firefox release builds, so there's no compiler to install, but you need about 2 GB of free disk space. Windows builds need Windows; Linux builds work on Linux, or on Windows with the `xz` tool that comes with Git for Windows.

```bash
cd browser
npm install
node build.mjs --target win --stage-only   # assembles the browser in .build/win/Cut Browser
node tools/session.mjs start --headed      # opens a test copy with a profile of its own
```

After changing the interface in `app/`, `node build.mjs --interface-only` applies it to the staged copy in a few seconds; then restart the test copy (`node tools/session.mjs stop`, then `start`). `node build.mjs` builds the Windows installer and the Linux packages into `dist/`. `tools/session.mjs` only ever stops the test copy it started, never a Cut Browser you have open yourself.

Before opening a pull request, run `npm test`. The [Build workflow](.github/workflows/build.yml) runs the same checks on every push and pull request, and builds Cut Browser for Windows and Linux on the default branch.

## How the code is organised

### Cut Search

| Folder | What lives there |
| --- | --- |
| `server.js` | The HTTP server. It never logs requests. |
| `src/app.js` | Routing, streaming results pages, settings and security headers. |
| `src/engines/` | One module per upstream source: `web/`, `media/` (images, videos and news) and `torrents/`, listed in `registry.js`. |
| `src/search/` | Runs engines in parallel within time limits, merges web results by rank fusion and torrents by info hash. |
| `src/answers/` | Instant answers (calculator, units, currency, weather, dictionary…) and the knowledge panel. |
| `src/privacy/` | Link cleaning, privacy-friendly front-ends and the dangerous-site lists. |
| `src/net/` | Proxies, the SOCKS client, Tor circuit isolation and DNS over HTTPS. |
| `src/views/` | Server-rendered HTML, with template tags that escape everything by default. |
| `src/bangs.js` | The !bang shortcuts. |
| `public/` | CSS, the small scripts that add conveniences when JavaScript is on, fonts and icons. |
| `test/` | Tests (`node --test`). |

### Cut Browser

| Folder | What lives there |
| --- | --- |
| `browser/build.mjs` | The build: downloads Firefox and Node, checks them against their published checksums and assembles the packages. |
| `browser/lib/` | The build steps: rebranding Firefox's executable (`binaries.mjs`) and `omni.ja` (`omni.mjs`, `branding.mjs`), icons (`icons.mjs`), the Windows app and installer (`windows.mjs`, `installer-win.mjs`), the Linux packages (`linux.mjs`), bundling Cut Search (`cutsearch.mjs`) and Tor (`tor.mjs`). |
| `browser/app/chrome/` | The interface: the look (`cut.css`), each window's behaviour, such as the layout, compact mode and the floating address bar (`cut-window.js`), Cut Search's local server and search engine (`CutBrowser.sys.mjs`), Tor windows and .onion addresses (`CutTor.sys.mjs`, with `about:tor` in `tor/`) and the new tab and settings pages (`content.css`). |
| `browser/app/prefs/cut.js` | Default preferences: privacy, the layout and search. |
| `browser/app/policies.json` | Policies: no updates from Mozilla, no telemetry or studies, uBlock Origin. |
| `browser/app/preferences/` | The **Cut Browser** section of Settings. |
| `browser/installer/windows/` | The Windows installer and uninstaller (C#, compiled with the C# compiler that comes with Windows). |
| `browser/tools/` | Helpers that drive a test copy of the browser through Marionette. |

## Guidelines

- **Match the surrounding code.** Cut Search and the build scripts are ES modules with two-space indentation, single quotes and semicolons. Code that runs inside the browser (`browser/app/`) follows Mozilla's style, with double quotes.
- **Privacy is the product.**
  - Cut Search never logs or keeps searches, and sets no cookie except the settings someone chooses.
  - Everything a results page loads comes from Cut itself: images and icons go through its proxy, and there are no third-party scripts, fonts or styles.
  - Cut Browser sends nothing to Mozilla or anyone else that its user didn't ask for. When Firefox adds a feature that contacts a server on its own, turn it off in `browser/app/prefs/cut.js`.
- **Engines break.** Search engines and torrent indexes change their pages without warning. A failing engine must drop out quietly and never break the page. Run with `DEBUG=1` to see which engines fail.
- **Keep it plain.** Use plain, friendly words in the interface, and make sure Cut Search still works with JavaScript turned off.
- **Tests.** Add tests for parsing, ranking, link cleaning and settings. For interface changes, describe how you tested in the pull request (a screenshot helps).

## Adding things

- **A web engine or torrent source:** add an object with an `id`, a `name`, a `description`, a `timeout` and an `async search(params)` that returns results to a module in `src/engines/web/` or `src/engines/torrents/` (web engines also have a ranking `weight`), and list it in `src/engines/registry.js`.
- **A !bang:** add a line to `BANG_TABLE` in `src/bangs.js`.
- **An instant answer:** add a matcher in `src/answers/` and include it in `src/answers/index.js`.
- **A browser default:** add a `pref()` line to `browser/app/prefs/cut.js`, with a comment when the reason isn't obvious.
- **Icons:** `npm run icons` renders Cut Search's icons; Cut Browser's are drawn by `browser/lib/icons.mjs` during the build.

## Releasing

Releases are Cut Browser releases, numbered by `version` in `browser/package.json`. Update it, write the release notes in `docs/releases/v1.0.1.md` (see the earlier versions there), commit, then push a tag such as `v1.0.1`. The Build workflow builds the Windows installer and the Linux packages on the newest Firefox release, with the Tor from the newest Tor Browser, and publishes them as a GitHub release with checksums. In the notes, `<!-- firefox -->` becomes the Firefox version the release is built on, and `<!-- tor -->` the Tor Browser version its Tor comes from.

Cut Browser doesn't update itself from Mozilla, so **every Firefox security release needs a Cut Browser release**, and so does every Tor security release. The [Firefox and Tor updates workflow](.github/workflows/firefox-updates.yml) checks every day and opens an issue when there's a Firefox or a Tor Browser newer than the latest release; publishing a new version is all it takes.

When code signing is set up, the workflow sends the Windows installer to SignPath and waits up to four hours for an approver to approve the signing request in SignPath, then publishes the release with the signed installer. If nobody approves it in time, re-run the failed jobs once you can.

### Setting up code signing (once)

Windows releases are signed through [SignPath Foundation](https://signpath.org), which signs open-source projects for free. Its conditions are on [signpath.org/terms](https://signpath.org/terms); the [code signing policy](README.md#code-signing-policy) in the README is the one it asks projects to publish.

1. Make the repository public, then apply at [signpath.org/apply](https://signpath.org/apply).
2. Turn on multi-factor authentication on GitHub and SignPath for everyone on the team.
3. Once the project is accepted, in SignPath:
   - add the predefined **GitHub.com** trusted build system to the organization and link it to the project;
   - install the SignPath GitHub App on this repository;
   - make [`.signpath/artifact-configuration.xml`](.signpath/artifact-configuration.xml) the project's default artifact configuration;
   - create a CI user that can submit signing requests to the release signing policy, and copy its API token.
4. In this repository's **Settings → Secrets and variables → Actions**, add:
   - the secret `SIGNPATH_API_TOKEN`: the CI user's API token;
   - the variable `SIGNPATH_ORGANIZATION_ID`: the SignPath organization ID;
   - if yours differ from the defaults, the variables `SIGNPATH_PROJECT_SLUG` (`cut`) and `SIGNPATH_SIGNING_POLICY_SLUG` (`release-signing`).

Until `SIGNPATH_ORGANIZATION_ID` is set, releases are published with an unsigned Windows installer, and their notes say so. To try the whole process first, set `SIGNPATH_SIGNING_POLICY_SLUG` to your test signing policy and push a test tag.

## Reporting bugs

Please say whether the problem is in Cut Browser or Cut Search, and include your operating system, the Cut Browser version (**Menu → Help → About Cut**), what you did, what you expected and what happened. For a search problem, include the search and the tab (All, Images, Torrents…) if you're comfortable sharing them.

## Security issues

Please don't report security problems in public issues. Use **Report a vulnerability** on the repository's [Security tab](https://github.com/Andersxns/Cut/security/advisories/new) instead, so they can be fixed before they're made public. Problems in Firefox itself belong with [Mozilla](https://www.mozilla.org/security/).
