/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Updates. Firefox's own updater only installs updates signed by Mozilla, so
// Cut Browser updates itself: a couple of minutes after it starts, and every
// six hours, it asks GitHub for the newest release. On Windows it downloads
// that release's installer in the background, checks it against the
// release's SHA256SUMS.txt, and runs it when Cut Browser quits
// (Setup.exe /Update). The installer waits until every Cut Browser window,
// Tor windows too, has closed, then swaps in the new version; your profile
// and settings stay. "Restart to update" in the menu does it straight away.
// Where the installer can't update Cut Browser (Linux, or a copy that wasn't
// installed with it), Settings says when a new version is out.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AppConstants: "resource://gre/modules/AppConstants.sys.mjs",
  AppMenuNotifications: "resource://gre/modules/AppMenuNotifications.sys.mjs",
  setInterval: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

const STATE_TOPIC = "cut-update-state";
const FIRST_CHECK = 2 * 60 * 1000;
const CHECK_EVERY = 6 * 3600 * 1000;
const MAX_ATTEMPTS = 3; // installs of one version that didn't take, before asking you to install it yourself

// Version numbers like 1.10.2: whether `a` is newer than `b`.
export function isNewer(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x != y) {
      return x > y;
    }
  }
  return false;
}

// SHA256SUMS.txt: "<sha256>  <file name>" on each line.
export function parseSums(text) {
  const sums = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64}) [ *]?(.+)$/i);
    if (m) {
      sums.set(m[2].trim(), m[1].toLowerCase());
    }
  }
  return sums;
}

