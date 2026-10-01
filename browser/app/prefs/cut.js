/* Cut Browser defaults. They load after Firefox's own, so they win, but
 * they are defaults: anything here can be changed in Settings or
 * about:config, and Firefox's Privacy & Security settings all still apply. */

// ---------- Cut Browser ----------

pref("cut.search.enabled", true); // run the bundled Cut Search
pref("cut.search.port", 28800); // preferred local port
pref("cut.search.remote", ""); // e.g. https://cut.example.org to use your own server instead
pref("cut.ui.compact", false); // hide the sidebar and toolbar until you point at them
pref("cut.ui.floatingUrlbar", true); // open the address bar as a centred palette
pref("cut.ui.accent", "#e0552b");
pref("cut.firstRun.done", false);

// ---------- Tor windows (app/chrome/CutTor.sys.mjs) ----------

pref("cut.tor.enabled", true); // "New Tor window" (Alt+Shift+N)
pref("cut.tor.openOnions", true); // .onion addresses in normal windows open in a Tor window
pref("cut.tor.onionLocation", true); // ".onion" in the address bar when a site has an .onion address
pref("cut.tor.preferOnions", false); // in Tor windows, go to a site's .onion address by itself
pref("cut.tor.bridges", ""); // "" (connect directly), "obfs4", "snowflake", "meek" or "custom"
pref("cut.tor.customBridges", ""); // bridge lines, one per line, for "custom"
pref("cut.tor.instance", false); // true only in the Tor window's own profile

// ---------- Layout: vertical tabs, split view, no clutter ----------

pref("sidebar.revamp", true);
pref("sidebar.verticalTabs", true);
pref("sidebar.visibility", "always-show");
pref("sidebar.position_start", true);
pref("sidebar.main.tools", "history,bookmarks");
pref("sidebar.new-sidebar.has-used", true);
pref("sidebar.verticalTabs.dragToPinPromo.dismissed", true);
pref("browser.tabs.splitView.enabled", true);
pref("browser.tabs.groups.enabled", true);
pref("browser.tabs.firefox-view", false);
pref("browser.toolbars.bookmarks.visibility", "never");
pref("browser.compactmode.show", true);
pref("browser.urlbar.trimHttps", true);
pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);

// ---------- First run and messages ----------

// Mozilla's terms-of-use and data-collection prompts describe Mozilla's
// services, not Cut Browser, which collects nothing.
pref("termsofuse.bypassNotification", true);
pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
pref("browser.preonboarding.enabled", false);
pref("browser.aboutwelcome.enabled", false);
pref("browser.startup.homepage_override.mstone", "ignore");
pref("browser.shell.checkDefaultBrowser", false);
pref("browser.uitour.enabled", false);
pref("browser.messaging-system.whatsNewPanel.enabled", false);
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons", false);
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features", false);
pref("browser.preferences.moreFromMozilla", false);
pref("browser.vpn_promo.enabled", false);
pref("browser.promo.focus.enabled", false);
pref("browser.promo.pin.enabled", false);
pref("browser.privatebrowsing.vpnpromourl", "");
pref("extensions.getAddons.showPane", false);
pref("extensions.htmlaboutaddons.recommendations.enabled", false);
pref("browser.discovery.enabled", false);

// ---------- New tab: Cut search, your shortcuts, nothing sponsored ----------

pref("browser.newtabpage.activity-stream.showSearch", true);
pref("browser.newtabpage.activity-stream.logowordmark.alwaysVisible", true);
pref("browser.newtabpage.activity-stream.feeds.topsites", true);
pref("browser.newtabpage.activity-stream.default.sites", "");
pref("browser.topsites.useRemoteSetting", false);
pref("browser.topsites.contile.enabled", false);
pref("browser.topsites.contile.endpoint", "");
pref("browser.partnerlink.attributionURL", "");
pref("browser.newtabpage.activity-stream.improvesearch.topSiteSearchShortcuts", false);
pref("browser.newtabpage.activity-stream.showSponsored", false);
pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
pref("browser.newtabpage.activity-stream.showSponsoredCheckboxes", false);
pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
pref("browser.newtabpage.activity-stream.feeds.section.highlights", false);
pref("browser.newtabpage.activity-stream.section.highlights.includePocket", false);
pref("browser.newtabpage.activity-stream.feeds.snippets", false);
pref("browser.newtabpage.activity-stream.showWeather", false);
pref("browser.newtabpage.activity-stream.system.showWeather", false);
pref("browser.newtabpage.activity-stream.trendingSearch.enabled", false);
pref("browser.newtabpage.activity-stream.feeds.telemetry", false);
pref("browser.newtabpage.activity-stream.telemetry", false);

// ---------- Address bar: suggestions come from Cut, never from ads ----------

