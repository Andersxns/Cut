/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global register_module, gotoPref, openTrustedLinkIn */

// Cut Browser's pane in Settings (about:preferences#cut).

(() => {
  const { CutSearch, CutBrowser } = ChromeUtils.importESModule("resource://cut/CutBrowser.sys.mjs");

  const TOGGLES = {
    cutCompact: { pref: "cut.ui.compact", fallback: false },
    cutFloatingUrlbar: { pref: "cut.ui.floatingUrlbar", fallback: true },
    cutVerticalTabs: { pref: "sidebar.verticalTabs", fallback: true },
    cutSearchEnabled: { pref: "cut.search.enabled", fallback: true },
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
