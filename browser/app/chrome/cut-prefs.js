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
      download.addEventListener("command", () => openTrustedLinkIn(CutUpdate.state.url || "https://github.com/Andersxns/Cut/releases/latest", "tab"));
      show();
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
