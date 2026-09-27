/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Cut Browser: per-window setup, loaded by browser.xhtml.

(() => {
  const { CutBrowser } = ChromeUtils.importESModule("resource://cut/CutBrowser.sys.mjs");
  CutBrowser.init();

  const root = document.documentElement;
  const PREFS = {
    compact: "cut.ui.compact",
    floating: "cut.ui.floatingUrlbar",
  };

  // Attributes on <html> follow prefs, so every window updates together.
  function syncPrefs() {
    root.toggleAttribute("cut-compact", Services.prefs.getBoolPref(PREFS.compact, false));
    root.toggleAttribute("cut-floating-urlbar", Services.prefs.getBoolPref(PREFS.floating, true));
  }
  const prefObserver = { observe: syncPrefs };
  for (const pref of Object.values(PREFS)) {
    Services.prefs.addObserver(pref, prefObserver);
  }
  window.addEventListener("unload", () => {
    for (const pref of Object.values(PREFS)) {
      Services.prefs.removeObserver(pref, prefObserver);
    }
  });
  syncPrefs();

  window.CutUI = {
    toggleCompact() {
      Services.prefs.setBoolPref(PREFS.compact, !Services.prefs.getBoolPref(PREFS.compact, false));
    },
  };

  window.addEventListener(
    "DOMContentLoaded",
    () => {
      setUpLayout();
      setUpCompactMode();
      setUpFloatingUrlbar();
      setUpShortcuts();
    },
    { once: true }
  );

  // Toolbar setup needs CustomizableUI, which is ready after delayed startup.
  const onStartup = subject => {
    if (subject != window) {
      return;
    }
    Services.obs.removeObserver(onStartup, "browser-delayed-startup-finished");
    CutBrowser.setUpToolbar(window);
  };
  Services.obs.addObserver(onStartup, "browser-delayed-startup-finished");

  // The sidebar runs the full height of the window, with the toolbar above
  // the page only. CSS needs the toolbar's height and the sidebar's width.
  function setUpLayout() {
    const toolbox = document.getElementById("navigator-toolbox");
    const sidebar = document.getElementById("sidebar-container");
    if (!toolbox || !sidebar) {
      return;
    }
    const update = () => {
      const sidebarShown = !sidebar.hidden && sidebar.getBoundingClientRect().width > 0;
      const atStart = Services.prefs.getBoolPref("sidebar.position_start", true);
      root.toggleAttribute("cut-split-layout", sidebarShown && atStart);
      root.style.setProperty("--cut-toolbox-height", `${toolbox.getBoundingClientRect().height}px`);
      root.style.setProperty("--cut-sidebar-width", `${sidebar.getBoundingClientRect().width}px`);
    };
    const observer = new ResizeObserver(() => requestAnimationFrame(update));
    observer.observe(toolbox);
    observer.observe(sidebar);
    new MutationObserver(update).observe(sidebar, { attributes: true, attributeFilter: ["hidden"] });
    update();
  }

  // Compact mode: point at the left edge for the sidebar, the top edge for
  // the toolbar. They stay while you use them and slip away afterwards.
  function setUpCompactMode() {
    const EDGE = 6;
    const LINGER = 450;
    const toolbox = document.getElementById("navigator-toolbox");
    const sidebar = document.getElementById("sidebar-container");
    const timers = {};
    const peek = (name, on) => {
      clearTimeout(timers[name]);
      if (on) {
        root.setAttribute(name, "");
      } else {
        timers[name] = setTimeout(() => {
          if (!busy(name == "cut-sidebar-peek" ? sidebar : toolbox)) {
            root.removeAttribute(name);
          }
        }, LINGER);
      }
    };
    // Keep a part out while you use it, including while a menu or panel it
    // opened (a tab's context menu, the app menu) is showing.
    const openedFrom = new Map();
    document.addEventListener("popupshown", e => {
      const source = e.target.triggerNode || e.target.anchorNode;
      for (const part of [sidebar, toolbox]) {
        if (source && part.contains(source)) {
          openedFrom.set(e.target, part);
        }
      }
    });
    const busy = el => el.matches(":hover, :focus-within") || [...openedFrom.values()].includes(el);

    window.addEventListener("mousemove", e => {
      if (!root.hasAttribute("cut-compact")) {
        return;
      }
      if (e.clientX <= EDGE) {
        peek("cut-sidebar-peek", true);
      }
      if (e.clientY <= EDGE) {
        peek("cut-toolbar-peek", true);
      }
    });
    sidebar.addEventListener("mouseenter", () => peek("cut-sidebar-peek", true));
    sidebar.addEventListener("mouseleave", () => peek("cut-sidebar-peek", false));
    toolbox.addEventListener("mouseenter", () => peek("cut-toolbar-peek", true));
    toolbox.addEventListener("mouseleave", () => peek("cut-toolbar-peek", false));
    document.addEventListener("popuphidden", e => {
      openedFrom.delete(e.target);
      for (const name of ["cut-sidebar-peek", "cut-toolbar-peek"]) {
        if (root.hasAttribute(name)) {
          peek(name, false);
        }
      }
    });
  }

  // Dims the page while the floating address bar shows results.
  function setUpFloatingUrlbar() {
    const urlbar = document.getElementById("urlbar");
    if (!urlbar) {
      return;
    }
    const update = () => root.toggleAttribute("cut-urlbar-open", urlbar.hasAttribute("breakout-extend") && urlbar.hasAttribute("open"));
    new MutationObserver(update).observe(urlbar, { attributes: true, attributeFilter: ["breakout-extend", "open"] });
  }

  // Ctrl+Alt+C (Cmd+Alt+C on macOS) toggles compact mode, as in Zen.
  function setUpShortcuts() {
    window.addEventListener(
      "keydown",
      e => {
        const accel = AppConstants.platform == "macosx" ? e.metaKey : e.ctrlKey;
        if (accel && e.altKey && !e.shiftKey && e.code == "KeyC") {
          e.preventDefault();
          e.stopPropagation();
          window.CutUI.toggleCompact();
        }
      },
      true
    );
  }
})();
