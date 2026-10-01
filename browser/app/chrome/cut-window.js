/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Cut Browser: per-window setup, loaded by browser.xhtml.

(() => {
  const { CutBrowser } = ChromeUtils.importESModule("resource://cut/CutBrowser.sys.mjs");
  const { CutTor } = ChromeUtils.importESModule("resource://cut/CutTor.sys.mjs");
  CutBrowser.init();

  const root = document.documentElement;
  // A Tor window (CutTor.sys.mjs) looks different from the start.
  root.toggleAttribute("cut-tor", CutTor.isTorApp);
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

    // In a Tor window every window is a Tor window, so a new one is simply
    // another window here.
    newTorWindow() {
      if (CutTor.isTorApp) {
        OpenBrowserWindow({ private: true });
      } else {
        CutTor.open().catch(console.error);
      }
    },

    newIdentity() {
      if (!CutTor.isTorApp) {
        return;
      }
      const ok = Services.prompt.confirm(
        window,
        "New identity",
        "Close every Tor tab and start again with new Tor circuits? Nothing from these tabs is kept."
      );
      if (ok) {
        CutTor.newIdentity();
      }
    },

    newTorCircuit() {
      if (CutTor.isTorApp) {
        CutTor.newCircuitFor(gBrowser.selectedBrowser);
      }
    },

    // The ".onion" button: the page's .onion address, in a Tor window.
    openOnion() {
      const onion = CutTor.onionFor(gBrowser.selectedBrowser);
      if (!onion) {
        return;
      }
      if (CutTor.isTorApp) {
        openTrustedLinkIn(onion, "current");
      } else {
        CutTor.open(onion).catch(console.error);
      }
    },

    showTorPanel(anchor) {
      const panel = document.getElementById("cut-tor-panel");
      if (panel) {
        panel.openPopup(anchor, { position: "bottomright topright" });
      }
    },
  };

  window.addEventListener(
    "DOMContentLoaded",
    () => {
      setUpLayout();
      setUpCompactMode();
      setUpFloatingUrlbar();
      setUpShortcuts();
      setUpTorCommands();
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
    setUpOnionButton();
    if (CutTor.isTorApp) {
      setUpTorStatus();
    }
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

  // Dims the page while the floating address bar shows results (Firefox
  // marks the address bar popover-open while its results list is showing).
  function setUpFloatingUrlbar() {
    const urlbar = document.getElementById("urlbar");
    if (!urlbar) {
      return;
    }
    const update = () => root.toggleAttribute("cut-urlbar-open", urlbar.hasAttribute("popover-open"));
    new MutationObserver(update).observe(urlbar, { attributes: true, attributeFilter: ["popover-open"] });
  }

  // The menu items and Alt+Shift+N for Tor windows (added to browser.xhtml
  // at build time), and "Open Link in New Tor Window".
  function setUpTorCommands() {
    const torApp = CutTor.isTorApp;
    const available = () => torApp || CutTor.enabled;
    const syncAvailability = () => {
      root.toggleAttribute("cut-tor-unavailable", !available());
      document.getElementById("Cut:NewTorWindow")?.toggleAttribute("disabled", !available());
    };
    syncAvailability();
    Services.prefs.addObserver("cut.tor.enabled", syncAvailability);
    window.addEventListener("unload", () => Services.prefs.removeObserver("cut.tor.enabled", syncAvailability));

    const on = (id, handler) => document.getElementById(id)?.addEventListener("command", handler);
    on("Cut:NewTorWindow", () => window.CutUI.newTorWindow());
    on("Cut:NewIdentity", () => window.CutUI.newIdentity());
    on("Cut:NewTorCircuit", () => window.CutUI.newTorCircuit());

    // The link item follows Firefox's "Open Link in New Private Window".
    const privateItem = document.getElementById("context-openlinkprivate");
    const torItem = document.getElementById("context-openlinkintor");
    if (!privateItem || !torItem) {
      return;
    }
    const link = () => {
      const url = window.gContextMenu?.linkURL || "";
      return /^https?:/i.test(url) ? url : null;
    };
    const sync = () => {
      torItem.hidden = torApp || privateItem.hidden || !CutTor.enabled || !link();
    };
    // Firefox sets up the menu in its own popupshowing listener, which runs
    // before this one; the observer covers the private item changing later.
    document.getElementById("contentAreaContextMenu")?.addEventListener("popupshowing", e => {
      if (e.target.id == "contentAreaContextMenu") {
        sync();
      }
    });
    new MutationObserver(sync).observe(privateItem, { attributes: true, attributeFilter: ["hidden"] });
    torItem.addEventListener("command", () => {
      const url = link();
      if (url) {
        CutTor.open(url).catch(console.error);
      }
    });
  }

  // ".onion" in the address bar when the page has an .onion address.
  function setUpOnionButton() {
    const button = document.getElementById("cut-onion-button");
    if (!button) {
      return;
    }
    const torApp = CutTor.isTorApp;
    button.setAttribute("tooltiptext", torApp ? "Go to this site's .onion address" : "This site has an .onion address. Open it in a Tor window");
    const update = () => {
      button.hidden = !CutTor.onionFor(gBrowser.selectedBrowser);
    };
    gBrowser.addTabsProgressListener({
      onLocationChange(browser, webProgress) {
        if (!webProgress.isTopLevel) {
          return;
        }
        // In a Tor window, a site's .onion address can be used automatically.
        const onion = torApp && Services.prefs.getBoolPref("cut.tor.preferOnions", false) && CutTor.onionFor(browser);
        if (onion) {
          browser.fixupAndLoadURIString(onion, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
          return;
        }
        if (browser == gBrowser.selectedBrowser) {
          update();
        }
      },
    });
    gBrowser.tabContainer.addEventListener("TabSelect", update);
    button.addEventListener("click", e => {
      if (e.button == 0) {
        window.CutUI.openOnion();
      }
    });
    button.addEventListener("keypress", e => {
      if (e.key == "Enter" || e.key == " ") {
        window.CutUI.openOnion();
      }
    });
    update();
  }

  // A Tor window: about:tor as a blank page, and Tor's status in the toolbar
  // button and its panel.
  function setUpTorStatus() {
    if (typeof gInitialPages != "undefined" && !gInitialPages.includes(CutTor.HOME)) {
      gInitialPages.push(CutTor.HOME);
    }
    const panel = MozXULElement.parseXULToFragment(`
      <panel id="cut-tor-panel" type="arrow" orient="vertical" role="dialog" aria-labelledby="cut-tor-panel-title">
        <vbox class="cut-tor-panel-body">
          <html:h2 id="cut-tor-panel-title"></html:h2>
          <html:p id="cut-tor-panel-detail"></html:p>
          <html:div class="cut-tor-progress"><html:div class="cut-tor-progress-bar"></html:div></html:div>
          <hbox class="cut-tor-panel-actions">
            <button id="cut-tor-panel-circuit" label="New circuit for this site"/>
            <button id="cut-tor-panel-identity" label="New identity"/>
          </hbox>
        </vbox>
      </panel>`).firstElementChild;
    document.getElementById("mainPopupSet").appendChild(panel);
    panel.querySelector("#cut-tor-panel-circuit").addEventListener("command", () => {
      panel.hidePopup();
      window.CutUI.newTorCircuit();
    });
    panel.querySelector("#cut-tor-panel-identity").addEventListener("command", () => {
      panel.hidePopup();
      window.CutUI.newIdentity();
    });

    const TITLES = {
      starting: () => "Starting Tor…",
      connecting: s => (s.progress ? `Connecting to Tor… ${s.progress}%` : "Connecting to Tor…"),
      connected: () => "Connected to Tor",
      failed: () => "Couldn't connect to Tor",
    };
    const render = () => {
      const s = CutTor.status;
      const title = (TITLES[s.state] || TITLES.starting)(s);
      root.setAttribute("cut-tor-state", s.state);
      root.style.setProperty("--cut-tor-progress", `${s.state == "connected" ? 100 : s.progress}%`);
      document.getElementById("cut-tor-button")?.setAttribute("tooltiptext", title);
      panel.querySelector("#cut-tor-panel-title").textContent = title;
      panel.querySelector("#cut-tor-panel-detail").textContent =
        s.state == "connected"
          ? "Everything in this window goes through Tor. Each site has a circuit of its own."
          : s.error || (s.warning ? "Tor is having trouble connecting. If Tor is blocked where you are, a bridge can help (Settings › Cut Browser in a normal window)." : s.summary ? `${s.summary}.` : "");
    };
    Services.obs.addObserver(render, CutTor.STATUS_TOPIC);
    window.addEventListener("unload", () => Services.obs.removeObserver(render, CutTor.STATUS_TOPIC));
    render();
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