pref("browser.search.suggest.enabled", true);
pref("browser.search.separatePrivateDefault", false);
pref("browser.urlbar.showSearchSuggestionsFirst", true);
pref("browser.urlbar.quicksuggest.enabled", false);
pref("browser.urlbar.quicksuggest.dataCollection.enabled", false);
pref("browser.urlbar.suggest.quicksuggest.sponsored", false);
pref("browser.urlbar.suggest.quicksuggest.nonsponsored", false);
pref("browser.urlbar.sponsoredTopSites", false);
pref("browser.urlbar.trending.featureGate", false);
pref("browser.urlbar.suggest.trending", false);
pref("browser.urlbar.weather.featureGate", false);
pref("browser.urlbar.suggest.weather", false);
pref("browser.urlbar.yelp.featureGate", false);
pref("browser.urlbar.addons.featureGate", false);
pref("browser.urlbar.mdn.featureGate", false);
pref("browser.urlbar.fakespot.featureGate", false);
// No group headings in the results (history and open tabs are headed "Firefox Suggest").
pref("browser.urlbar.groupLabels.enabled", false);

// ---------- No telemetry, studies or experiments ----------

pref("datareporting.healthreport.uploadEnabled", false);
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("datareporting.usage.uploadEnabled", false);
pref("toolkit.telemetry.enabled", false);
pref("toolkit.telemetry.unified", false);
pref("toolkit.telemetry.archive.enabled", false);
pref("toolkit.telemetry.newProfilePing.enabled", false);
pref("toolkit.telemetry.shutdownPingSender.enabled", false);
pref("toolkit.telemetry.updatePing.enabled", false);
pref("toolkit.telemetry.bhrPing.enabled", false);
pref("toolkit.telemetry.firstShutdownPing.enabled", false);
pref("toolkit.telemetry.server", "data:,");
pref("toolkit.telemetry.coverage.opt-out", true);
pref("toolkit.coverage.opt-out", true);
pref("toolkit.coverage.endpoint.base", "");
pref("app.shield.optoutstudies.enabled", false);
pref("app.normandy.enabled", false);
pref("app.normandy.api_url", "");
pref("messaging-system.rsexperimentloader.enabled", false);
pref("browser.tabs.crashReporting.sendReport", false);
pref("breakpad.reportURL", "");
pref("browser.crashReports.unsubmittedCheck.autoSubmit2", false);
pref("dom.private-attribution.submission.enabled", false);

// ---------- AI features off (Settings › AI controls can turn them back on) ----------

pref("browser.ai.control.default", "blocked");
pref("browser.ml.enable", false);
pref("browser.ml.chat.enabled", false);
pref("browser.ml.linkPreview.enabled", false);
pref("browser.ml.pageAssist.enabled", false);
pref("browser.tabs.groups.smart.enabled", false);
pref("browser.tabs.groups.smart.userEnabled", false);
pref("browser.smartwindow.enabled", false);
pref("extensions.ml.enabled", false);

// ---------- Tracking protection and privacy ----------

pref("browser.contentblocking.category", "strict");
pref("privacy.globalprivacycontrol.enabled", true);
pref("privacy.bounceTrackingProtection.mode", 1);
pref("cookiebanners.service.mode", 1);
pref("cookiebanners.service.mode.privateBrowsing", 1);
pref("network.http.referer.XOriginTrimmingPolicy", 2);
pref("dom.security.https_only_mode", true);
pref("dom.security.https_only_mode_send_http_background_request", false);
pref("network.IDN_show_punycode", true);
pref("browser.xul.error_pages.expert_bad_cert", true);
pref("security.ssl.treat_unsafe_negotiation_as_broken", true);

// No guessing ahead: nothing is fetched or resolved until you ask for it.
pref("network.dns.disablePrefetch", true);
pref("network.dns.disablePrefetchFromHTTPS", true);
pref("network.prefetch-next", false);
pref("network.predictor.enabled", false);
pref("network.predictor.enable-prefetch", false);
pref("network.http.speculative-parallel-limit", 0);
pref("browser.urlbar.speculativeConnect.enabled", false);
pref("browser.places.speculativeConnect.enabled", false);

// WebRTC can't reveal your local network address.
pref("media.peerconnection.ice.default_address_only", true);
pref("media.peerconnection.ice.proxy_only_if_behind_proxy", true);

// No background check-ins with Mozilla's servers.
pref("browser.region.network.url", "");
pref("browser.region.update.enabled", false);
pref("network.captive-portal-service.enabled", false);
pref("network.connectivity-service.enabled", false);
pref("browser.safebrowsing.downloads.remote.enabled", false);
pref("browser.safebrowsing.downloads.remote.url", "");
pref("signon.firefoxRelay.feature", "disabled");
pref("signon.management.page.breach-alerts.enabled", false);
pref("browser.contentblocking.report.monitor.enabled", false);
pref("extensions.pocket.enabled", false);
pref("browser.shopping.experience2023.enabled", false);

// ---------- Updates come from new Cut Browser builds ----------

pref("app.update.checkInstallTime", false);
pref("app.update.auto", false);
