/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tor windows, like Brave's "Private window with Tor".
//
// A Tor window belongs to a second copy of the browser with a profile of its
// own (the "tor-window" folder in your profile). That copy is always in
// private browsing and sends everything through the Tor client that comes
// with Cut Browser, so it shares no cookies, cache or connections with your
// other windows, and nothing in it can go around Tor. Normal windows hand it
// .onion addresses, and point out sites that have one (Onion-Location).

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AboutNewTab: "resource:///modules/AboutNewTab.sys.mjs",
  AppConstants: "resource://gre/modules/AppConstants.sys.mjs",
  Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
});

const PROFILE_FOLDER = "tor-window";
const HOME = "about:tor";
const STATUS_TOPIC = "cut-tor-status";
const SEARCH_PORT = 28820; // the Tor window's own Cut Search
const BRIDGE_PREFS = ["cut.tor.bridges", "cut.tor.customBridges"];

const log = (...args) => console.info("[Cut Tor]", ...args);
const pps = () => Cc["@mozilla.org/network/protocol-proxy-service;1"].getService(Ci.nsIProtocolProxyService);
const randomKey = () => Services.uuid.generateUUID().toString().replace(/[{}-]/g, "");
const isWindows = () => lazy.AppConstants.platform == "win";

// An http(s) address on a .onion host, or null.
export function onionURL(value) {
  try {
    const url = new URL(String(value).trim());
    return /^https?:$/.test(url.protocol) && /\.onion$/i.test(url.hostname) ? url.href : null;
  } catch (e) {
    return null;
  }
}

// A free port on this computer, for Tor to listen on.
function freePort() {
  const socket = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
  socket.init(-1, true, -1);
  try {
    return socket.port;
  } finally {
    socket.close();
  }
}

// The Tor window's settings, written to its user.js each time a normal window
// opens it, so they always match this version of Cut Browser.
function torWindowPrefs() {
  const copied = {};
  for (const name of ["cut.tor.onionLocation", "cut.tor.preferOnions"]) {
    copied[name] = Services.prefs.getBoolPref(name, name == "cut.tor.onionLocation");
  }
  return {
    "cut.tor.instance": true,
    // Everything goes through Tor, and nothing goes anywhere without it.
    "network.proxy.type": 1,
    "network.proxy.socks": "127.0.0.1",
    "network.proxy.socks_port": 9, // replaced by Tor's port as soon as the window starts
    "network.proxy.socks_version": 5,
    "network.proxy.socks_remote_dns": true,
    "network.proxy.socks5_remote_dns": true,
    "network.proxy.no_proxies_on": "",
    "network.proxy.allow_hijacking_localhost": true,
    "network.proxy.failover_direct": false,
    "network.proxy.allow_bypass": false,
    "network.dns.disabled": true,
    "network.dns.blockDotOnion": false,
    "network.trr.mode": 5,
    "network.http.http3.enable": false,
    "media.peerconnection.enabled": false,
    "geo.enabled": false,
    // Private, and as alike for everyone as Firefox can make it.
    "browser.privatebrowsing.autostart": true,
    "privacy.firstparty.isolate": true,
    "privacy.resistFingerprinting": true,
    "browser.cache.disk.enable": false,
    "permissions.memory_only": true,
    "browser.formfill.enable": false,
    "signon.rememberSignons": false,
    // .onion sites are secure contexts, and don't reveal themselves as referrers.
    "dom.securecontext.allowlist_onions": true,
    "network.http.referer.hideOnionSource": true,
    "dom.security.https_only_mode.upgrade_onion": false,
    // The window itself.
    "browser.startup.page": 1,
    "browser.startup.homepage": HOME,
    "browser.sessionstore.resume_from_crash": false,
    "browser.warnOnQuit": false,
    "browser.tabs.warnOnClose": false,
    "cut.search.port": SEARCH_PORT,
    ...copied,
  };
}

