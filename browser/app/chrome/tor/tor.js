/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// about:tor: Tor's status, and a search box for the Tor window's Cut Search.

const { CutTor } = ChromeUtils.importESModule("resource://cut/CutTor.sys.mjs");
const { CutSearch } = ChromeUtils.importESModule("resource://cut/CutBrowser.sys.mjs");

const TITLES = {
  starting: () => "Starting Tor…",
  connecting: s => (s.progress ? `Connecting to Tor… ${s.progress}%` : "Connecting to Tor…"),
  connected: () => "Connected to Tor",
  failed: () => "Couldn't connect to Tor",
};

function detail(s) {
  if (s.state == "failed") {
    return `${s.error} If Tor is blocked where you are, a bridge can help.`;
  }
  if (s.warning) {
    return "Tor is having trouble connecting. If Tor is blocked where you are, a bridge can help.";
  }
  return s.state == "connecting" && s.summary ? `${s.summary}.` : "";
}

function render() {
  const s = CutTor.status;
  document.getElementById("status").dataset.state = s.state;
  document.getElementById("status-text").textContent = (TITLES[s.state] || TITLES.starting)(s);
  document.body.style.setProperty("--progress", `${s.state == "connected" ? 100 : s.progress}%`);
  document.getElementById("status-detail").textContent = detail(s);
  document.getElementById("status-actions").hidden = !(s.state == "failed" || s.warning);
}

document.addEventListener("DOMContentLoaded", () => {
  Services.obs.addObserver(render, CutTor.STATUS_TOPIC);
  window.addEventListener("unload", () => Services.obs.removeObserver(render, CutTor.STATUS_TOPIC));
  render();

  document.getElementById("retry").addEventListener("click", () => CutTor.startTor());
  document.getElementById("bridges").addEventListener("click", () => CutTor.openSettings());

  document.getElementById("search").addEventListener("submit", async event => {
    event.preventDefault();
    const query = document.getElementById("q").value.trim();
    const base = query && (await CutSearch.whenReady());
    if (base) {
      location.href = `${base}/search?q=${encodeURIComponent(query)}`;
    }
  });
});
