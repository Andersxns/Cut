/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global register_module, gotoPref, openTrustedLinkIn */

// Cut Browser's pane in Settings (about:preferences#cut).

(() => {
  const { CutSearch, CutBrowser } = ChromeUtils.importESModule("resource://cut/CutBrowser.sys.mjs");
  const { CutTor } = ChromeUtils.importESModule("resource://cut/CutTor.sys.mjs");

  const TOGGLES = {
    cutCompact: { pref: "cut.ui.compact", fallback: false },
    cutFloatingUrlbar: { pref: "cut.ui.floatingUrlbar", fallback: true },
    cutVerticalTabs: { pref: "sidebar.verticalTabs", fallback: true },
    cutSearchEnabled: { pref: "cut.search.enabled", fallback: true },
    cutTorEnabled: { pref: "cut.tor.enabled", fallback: true },
    cutTorOnions: { pref: "cut.tor.openOnions", fallback: true },
    cutTorOnionLocation: { pref: "cut.tor.onionLocation", fallback: true },
    cutTorPreferOnions: { pref: "cut.tor.preferOnions", fallback: false },
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
      version.textContent = `Cut Browser, built on Firefox ${Services.appinfo.version}. Firefox is a trademark of the Mozilla Foundation; Cut Browser is not affiliated with Mozilla. The Firefox source code is available under the Mozilla Public License 2.0.`;

      const update = () => this.showStatus(CutSearch.state);
      Services.obs.addObserver(update, "cut-search-state-changed");
      window.addEventListener("unload", () => Services.obs.removeObserver(update, "cut-search-state-changed"));
      CutSearch.whenReady().then(update);
      update();
      this.initTor();
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
