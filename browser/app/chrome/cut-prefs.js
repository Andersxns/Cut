/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global register_module, gotoPref, openTrustedLinkIn */

// Cut Browser's pane in Settings (about:preferences#cut).

(() => {
  const { CutSearch, CutBrowser } = ChromeUtils.importESModule("resource://cut/CutBrowser.sys.mjs");
  const { CutTor } = ChromeUtils.importESModule("resource://cut/CutTor.sys.mjs");
  const { CutUpdate } = ChromeUtils.importESModule("resource://cut/CutUpdate.sys.mjs");

  const TOGGLES = {
    cutCompact: { pref: "cut.ui.compact", fallback: false },
    cutFloatingUrlbar: { pref: "cut.ui.floatingUrlbar", fallback: true },
    cutVerticalTabs: { pref: "sidebar.verticalTabs", fallback: true },
    cutSearchEnabled: { pref: "cut.search.enabled", fallback: true },
    cutTorEnabled: { pref: "cut.tor.enabled", fallback: true },
    cutTorOnions: { pref: "cut.tor.openOnions", fallback: true },
    cutTorOnionLocation: { pref: "cut.tor.onionLocation", fallback: true },
    cutTorPreferOnions: { pref: "cut.tor.preferOnions", fallback: false },
    cutUpdateEnabled: { pref: "cut.update.enabled", fallback: true },
  };

  // "3 hours ago"
  const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  function ago(time) {
    const minutes = Math.round((time - Date.now()) / 60000);
    if (minutes > -1) {
      return "just now";
    }
    if (minutes > -60) {
      return relative.format(minutes, "minute");
    }
    const hours = Math.round(minutes / 60);
    return hours > -24 ? relative.format(hours, "hour") : relative.format(Math.round(hours / 24), "day");
  }

  const RELEASES = "https://github.com/Andersxns/Cut/releases";
  const ISSUES = "https://github.com/Andersxns/Cut/issues";

  // Cut Browser's update states (CutUpdate.state.status), as the states of
  // the update row on Firefox's About page.
  const ABOUT_UPDATE_STATES = {
    idle: s => (s.checkedAt ? "noUpdatesFound" : "checkForUpdates"),
    checking: () => "checkingForUpdates",
    latest: () => "noUpdatesFound",
    downloading: () => "downloading",
    ready: () => "apply",
    manual: () => "manualUpdate",
    failed: () => "checkingFailed",
  };

  const UPDATE_STATES = {
    idle: s =>
      !CutUpdate.enabled
        ? `Cut Browser ${CutUpdate.current}. Automatic updates are off.`
        : s.checkedAt
          ? `Cut Browser ${CutUpdate.current} is up to date. Checked ${ago(s.checkedAt)}.`
          : `Cut Browser ${CutUpdate.current}. It checks for updates a few minutes after it starts.`,
    checking: () => "Checking for updates…",
    latest: s => `Cut Browser ${CutUpdate.current} is up to date. Checked ${ago(s.checkedAt)}.`,
    downloading: s => `Downloading Cut Browser ${s.version}… ${Math.round((s.progress || 0) * 100)}%`,
    ready: s => `Cut Browser ${s.version} is ready. It installs when you close Cut Browser.`,
    manual: s => (s.error ? `Cut Browser ${s.version} ${s.error}. You can download it from GitHub.` : `Cut Browser ${s.version} is out.`),
    failed: s => `Couldn't check for updates: ${s.error}.`,
  };

  const TOR_STATES = {
    starting: () => "Starting Tor…",
    connecting: s => `Connecting to Tor… ${s.progress}%`,
    connected: () => "Connected to Tor. Everything in this window goes through Tor.",
    failed: s => `Couldn't connect to Tor: ${s.error}`,
  };

  const STATES = {
    starting: () => "Cut Search is starting…",
    running: () => `Cut Search is running on this computer at ${CutSearch.baseURL}.`,
    remote: () => `Using your Cut Search server at ${CutSearch.baseURL}.`,
    disabled: () => "Cut Search is turned off.",
    failed: () => `Cut Search isn't running: ${CutSearch.error || "it couldn't start."}`,
  };

  const gCutPane = {
    init() {
      // With Firefox's settings redesign on, pane templates aren't inserted
      // for us; Firefox shows #mainPrefPane children by data-category.
      const template = document.getElementById("template-paneCut");
      if (template) {
        template.replaceWith(template.content);
      }
      for (const [id, { pref, fallback }] of Object.entries(TOGGLES)) {
        const toggle = document.getElementById(id);
        toggle.pressed = Services.prefs.getBoolPref(pref, fallback);
        toggle.addEventListener("toggle", () => Services.prefs.setBoolPref(pref, toggle.pressed));
      }

      const remote = document.getElementById("cutSearchRemote");
      remote.value = Services.prefs.getStringPref("cut.search.remote", "");
      remote.addEventListener("change", () => {
        const value = remote.value.trim();
        if (value && !/^https?:\/\/[^/\s]+/i.test(value)) {
          remote.setCustomValidity("Enter an address that starts with https://");
          remote.reportValidity();
          return;
        }
        remote.setCustomValidity("");
        Services.prefs.setStringPref("cut.search.remote", value);
      });

      document.getElementById("cutSearchOpenSettings").addEventListener("command", () => {
        if (CutSearch.baseURL) {
          openTrustedLinkIn(`${CutSearch.baseURL}/settings`, "tab");
        }
      });
      document.getElementById("cutSearchRestart").addEventListener("command", () => {
        this.showStatus("starting");
        CutBrowser.applySearchSettings();
      });
      document.getElementById("cutOpenPrivacy").addEventListener("command", () => gotoPref("panePrivacy"));

      const version = document.getElementById("cutVersion");
      version.textContent = `Cut Browser ${CutUpdate.current}, built on Firefox ${Services.appinfo.version}. Firefox is a trademark of the Mozilla Foundation; Cut Browser is not affiliated with Mozilla. The Firefox source code is available under the Mozilla Public License 2.0.`;
      this.initUpdates();
      try {
        this.takeOverAboutPage();
      } catch (e) {
        console.error("[Cut] couldn't adapt the About page", e);
      }

      const update = () => this.showStatus(CutSearch.state);
      Services.obs.addObserver(update, "cut-search-state-changed");
      window.addEventListener("unload", () => Services.obs.removeObserver(update, "cut-search-state-changed"));
      CutSearch.whenReady().then(update);
      update();
      this.initTor();
    },

    // Updates (CutUpdate.sys.mjs). Where the installer can't update Cut
    // Browser (Linux), it only says when a new version is out.
    initUpdates() {
      const status = document.getElementById("cutUpdateStatus");
      const restart = document.getElementById("cutUpdateRestart");
      const download = document.getElementById("cutUpdateDownload");
      const notes = document.getElementById("cutUpdateNotes");
      const check = document.getElementById("cutUpdateCheck");
      if (!CutUpdate.canInstall) {
        document.getElementById("cutUpdateEnabled").description = "Cut Browser asks GitHub for new versions every six hours, and says so here when one is out.";
      }
      const show = () => {
        const s = CutUpdate.state;
        status.textContent = (UPDATE_STATES[s.status] || UPDATE_STATES.idle)(s);
        status.dataset.state = s.status;
        restart.hidden = s.status != "ready";
        download.hidden = s.status != "manual";
        notes.hidden = !(s.status == "ready" || s.status == "downloading");
        notes.label = `What’s new in ${s.version}`;
        check.disabled = s.status == "checking" || s.status == "downloading";
      };
      Services.obs.addObserver(show, CutUpdate.STATE_TOPIC);
      Services.prefs.addObserver("cut.update.enabled", show);
      window.addEventListener("unload", () => {
        Services.obs.removeObserver(show, CutUpdate.STATE_TOPIC);
        Services.prefs.removeObserver("cut.update.enabled", show);
      });
      check.addEventListener("command", () => CutUpdate.check({ manual: true }));
      restart.addEventListener("command", () => CutUpdate.restartNow());
      notes.addEventListener("command", () => openTrustedLinkIn(`${RELEASES}/tag/v${CutUpdate.state.version}`, "tab"));
      download.addEventListener("command", () => openTrustedLinkIn(CutUpdate.state.url || `${RELEASES}/latest`, "tab"));
      show();
    },

    // Firefox's About page in Settings runs Firefox's updater, which Cut
    // Browser turns off ("Updates disabled by your organization"). Its rows
    // show Cut Browser's instead: the update row and its buttons drive
    // CutUpdate, the version is Cut Browser's (with Firefox's), the update
    // history is Cut Browser's releases, and help and feedback go to its
    // GitHub. The settings are the page's own, so they're adapted in place.
    takeOverAboutPage() {
      const { Preferences } = ChromeUtils.importESModule("chrome://global/content/preferences/Preferences.mjs", { global: "current" });
      const setting = id => Preferences.getSetting(id);

      const state = setting("updateState");
      if (state?.config) {
        if (CutTor.isTorApp) {
          // Updated along with normal windows' copy of the browser.
          state.config.get = () => "otherInstanceHandlingUpdates";
        } else {
          // Its buttons call gAppUpdater. Firefox's stays for the Privacy
          // page's security status, which shares its AppUpdater.
          const firefoxUpdater = window.gAppUpdater;
          window.gAppUpdater = {
            _appUpdater: firefoxUpdater?._appUpdater,
            checkForUpdates: () => CutUpdate.check({ manual: true }),
            startDownload() {},
            buttonRestartAfterDownload: () => CutUpdate.restartNow(),
            destroy: () => firefoxUpdater?.destroy(),
          };
          state.config.get = () => (ABOUT_UPDATE_STATES[CutUpdate.state.status] || ABOUT_UPDATE_STATES.idle)(CutUpdate.state);
          state.config.getControlConfig = config => {
            config.controlAttrs = { ".linkURL": "", ".updateVersion": CutUpdate.state.version || "", ".transfer": `${Math.round((CutUpdate.state.progress || 0) * 100)}%` };
            return config;
          };
          const show = () => state.onChange();
          Services.obs.addObserver(show, CutUpdate.STATE_TOPIC);
          window.addEventListener("unload", () => Services.obs.removeObserver(show, CutUpdate.STATE_TOPIC));
        }
        state.onChange();
      }

      // "Version 1.2.2 · Firefox 157.0 (64-bit)"; "What's new" opens this
      // version's release notes (app.releaseNotesURL).
      const info = setting("updateAppInfo");
      const firefoxInfo = info?.config.getControlConfig;
      if (firefoxInfo) {
        info.config.getControlConfig = (config, ...rest) => {
          config = firefoxInfo.call(info.config, config, ...rest);
          const version = String(config.controlAttrs?.[".version"] || "");
          if (version && !version.startsWith(`${CutUpdate.current} `)) {
            config.controlAttrs[".version"] = `${CutUpdate.current} · Firefox ${version}`;
          }
          return config;
        };
        info.onChange();
      }

      // Cut Browser's releases are its update history. While an update is on
      // its way, the row opens that version's release notes instead.
      const history = setting("showUpdateHistory");
      if (history) {
        const pending = () => (["downloading", "ready", "manual"].includes(CutUpdate.state.status) && CutUpdate.state.version) || "";
        history.config.disabled = () => false;
        history.config.getControlConfig = config =>
          pending()
            ? { ...config, l10nId: "cut-update-whats-new", l10nArgs: { version: pending() } }
            : { ...config, l10nId: "update-history-2", l10nArgs: undefined };
        history.config.onUserClick = () => openTrustedLinkIn(pending() ? `${RELEASES}/tag/v${pending()}` : RELEASES, "tab");
        const show = () => history.onChange();
        Services.obs.addObserver(show, CutUpdate.STATE_TOPIC);
        window.addEventListener("unload", () => Services.obs.removeObserver(show, CutUpdate.STATE_TOPIC));
        history.onChange();
      }

      for (const [id, href] of [
        ["supportGetHelp", ISSUES],
        ["supportShareIdeas", `${ISSUES}/new`],
      ]) {
        const link = setting(id);
        if (link) {
          link.config.getControlConfig = config => ({ ...config, supportPage: undefined, controlAttrs: { ...config.controlAttrs, href } });
          link.onChange();
        }
      }
    },

    // Tor windows: opened and set up from a normal window; a Tor window's
    // own settings show its status instead.
    initTor() {
      const torApp = CutTor.isTorApp;
      for (const el of document.querySelectorAll(".cut-tor-normal")) {
        el.hidden = torApp;
      }
      for (const el of document.querySelectorAll(".cut-tor-own")) {
        el.hidden = !torApp;
      }
      if (torApp) {
        const status = document.getElementById("cutTorStatus");
        const show = () => {
          const s = CutTor.status;
          status.textContent = (TOR_STATES[s.state] || TOR_STATES.starting)(s);
          status.dataset.state = s.state;
        };
        Services.obs.addObserver(show, CutTor.STATUS_TOPIC);
        window.addEventListener("unload", () => Services.obs.removeObserver(show, CutTor.STATUS_TOPIC));
        show();
        document.getElementById("cutTorNewIdentity").addEventListener("command", () => window.browsingContext.topChromeWindow.CutUI.newIdentity());
        return;
      }
      if (!CutTor.available) {
        document.getElementById("cutTorGroup").hidden = true;
        return;
      }
      document.getElementById("cutTorOpen").addEventListener("command", () => CutTor.open());

      const bridges = document.getElementById("cutTorBridges");
      const custom = document.getElementById("cutTorCustomBridges");
      const customField = document.getElementById("cutTorCustomField");
      bridges.value = Services.prefs.getStringPref("cut.tor.bridges", "");
      custom.value = Services.prefs.getStringPref("cut.tor.customBridges", "");
      const syncCustom = () => {
        customField.hidden = bridges.value != "custom";
      };
      syncCustom();
      bridges.addEventListener("change", () => {
        Services.prefs.setStringPref("cut.tor.bridges", bridges.value);
        syncCustom();
      });
      custom.addEventListener("change", () => Services.prefs.setStringPref("cut.tor.customBridges", custom.value));
    },

    showStatus(state) {
      const status = document.getElementById("cutSearchStatus");
      status.textContent = (STATES[state] || STATES.starting)();
      status.dataset.state = state;
      document.getElementById("cutSearchOpenSettings").disabled = !CutSearch.baseURL || state == "starting";
    },
  };

  register_module("paneCut", gCutPane);

  // Cut's mark instead of Firefox's on the About item.
  window.addEventListener(
    "DOMContentLoaded",
    () => {
      document.getElementById("category-about-firefox")?.setAttribute("iconsrc", "chrome://browser/content/cut/icons/mark.svg");
    },
    { once: true }
  );
})();
