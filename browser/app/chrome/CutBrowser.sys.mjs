/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Cut Browser's app-wide services, loaded once per session by every browser
// window: the bundled Cut Search server and the search engine that uses it.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AppConstants: "resource://gre/modules/AppConstants.sys.mjs",
  SearchService: "moz-src:///toolkit/components/search/SearchService.sys.mjs",
  Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

const TOOLBAR_VERSION = 3;
const TOOLBAR_ORDER = [
  "sidebar-button",
  "back-button",
  "forward-button",
  "stop-reload-button",
  "vertical-spacer",
  "urlbar-container",
  "cut-compact-button",
  "reset-pbm-toolbar-button",
  "unified-extensions-button",
];

const ENGINE_NAME = "Cut Search";
const OLD_ENGINE_NAMES = ["Cut"]; // renamed in place, keeping the user's choices
const PORT_ATTEMPTS = 20;
const READY_TIMEOUT = 20000;
const MAX_RESTARTS = 3;
const EXIT_PORT_IN_USE = 3;

export const MARK_SVG =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g fill="#e0552b" stroke="#e0552b" stroke-width="6.4" stroke-linejoin="round"><path d="M34.238 6.836A17.8 17.8 0 0 0 10.036 31.038Z"/><path d="M39.564 15.362A17.8 17.8 0 0 1 15.362 39.564Z"/></g></svg>'
  );

const log = (...args) => console.info("[Cut Search]", ...args);
const sleep = ms => new Promise(resolve => lazy.setTimeout(resolve, ms));

// The server ships next to the browser: cut-search/cut-search(.exe) is the
// Node.js runtime, cut-search/app/server.js is Cut Search itself.
function locateServer() {
  let dir = Services.dirsvc.get("GreD", Ci.nsIFile);
  dir.append("cut-search");
  let exe = dir.clone();
  exe.append(lazy.AppConstants.platform == "win" ? "cut-search.exe" : "cut-search");
  let script = dir.clone();
  script.append("app");
  script.append("server.js");
  return exe.exists() && script.exists() ? { exe, script } : null;
}

export const CutSearch = {
  // "starting" | "running" | "remote" | "disabled" | "failed"
  state: "starting",
  baseURL: null,
  port: null,
  error: null,
  attempts: [],
  _process: null,
  _stopping: false,
  _restarts: 0,
  _ready: null,

  // Resolves with the server's base URL (or null if it couldn't start).
  whenReady() {
    if (!this._ready) {
      this._ready = this._start();
    }
    return this._ready;
  },

  async _start() {
    this.state = "starting";
    this.error = null;
    if (!Services.prefs.getBoolPref("cut.search.enabled", true)) {
      this.state = "disabled";
      return null;
    }
    let remote = Services.prefs.getStringPref("cut.search.remote", "").trim();
    if (/^https?:\/\//i.test(remote)) {
      this.state = "remote";
      this.baseURL = remote.replace(/\/+$/, "");
      return this.baseURL;
    }
    let files = locateServer();
    if (!files) {
      this._fail("Cut Search isn't installed next to the browser.");
      return null;
    }
    // Starting the server is the port check: it exits with a known code if
    // the port is taken (by another app, or another Cut Browser's server).
    let first = Services.prefs.getIntPref("cut.search.port", 28800);
    this.attempts = [];
    for (let port = first; port < first + PORT_ATTEMPTS; port++) {
      let result = await this._launch(files, port);
      this.attempts.push({ port, result });
      if (result == "ready") {
        this.state = "running";
        this.port = port;
        this.baseURL = `http://127.0.0.1:${port}`;
        if (port != first) {
          Services.prefs.setIntPref("cut.search.port", port);
        }
        log(`running on ${this.baseURL}`);
        return this.baseURL;
      }
      if (result != "port-in-use") {
        break;
      }
    }
    this._fail(this.error || "Every port Cut Search tried was in use.");
    return null;
  },

  async _launch({ exe, script }, port) {
    let dataDir = Services.dirsvc.get("ProfD", Ci.nsIFile);
    dataDir.append("cut-search");
    let proc;
    try {
      proc = await lazy.Subprocess.call({
        command: exe.path,
        arguments: [script.path],
        workdir: script.parent.path,
        environment: {
          PORT: String(port),
          HOST: "127.0.0.1",
          CUT_DATA_DIR: dataDir.path,
          CUT_PARENT_PID: String(Services.appinfo.processID),
          CUT_EMBEDDED: "1",
          RATE_LIMIT: "false",
          NODE_ENV: "production",
        },
        environmentAppend: true,
        stderr: "stdout",
      });
    } catch (e) {
      this.error = `Couldn't run Cut Search: ${e.message || e}`;
      return "error";
    }
    let ready = new Promise(resolve => this._drain(proc, resolve));
    let exited = proc.wait();
    let outcome = await Promise.race([
      ready.then(() => "ready"),
      exited.then(({ exitCode }) => (exitCode == EXIT_PORT_IN_USE ? "port-in-use" : `exit-${exitCode}`)),
      sleep(READY_TIMEOUT).then(() => "timeout"),
    ]);
    if (outcome == "ready") {
      this._process = proc;
      exited.then(({ exitCode }) => this._onExit(proc, exitCode));
    } else if (outcome == "timeout") {
      proc.kill();
      this.error = "Cut Search took too long to start.";
    } else if (outcome != "port-in-use") {
      this.error = `Cut Search stopped during startup (${outcome}).`;
    }
    return outcome;
  },

  // Reads the server's output: the ready line, then anything it logs (sent
  // to the Browser Console). Reading also keeps the pipe from filling up.
  async _drain(proc, onReady) {
    let pending = "";
    try {
      let text;
      while ((text = await proc.stdout.readString())) {
        pending += text;
        let lines = pending.split(/\r?\n/);
        pending = lines.pop();
        for (let line of lines) {
          if (/^CUT_READY \d+/.test(line)) {
            onReady();
          } else if (line.trim()) {
            log(line.trim());
          }
        }
      }
    } catch (e) {}
  },

  _onExit(proc, exitCode) {
    if (this._process != proc || this._stopping) {
      return;
    }
    this._process = null;
    log(`stopped unexpectedly (exit code ${exitCode})`);
    if (this._restarts++ < MAX_RESTARTS) {
      this._ready = this._start().then(url => {
        if (url) {
          CutSearchEngine.ensure(url).catch(e => console.error("[Cut Search]", e));
        }
        return url;
      });
    } else {
      this._fail("Cut Search keeps stopping.");
    }
  },

  _fail(message) {
    this.state = "failed";
    this.error = message;
    console.error("[Cut Search]", message);
  },

  stop() {
    this._stopping = true;
    if (this._process) {
      this._process.kill();
      this._process = null;
    }
  },

  // Stops the server (if running) and starts again with the current
  // settings; resolves with the new base URL.
  async restart() {
    this.stop();
    this._stopping = false;
    this._restarts = 0;
    this.baseURL = null;
    this.port = null;
    this._ready = this._start();
    return this._ready;
  },
};