const hex = bytes => Array.from(bytes, c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");

export const CutUpdate = {
  STATE_TOPIC,

  // status: "idle" | "checking" | "latest" | "downloading" | "ready" | "manual" | "failed"
  state: { status: "idle" },

  // Cut Browser's own version (Firefox's is Services.appinfo.version).
  get current() {
    return Services.prefs.getStringPref("cut.version", "0");
  },

  get enabled() {
    return Services.prefs.getBoolPref("cut.update.enabled", true);
  },

  get installDir() {
    return Services.dirsvc.get("GreD", Ci.nsIFile);
  },

  // Whether Cut Browser's Windows installer, which can update it, installed
  // this copy (it puts uninstall.exe next to the browser).
  get canInstall() {
    if (lazy.AppConstants.platform != "win") {
      return false;
    }
    const uninstaller = this.installDir;
    uninstaller.append("uninstall.exe");
    return uninstaller.exists();
  },

  get _folder() {
    return PathUtils.join(PathUtils.tempDir, "cut-browser-update");
  },

  _initialized: false,
  _ready: null, // { version, path }: downloaded and checked, to install
  _busy: false,
  _relaunch: false,

  // Called once per session by CutBrowser.init(), in normal windows' copy of
  // the browser (Tor windows run from the same folder, so they're updated too).
  init() {
    if (this._initialized || Services.prefs.getBoolPref("cut.tor.instance", false)) {
      return;
    }
    this._initialized = true;
    this._restore().catch(console.error);
    Services.obs.addObserver(this, "quit-application");
    lazy.setTimeout(() => this.check(), FIRST_CHECK);
    lazy.setInterval(() => this.check(), 3600 * 1000); // check() keeps to six hours between checks
  },

  observe(subject, topic) {
    if (topic == "quit-application") {
      this._installOnQuit();
    }
  },

  // An update downloaded in an earlier session: still to install, or
  // installed since (then its installer is deleted).
  async _restore() {
    let ready = null;
    try {
      ready = JSON.parse(Services.prefs.getStringPref("cut.update.ready", ""));
    } catch (e) {}
    if (!ready) {
      return;
    }
    if (!isNewer(ready.version, this.current) || !this.canInstall || !(await IOUtils.exists(ready.path))) {
      this._forget();
      return;
    }
    this._ready = ready;
    if (Services.prefs.getIntPref("cut.update.attempts", 0) >= MAX_ATTEMPTS) {
      this._setState({ status: "manual", version: ready.version, error: "couldn't be installed by itself" });
      return;
    }
    this._setState({ status: "ready", version: ready.version });
    this._showBanner();
  },

  _forget() {
    this._ready = null;
    Services.prefs.clearUserPref("cut.update.ready");
    Services.prefs.clearUserPref("cut.update.attempts");
    lazy.AppMenuNotifications.removeNotification("update-restart");
    return IOUtils.remove(this._folder, { recursive: true, ignoreAbsent: true }).catch(() => {});
  },

  // Asks GitHub for the newest release, and downloads it if it's newer.
  // Without `manual`, at most every six hours and only if updates are on.
  async check({ manual = false } = {}) {
    if (this._busy || (!manual && !this.enabled)) {
      return;
    }
    if (!manual && Date.now() - Services.prefs.getIntPref("cut.update.lastCheck", 0) * 1000 < CHECK_EVERY) {
      return;
    }
    this._busy = true;
    this._setState({ status: "checking" });
    try {
      const release = await this._json(Services.prefs.getStringPref("cut.update.url", ""));
      Services.prefs.setIntPref("cut.update.lastCheck", Math.floor(Date.now() / 1000));
      const version = String(release.tag_name || "").replace(/^v/, "");
      if (!/^\d+(\.\d+)+$/.test(version)) {
        throw new Error("the newest release has no version number");
      }
      if (!isNewer(version, this.current)) {
        this._setState({ status: "latest" });
        return;
      }
      if (!this.canInstall) {
        this._setState({ status: "manual", version, url: release.html_url });
        return;
      }
      if (this._ready?.version == version) {
        this._setState({ status: "ready", version });
        return;
      }
      const name = `Cut-Browser-${version}-Setup-x64.exe`;
      const installer = release.assets?.find(a => a.name == name);
      const sums = release.assets?.find(a => a.name == "SHA256SUMS.txt");
      if (!installer || !sums) {
        throw new Error(`the release has no ${installer ? "SHA256SUMS.txt" : name}`);
      }
      const sha256 = parseSums(await this._text(sums.browser_download_url)).get(name);
      if (!sha256) {
        throw new Error(`SHA256SUMS.txt doesn't list ${name}`);
      }
      await this._forget(); // an older download it replaces
      this._setState({ status: "downloading", version, progress: 0 });
      const path = await this._download(installer.browser_download_url, name, sha256, installer.size, version);
      this._ready = { version, path };
      Services.prefs.setStringPref("cut.update.ready", JSON.stringify(this._ready));
      this._setState({ status: "ready", version });
      this._showBanner();
    } catch (e) {
      this._setState({ status: "failed", error: String(e.message || e) });
    } finally {
      this._busy = false;
    }
  },

  // No cookies or referrer go to GitHub with these requests.
  async _fetch(url) {
    const response = await fetch(url, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) {
      throw new Error(`${new URL(url).host} answered ${response.status}`);
    }
    return response;
  },

  async _json(url) {
    return (await this._fetch(url)).json();
  },

  async _text(url) {
    return (await this._fetch(url)).text();
  },

  // Streams the installer to disk, hashing it on the way. Only a file whose
  // SHA-256 matches the release's is kept.
  async _download(url, name, sha256, size, version) {
    await IOUtils.makeDirectory(this._folder, { ignoreExisting: true });
    const part = PathUtils.join(this._folder, `${name}.part`);
    await IOUtils.remove(part, { ignoreAbsent: true });
    const response = await this._fetch(url);
    const hash = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
    hash.init(Ci.nsICryptoHash.SHA256);
    const reader = response.body.getReader();
    let chunks = [];
    let pending = 0;
    let received = 0;
    let shown = 0;
    const flush = async () => {
      if (!pending) {
        return;
      }
      const block = new Uint8Array(pending);
      let at = 0;
      for (const chunk of chunks) {
        block.set(chunk, at);
        at += chunk.length;
      }
      chunks = [];
      pending = 0;
      await IOUtils.write(part, block, { mode: "appendOrCreate" });
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      hash.update(value, value.length);
      chunks.push(value);
      pending += value.length;
      received += value.length;
      if (pending >= 4 * 1024 * 1024) {
        await flush();
      }
      if (size && received - shown >= size / 50) {
        shown = received;
        this._setState({ status: "downloading", version, progress: Math.min(received / size, 1) });
      }
    }
    await flush();
    if (hex(hash.finish(false)) != sha256) {
      await IOUtils.remove(part, { ignoreAbsent: true });
      throw new Error("the download didn't match the release's checksum");
    }
    const path = PathUtils.join(this._folder, name);
    await IOUtils.move(part, path);
    return path;
  },

  // The menu's "Restart to update" item and badge, as Firefox shows for its
  // own updates, without a pop-up.
  _showBanner() {
    lazy.AppMenuNotifications.showNotification(
      "update-restart",
      { callback: () => this.restartNow(), dismiss: true },
      { callback: () => {}, dismiss: true },
      { dismissed: true }
    );
  },

  // Quits; the installer then updates Cut Browser and starts it again, with
  // your tabs.
  restartNow() {
    if (!this._ready) {
      return;
    }
    const cancel = Cc["@mozilla.org/supports-PRBool;1"].createInstance(Ci.nsISupportsPRBool);
    Services.obs.notifyObservers(cancel, "quit-application-requested", "restart");
    if (cancel.data) {
      return;
    }
    this._relaunch = true;
    Services.prefs.setBoolPref("browser.sessionstore.resume_session_once", true);
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  },

  _installOnQuit() {
    if (!this._ready || !(this.enabled || this._relaunch) || !this.canInstall) {
      return;
    }
    const attempts = Services.prefs.getIntPref("cut.update.attempts", 0);
    if (attempts >= MAX_ATTEMPTS && !this._relaunch) {
      return;
    }
    try {
      const installer = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      installer.initWithPath(this._ready.path);
      const args = ["/Update", `/D=${this.installDir.path}`, `/WaitFor=${Services.appinfo.processID}`];
      if (this._relaunch) {
        args.push("/Relaunch");
      }
      const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
      process.init(installer);
      process.startHidden = true;
      process.runwAsync(args, args.length);
      Services.prefs.setIntPref("cut.update.attempts", attempts + 1);
    } catch (e) {
      console.error("[Cut Update]", e);
    }
  },

  _setState(state) {
    this.state = { checkedAt: Services.prefs.getIntPref("cut.update.lastCheck", 0) * 1000, ...state };
    Services.obs.notifyObservers(null, STATE_TOPIC);
  },
};