function userJS(prefs) {
  const lines = ["// Written by Cut Browser each time it opens a Tor window; changes here are replaced.", ""];
  for (const [name, value] of Object.entries(prefs)) {
    lines.push(`user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`);
  }
  return lines.join("\n") + "\n";
}

// Bridge lines entered by hand: one per line, "Bridge" in front optional.
function customBridges(text) {
  return String(text)
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^bridge\s+/i, ""))
    .filter(line => line && !line.startsWith("#") && /^[\x20-\x7e]+$/.test(line));
}

// about:tor, the Tor window's start page.
function registerAboutTor() {
  const page = "chrome://browser/content/cut/tor/tor.html";
  const module = {
    QueryInterface: ChromeUtils.generateQI(["nsIAboutModule"]),
    newChannel(uri, loadInfo) {
      const channel = Services.io.newChannelFromURIWithLoadInfo(Services.io.newURI(page), loadInfo);
      channel.originalURI = uri;
      return channel;
    },
    getURIFlags() {
      return Ci.nsIAboutModule.ALLOW_SCRIPT | Ci.nsIAboutModule.IS_SECURE_CHROME_UI;
    },
    getChromeURI() {
      return Services.io.newURI(page);
    },
  };
  const factory = {
    QueryInterface: ChromeUtils.generateQI(["nsIFactory"]),
    createInstance(iid) {
      return module.QueryInterface(iid);
    },
  };
  Components.manager
    .QueryInterface(Ci.nsIComponentRegistrar)
    .registerFactory(Components.ID("{5d6f3c2a-7b1e-4c8d-9a41-2e7f0b9c6d13}"), "about:tor", "@mozilla.org/network/protocol/about;1?what=tor", factory);
}