export const CutSearchEngine = {
  // Adds the "Cut Search" engine (or points it at a new address) and, the first
  // time, makes it the default in normal and private windows.
  async ensure(baseURL) {
    let search = lazy.SearchService;
    await search.init();
    let url = `${baseURL}/search?q={searchTerms}`;
    let suggestUrl = `${baseURL}/ac?type=list&q={searchTerms}`;
    let engine = search.getEngineByName(ENGINE_NAME);
    for (let old of OLD_ENGINE_NAMES) {
      let previous = !engine && search.getEngineByName(old);
      if (previous && typeof previous.rename == "function" && previous.rename(ENGINE_NAME)) {
        engine = previous;
      }
    }
    if (engine && typeof engine.changeUrl == "function") {
      let current = engine.getSubmission("x").uri.spec;
      if (!current.startsWith(`${baseURL}/`)) {
        engine.changeUrl("text/html", url, null);
        engine.changeUrl("application/x-suggestions+json", suggestUrl, null);
      }
    } else if (!engine) {
      engine = await search.addUserEngine({ name: ENGINE_NAME, url, suggestUrl, alias: "@cut" });
    }
    if (engine && typeof engine.changeIcon == "function") {
      try {
        engine.changeIcon(MARK_SVG);
      } catch (e) {}
    }
    if (engine && !Services.prefs.getBoolPref("cut.search.defaultSet", false)) {
      await search.setDefault(engine, search.CHANGE_REASON.USER);
      await search.setDefaultPrivate(engine, search.CHANGE_REASON.USER);
      Services.prefs.setBoolPref("cut.search.defaultSet", true);
    }
    return engine;
  },

  // With Cut Search turned off, a Cut default would lead nowhere: hand over
  // to DuckDuckGo (or the first other engine) until it's turned back on.
  async stepAside() {
    let search = lazy.SearchService;
    await search.init();
    let current = await search.getDefault();
    if (current?.name != ENGINE_NAME) {
      return;
    }
    let others = (await search.getVisibleEngines()).filter(e => e.name != ENGINE_NAME);
    let fallback = others.find(e => /duckduckgo/i.test(e.name)) || others[0];
    if (fallback) {
      await search.setDefault(fallback, search.CHANGE_REASON.USER);
      await search.setDefaultPrivate(fallback, search.CHANGE_REASON.USER);
      Services.prefs.setStringPref("cut.search.steppedAsideFor", fallback.name);
    }
  },

  // Turning Cut Search back on restores it as the default, unless you chose
  // a different engine in the meantime.
  async restoreDefault() {
    let steppedAsideFor = Services.prefs.getStringPref("cut.search.steppedAsideFor", "");
    if (!steppedAsideFor) {
      return;
    }
    Services.prefs.clearUserPref("cut.search.steppedAsideFor");
    let search = lazy.SearchService;
    let current = await search.getDefault();
    let engine = search.getEngineByName(ENGINE_NAME);
    if (engine && current?.name == steppedAsideFor) {
      await search.setDefault(engine, search.CHANGE_REASON.USER);
      await search.setDefaultPrivate(engine, search.CHANGE_REASON.USER);
    }
  },
};