export const CutTor = {
  HOME,
  STATUS_TOPIC,

  // True in the copy of the browser that runs Tor windows.
  get isTorApp() {
    return Services.prefs.getBoolPref("cut.tor.instance", false);
  },

  // Tor ships in the tor/ folder next to the browser.
  get torDir() {
    const dir = Services.dirsvc.get("GreD", Ci.nsIFile);
    dir.append("tor");
    return dir;
  },

  get available() {
    const exe = this.torDir;
    exe.append(isWindows() ? "tor.exe" : "tor");
    return exe.exists();
  },

  // Whether normal windows offer Tor windows (Settings › Cut Browser).
  get enabled() {
    return this.available && Services.prefs.getBoolPref("cut.tor.enabled", true);
  },

  _initialized: false,
  _onions: new Map(), // browserId → { page, onion }

  // Called once per session by CutBrowser.init().
  init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;
    for (const topic of ["http-on-examine-response", "http-on-examine-cached-response", "http-on-examine-merged-response"]) {
      Services.obs.addObserver(this, topic);
    }
    if (this.isTorApp) {
      this._startTorApp();
    } else {
      Services.obs.addObserver(this, "http-on-opening-request");
      for (const pref of BRIDGE_PREFS) {
        Services.prefs.addObserver(pref, () => this._writeBridges().catch(console.error));
      }
    }
  },

  observe(subject, topic) {
    switch (topic) {
      case "http-on-opening-request":
        this._sendOnionToTor(subject.QueryInterface(Ci.nsIHttpChannel));
        break;
      case "http-on-examine-response":
      case "http-on-examine-cached-response":
      case "http-on-examine-merged-response":
        this._noteOnionLocation(subject.QueryInterface(Ci.nsIHttpChannel));
        break;
      case "quit-application":
        this.stopTor();
        break;
    }
  },

  // ---------- Normal windows ----------

  get profileDir() {
    const dir = Services.dirsvc.get("ProfD", Ci.nsIFile);
    dir.append(PROFILE_FOLDER);
    return dir;
  },

  // Opens a Tor window, or, given an address, a tab for it in a Tor window.
  // The Tor window's copy of the browser starts if it isn't running yet.
  async open(url = null) {
    if (this.isTorApp || !this.enabled) {
      return false;
    }
    const dir = this.profileDir;
    await IOUtils.makeDirectory(dir.path, { ignoreExisting: true });
    await IOUtils.writeUTF8(PathUtils.join(dir.path, "user.js"), userJS(torWindowPrefs()));
    await this._writeBridges();
    const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile);
    const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    process.init(exe);
    const args = ["-profile", dir.path, ...(url ? ["-new-tab", url] : ["-new-window", HOME])];
    process.runwAsync(args, args.length);
    return true;
  },

  // Bridges are chosen in a normal window's settings; the Tor window reads
  // them whenever it (re)starts Tor.
  async _writeBridges() {
    const dir = this.profileDir;
    if (!(await IOUtils.exists(dir.path))) {
      return;
    }
    const bridges = {
      use: Services.prefs.getStringPref("cut.tor.bridges", ""),
      custom: customBridges(Services.prefs.getStringPref("cut.tor.customBridges", "")),
    };
    await IOUtils.writeJSON(PathUtils.join(dir.path, "bridges.json"), bridges);
  },

  // .onion addresses can't load in a normal window (they're only reachable
  // through Tor), so a normal window hands them to a Tor window instead.
  _sendOnionToTor(channel) {
    const { loadInfo } = channel;
    if (loadInfo?.externalContentPolicyType != Ci.nsIContentPolicy.TYPE_DOCUMENT || !/\.onion$/i.test(channel.URI.host)) {
      return;
    }
    if (!this.enabled || !Services.prefs.getBoolPref("cut.tor.openOnions", true)) {
      return;
    }
    const url = onionURL(channel.URI.spec);
    channel.cancel(Cr.NS_BINDING_ABORTED);
    if (!url) {
      return;
    }
    const browserId = loadInfo.browsingContext?.browserId;
    // Addresses you open yourself (typed, bookmarked, or from another app)
    // go straight to a Tor window. When a page leads to one (a link, a script
    // or a redirect), you're asked first: otherwise a page could send your
    // Tor window to an address of its choosing and tie it to this window.
    const yours = loadInfo.triggeringPrincipal?.isSystemPrincipal;
    Services.tm.dispatchToMainThread(() => {
      if (yours) {
        this.open(url).catch(console.error);
        this._tidyAfterOnion(browserId);
      } else {
        this._offerOnion(browserId, url);
      }
    });
  },

  // A bar in the tab offering to open a page's .onion link in a Tor window.
  _offerOnion(browserId, url) {
    const found = this._tabFor(browserId);
    if (!found) {
      return;
    }
    const box = found.win.gBrowser.getNotificationBox(found.tab.linkedBrowser);
    const previous = box.getNotificationWithValue("cut-onion");
    if (previous) {
      box.removeNotification(previous);
    }
    box.appendNotification(
      "cut-onion",
      { label: `${new URL(url).hostname} is an .onion site, which only a Tor window can open.`, priority: box.PRIORITY_INFO_MEDIUM },
      [
        {
          label: "Open in a Tor window",
          accessKey: "O",
          callback: () => {
            this.open(url).catch(console.error);
            this._tidyAfterOnion(browserId);
          },
        },
      ]
    );
  },

  // The window and tab showing the browser with this ID (the ID survives the
  // process switches that replace a tab's browsing context).
  _tabFor(browserId) {
    if (!browserId) {
      return null;
    }
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      const tab = win.gBrowser?.tabs.find(t => t.linkedBrowser?.browserId == browserId);
      if (tab) {
        return { win, tab };
      }
    }
    return null;
  },

  // The tab that tried to load the address: a new, empty one is closed; any
  // other goes back to showing its own address.
  _tidyAfterOnion(browserId) {
    const found = this._tabFor(browserId);
    if (!found) {
      return;
    }
    const { win, tab } = found;
    const browser = tab.linkedBrowser;
    const gBrowser = win.gBrowser;
    const empty = browser.currentURI?.spec == "about:blank" && !browser.canGoBack;
    if (empty && gBrowser.tabs.length > 1) {
      gBrowser.removeTab(tab);
    } else if (empty) {
      win.close();
    } else if (browser == gBrowser.selectedBrowser) {
      win.gURLBar?.handleRevert();
    }
  },

  // Onion-Location: a secure site can name its .onion address in a response
  // header, as Tor Browser and Brave recognise.
  _noteOnionLocation(channel) {
    const { loadInfo } = channel;
    if (loadInfo?.externalContentPolicyType != Ci.nsIContentPolicy.TYPE_DOCUMENT) {
      return;
    }
    if (channel.URI.scheme != "https" || /\.onion$/i.test(channel.URI.host)) {
      return;
    }
    let header;
    try {
      header = channel.getResponseHeader("Onion-Location");
    } catch (e) {
      return;
    }
    const onion = onionURL(header);
    const browserId = loadInfo.browsingContext?.browserId;
    if (onion && browserId) {
      // One entry per tab, newest last; old ones make way.
      this._onions.delete(browserId);
      this._onions.set(browserId, { page: channel.URI.specIgnoringRef, onion });
      if (this._onions.size > 200) {
        this._onions.delete(this._onions.keys().next().value);
      }
    }
  },

  // The .onion address of the page shown in `browser`, if it has one.
  onionFor(browser) {
    if (!Services.prefs.getBoolPref("cut.tor.onionLocation", true) || (!this.isTorApp && !this.enabled)) {
      return null;
    }
    const entry = browser && this._onions.get(browser.browserId);
    return entry && entry.page == browser.currentURI?.specIgnoringRef ? entry.onion : null;
  },

  // ---------- The Tor window's copy of the browser ----------

  // state: "starting" | "connecting" | "connected" | "failed" | "stopped"
  status: { state: "starting", progress: 0, summary: "", warning: "", error: "" },
  socksPort: 0,
  _localPort: 0,
  _process: null,
  _stopping: false,
  _retriedPort: false,
  _problems: [],
  _sessionKey: randomKey(),
  _siteKeys: new Map(),

  _startTorApp() {
    // Tor's port is chosen before anything loads. Until Tor listens on it,
    // connections fail rather than go anywhere else.
    this.socksPort = freePort();
    Services.prefs.setIntPref("network.proxy.socks_port", this.socksPort);
    pps().registerChannelFilter(this._filter, 0);
    registerAboutTor();
    try {
      lazy.AboutNewTab.newTabURL = HOME;
    } catch (e) {
      console.error("[Cut Tor] couldn't set the new tab page", e);
    }
    Services.obs.addObserver(this, "quit-application");
    this.startTor();
  },

  _setStatus(status) {
    this.status = { state: "connecting", progress: 0, summary: "", warning: "", error: "", ...status };
    Services.obs.notifyObservers(null, STATUS_TOPIC);
  },

  async startTor() {
    this.stopTor();
    this._stopping = false;
    this._problems = [];
    this._setStatus({ state: "starting", summary: "Starting Tor" });
    const dir = this.torDir;
    const exe = dir.clone();
    exe.append(isWindows() ? "tor.exe" : "tor");
    const profile = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
    const dataDir = PathUtils.join(profile, "tor-data");
    const authDir = PathUtils.join(profile, "tor-onion-auth");
    const torrc = PathUtils.join(profile, "torrc");
    const defaults = PathUtils.join(profile, "torrc-defaults");
    let proc;
    try {
      await IOUtils.makeDirectory(dataDir, { ignoreExisting: true, permissions: 0o700 });
      await IOUtils.makeDirectory(authDir, { ignoreExisting: true, permissions: 0o700 });
      // The files hold only bridges; everything else is given on the command
      // line, where folder names with spaces need no quoting.
      await IOUtils.writeUTF8(torrc, (await this._bridgeConfig()).join("\n") + "\n");
      await IOUtils.writeUTF8(defaults, "");
      proc = await lazy.Subprocess.call({
        command: exe.path,
        arguments: [
          "--defaults-torrc",
          defaults,
          "-f",
          torrc,
          "--DataDirectory",
          dataDir,
          "--ClientOnionAuthDir",
          authDir,
          "--GeoIPFile",
          PathUtils.join(dir.path, "geoip"),
          "--GeoIPv6File",
          PathUtils.join(dir.path, "geoip6"),
          "--SocksPort",
          `127.0.0.1:${this.socksPort} IPv6Traffic PreferIPv6 KeepAliveIsolateSOCKSAuth`,
          "--Log",
          "notice stdout",
          "--AvoidDiskWrites",
          "1",
          "--DormantCanceledByStartup",
          "1",
          // Tor quits by itself if this copy of the browser goes away.
          "--__OwningControllerProcess",
          String(Services.appinfo.processID),
        ],
        // Pluggable transports are named relative to this folder.
        workdir: dir.path,
        environment: isWindows() ? {} : { LD_LIBRARY_PATH: dir.path },
        environmentAppend: true,
        stderr: "stdout",
      });
    } catch (e) {
      this._setStatus({ state: "failed", error: `Tor couldn't start (${e.message || e}).` });
      return;
    }
    this._process = proc;
    this._setStatus({ state: "connecting", summary: "Connecting to the Tor network" });
    this._read(proc);
    proc.wait().then(({ exitCode }) => this._onExit(proc, exitCode));
  },

  stopTor() {
    this._stopping = true;
    if (this._process) {
      this._process.kill();
      this._process = null;
    }
  },

  // Tor's log: progress while connecting, and problems.
  async _read(proc) {
    let pending = "";
    try {
      let text;
      while ((text = await proc.stdout.readString())) {
        pending += text;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
        for (const line of lines) {
          this._onLog(line);
        }
      }
    } catch (e) {}
  },

  _onLog(line) {
    const progress = line.match(/Bootstrapped (\d+)%(?: \([\w-]+\))?: (.*)$/);
    if (progress && this._process) {
      const percent = Number(progress[1]);
      this._setStatus({ state: percent >= 100 ? "connected" : "connecting", progress: percent, summary: progress[2].replace(/\.$/, "") });
      return;
    }
    const problem = line.match(/\[(warn|err)\] (.*)$/);
    if (problem) {
      this._problems = [...this._problems.slice(-4), problem[2]];
      log(problem[2]);
      if (this.status.state == "connecting" && /Problem bootstrapping|Stuck at/i.test(problem[2])) {
        this._setStatus({ ...this.status, warning: problem[2] });
      }
    }
  },

  _onExit(proc, exitCode) {
    if (this._process != proc) {
      return;
    }
    this._process = null;
    if (this._stopping) {
      return;
    }
    // The port was taken after it was chosen: pick another, once.
    if (this._problems.some(p => /Could not bind|Address already in use|Failed to bind/i.test(p)) && !this._retriedPort) {
      this._retriedPort = true;
      this.socksPort = freePort();
      Services.prefs.setIntPref("network.proxy.socks_port", this.socksPort);
      this.startTor();
      return;
    }
    const last = this._problems.at(-1);
    const reason = last ? ` ${last.replace(/\s*\(.*$/, "").replace(/\.?$/, ".")}` : "";
    this._setStatus({ state: "failed", error: `Tor stopped (exit code ${exitCode}).${reason}` });
  },

  async _bridgeConfig() {
    let chosen = { use: "", custom: [] };
    try {
      chosen = await IOUtils.readJSON(PathUtils.join(Services.dirsvc.get("ProfD", Ci.nsIFile).path, "bridges.json"));
    } catch (e) {}
    if (!chosen?.use) {
      return [];
    }
    const transports = PathUtils.join(this.torDir.path, "pluggable_transports");
    const pt = await IOUtils.readJSON(PathUtils.join(transports, "pt_config.json"));
    const bridges = chosen.use == "custom" ? customBridges((chosen.custom || []).join("\n")) : pt.bridges?.[chosen.use] || [];
    if (!bridges.length) {
      return [];
    }
    const wanted = new Set(bridges.map(line => line.split(/\s+/)[0].toLowerCase()));
    const prefix = isWindows() ? "pluggable_transports\\" : "./pluggable_transports/";
    const config = ["UseBridges 1"];
    for (const [name, plugin] of Object.entries(pt.pluggableTransports || {})) {
      const handles = plugin.match(/^ClientTransportPlugin (\S+) exec/)?.[1].split(",") || [];
      // Conjure's client isn't included with Cut Browser.
      if (name != "conjure" && handles.some(t => wanted.has(t))) {
        config.push(plugin.replace("${pt_path}", prefix));
      }
    }
    for (const bridge of bridges) {
      config.push(`Bridge ${bridge}`);
    }
    return config;
  },

  // Cut Search, running on this computer for the Tor window, is the one
  // thing it reaches directly (its own searches go through Tor).
  allowLocalServer(port) {
    this._localPort = port;
  },

  // Every connection goes to Tor, with Tor credentials for the site it
  // belongs to: Tor gives each set of credentials circuits of their own, so
  // no one relay sees every site you visit.
  _filter: {
    QueryInterface: ChromeUtils.generateQI(["nsIProtocolProxyChannelFilter"]),
    applyFilter(channel, proxy, callback) {
      let result = proxy;
      try {
        result = CutTor._proxyFor(channel);
      } catch (e) {
        console.error("[Cut Tor]", e);
      }
      callback.onProxyFilterResult(result);
    },
  },

  _proxyFor(channel) {
    const uri = channel.URI;
    if (this._localPort && uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port == this._localPort) {
      return null;
    }
    const site = this._siteOf(channel);
    const key = this._siteKeys.get(site) || this._sessionKey;
    return pps().newProxyInfoWithAuth(
      "socks",
      "127.0.0.1",
      this.socksPort,
      site,
      key,
      "",
      `${site}:${key}`,
      Ci.nsIProxyInfo.TRANSPARENT_PROXY_RESOLVES_HOST,
      0xffffffff,
      null
    );
  },

  // The site a connection belongs to: the page's first party. A page's own
  // first request doesn't carry it yet, so that's its own address's site;
  // requests from the browser itself share "--unknown--", as in Tor Browser.
  _siteOf(channel) {
    const { loadInfo } = channel;
    const firstParty = loadInfo?.originAttributes?.firstPartyDomain;
    if (firstParty) {
      return firstParty;
    }
    if (loadInfo?.externalContentPolicyType == Ci.nsIContentPolicy.TYPE_DOCUMENT) {
      try {
        return Services.eTLD.getSchemelessSite(channel.URI);
      } catch (e) {
        return channel.URI.host || "--unknown--";
      }
    }
    return "--unknown--";
  },

  // "New Tor circuit for this site": new credentials for the site in
  // `browser`, then a reload over the new circuit.
  newCircuitFor(browser) {
    const site = browser?.contentPrincipal?.originAttributes?.firstPartyDomain;
    if (!site) {
      return false;
    }
    this._siteKeys.set(site, randomKey());
    browser.reloadWithFlags(Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE);
    return true;
  },

  // "New identity": start the Tor window again, which closes every tab,
  // forgets everything (it's all private) and builds new circuits.
  newIdentity() {
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart);
  },

  // Opens Cut Browser's settings in a normal window (bridges are set there).
  openSettings() {
    const exe = Services.dirsvc.get("XREExeF", Ci.nsIFile);
    const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    process.init(exe);
    const args = ["-new-tab", "about:preferences#cut"];
    process.runwAsync(args, args.length);
  },
};