export const CutBrowser = {
  _initialized: false,

  init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;
    Services.obs.addObserver(this, "quit-application");
    this._registerContentStyles();
    // The engine is registered straight away on the expected address, so
    // even the first search goes to Cut; if the server has to use another
    // port, the engine follows it once the server is up.
    let expected = this._expectedSearchURL();
    let ready = CutSearch.whenReady();
    (expected ? CutSearchEngine.ensure(expected) : CutSearchEngine.stepAside())
      .then(() => ready)
      .then(url => (url && url != expected ? CutSearchEngine.ensure(url) : null))
      .catch(e => console.error("[Cut Search] engine setup failed", e))
      .finally(() => Services.obs.notifyObservers(null, "cut-search-state-changed"));

    // Switching between the built-in server and your own applies at once.
    for (let pref of ["cut.search.enabled", "cut.search.remote"]) {
      Services.prefs.addObserver(pref, () => this.applySearchSettings());
    }
  },

  async applySearchSettings() {
    let url = await CutSearch.restart();
    if (url) {
      await CutSearchEngine.ensure(url);
      await CutSearchEngine.restoreDefault();
    } else {
      await CutSearchEngine.stepAside();
    }
    Services.obs.notifyObservers(null, "cut-search-state-changed");
    return url;
  },

  _expectedSearchURL() {
    if (!Services.prefs.getBoolPref("cut.search.enabled", true)) {
      return null;
    }
    let remote = Services.prefs.getStringPref("cut.search.remote", "").trim();
    if (/^https?:\/\//i.test(remote)) {
      return remote.replace(/\/+$/, "");
    }
    return `http://127.0.0.1:${Services.prefs.getIntPref("cut.search.port", 28800)}`;
  },

  observe(subject, topic) {
    if (topic == "quit-application") {
      CutSearch.stop();
    }
  },

  // Adds Cut's toolbar button (once per session) and, the first time (or
  // after an update that changes it), sets the toolbar's order. After that
  // the toolbar is the user's: anything can be moved in Customize Toolbar.
  setUpToolbar(win) {
    let { CustomizableUI } = win;
    if (!this._widgetsCreated) {
      this._widgetsCreated = true;
      CustomizableUI.createWidget({
        id: "cut-compact-button",
        type: "button",
        label: "Compact mode",
        tooltiptext: "Hide the sidebar and toolbar until you point at the window's edge (Ctrl+Alt+C)",
        onCommand(event) {
          event.target.ownerGlobal.CutUI.toggleCompact();
        },
      });
    }
    if (Services.prefs.getIntPref("cut.ui.toolbarVersion", 0) >= TOOLBAR_VERSION) {
      return;
    }
    Services.prefs.setIntPref("cut.ui.toolbarVersion", TOOLBAR_VERSION);
    let navbar = CustomizableUI.AREA_NAVBAR;
    // Placing the sidebar button now also stops Firefox from appending one
    // at the far end on a later start.
    for (let id of ["sidebar-button", "stop-reload-button", "cut-compact-button"]) {
      if (!CustomizableUI.getPlacementOfWidget(id)) {
        CustomizableUI.addWidgetToArea(id, navbar);
      }
    }
    // With tabs in the sidebar, "List all tabs" only repeats it.
    if (Services.prefs.getBoolPref("sidebar.verticalTabs", true) && CustomizableUI.getPlacementOfWidget("alltabs-button")?.area == navbar) {
      CustomizableUI.removeWidgetFromArea("alltabs-button");
    }
    // New windows are built from the saved placement list, which Firefox's
    // vertical-tabs defaults leave out of order (Forward before Back), so the
    // whole order is written out; buttons not listed keep theirs, after these.
    let index = 0;
    for (let id of TOOLBAR_ORDER) {
      if (CustomizableUI.getPlacementOfWidget(id)?.area == navbar) {
        CustomizableUI.moveWidgetWithinArea(id, index++);
      }
    }
  },

  // Cut's colors for Firefox's own pages (new tab, private browsing,
  // settings). A user sheet reaches every process; its rules are scoped.
  _registerContentStyles() {
    let sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
    let uri = Services.io.newURI("chrome://browser/content/cut/content.css");
    if (!sss.sheetRegistered(uri, sss.USER_SHEET)) {
      sss.loadAndRegisterSheet(uri, sss.USER_SHEET);
    }
  },
};
