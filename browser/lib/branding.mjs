import * as I from './icons.mjs';

// Everything in browser/omni.ja that names or pictures Firefox, replaced
// with Cut Browser's own. Mozilla's trademark policy asks that modified
// builds not use Firefox's name or logo; "based on Firefox" is fine.

const BRAND_FTL = `# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

-brand-shorter-name = Cut
-brand-short-name = Cut Browser
-brand-shortcut-name = Cut Browser
-brand-full-name = Cut Browser
-brand-product-name = Cut Browser
-vendor-short-name = Cut
trademarkInfo = Cut Browser is built on Mozilla Firefox. Firefox is a trademark of the Mozilla Foundation; Cut Browser is not affiliated with or endorsed by Mozilla.
`;

const BRAND_PROPERTIES = `# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

brandShorterName=Cut
brandShortName=Cut Browser
brandFullName=Cut Browser
vendorShortName=Cut
`;

// Replaces firefox-branding.js: no Mozilla update, release-notes or
// welcome pages.
const BRANDING_PREFS = `/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

pref("startup.homepage_override_url", "");
pref("startup.homepage_welcome_url", "");
pref("startup.homepage_welcome_url.additional", "");
pref("app.update.interval", 86400);
pref("app.update.promptWaitTime", 691200);
pref("app.update.url.manual", "");
pref("app.update.url.details", "");
pref("app.releaseNotesURL", "");
pref("app.releaseNotesURL.aboutDialog", "");
pref("app.releaseNotesURL.prompt", "");
pref("app.update.checkInstallTime.days", 63);
pref("app.update.badgeWaitTime", 345600);
pref("devtools.selfxss.count", 0);
`;

const ABOUT_DIALOG_CSS = `/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#aboutDialogContainer {
  background-color: #17161c;
  color: #f4f3f6;
  color-scheme: dark;
}

#bottomBox {
  background-color: #111015;
}

#trademark {
  color: #8f8d98;
}

#rightBox {
  background-image: url("chrome://branding/content/about-wordmark.svg");
  background-repeat: no-repeat;
  background-size: auto 44px;
  -moz-context-properties: fill;
  fill: #f4f3f6;
  margin-inline: 30px;
  padding-top: 76px;
}

#bottomBox {
  padding: 15px 10px;
}

#trademark {
  font-size: xx-small;
  text-align: center;
  margin-block: 10px;
}

/* Mozilla's help, feedback, donation, release-note, terms and privacy links
 * are about Firefox and Mozilla's services, not Cut Browser. */
#releasenotes,
#aboutDialogHelpLink,
#submit-feedback,
#contributeDesc,
#contributeDescReferrals,
#currentChannelText,
[data-l10n-id="bottom-links-terms"],
[data-l10n-id="bottom-links-privacy"] {
  display: none !important;
}

#updateIcon {
  display: none;
}
`;

// A PDF page in the 256-unit box of Firefox's document_pdf.svg.
const PDF_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <path d="M58 14h96l58 58v156a14 14 0 0 1-14 14H58a14 14 0 0 1-14-14V28a14 14 0 0 1 14-14z" fill="#fff" stroke="#c9c9d1" stroke-width="4"/>
  <path d="M154 14v58h58z" fill="#dcdce2"/>
  <g transform="translate(92 58) scale(1.5)" fill="#e0552b" stroke="#e0552b" stroke-width="6.4" stroke-linejoin="round">
    <path d="M34.238 6.836A17.8 17.8 0 0 0 10.036 31.038Z"/>
    <path d="M39.564 15.362A17.8 17.8 0 0 1 15.362 39.564Z"/>
  </g>
  <rect x="44" y="150" width="168" height="76" rx="6" fill="#d92d20"/>
  <text x="128" y="211" text-anchor="middle" fill="#fff" font-family="'Segoe UI', Arial, sans-serif" font-size="54" font-weight="700">PDF</text>
</svg>
`;

export function brandingFiles() {
  const B = 'chrome/browser/content/branding/';
  const files = {
    'localization/en-US/branding/brand.ftl': BRAND_FTL,
    'chrome/en-US/locale/branding/brand.properties': BRAND_PROPERTIES,
    'defaults/preferences/firefox-branding.js': BRANDING_PREFS,
    [`${B}aboutDialog.css`]: ABOUT_DIALOG_CSS,
    [`${B}about-logo.svg`]: I.markSvg(),
    [`${B}about-wordmark.svg`]: I.wordmarkSvg(),
    [`${B}firefox-wordmark.svg`]: I.wordmarkSvg('context-fill #17161c'),
    [`${B}document_pdf.svg`]: PDF_SVG,
    [`${B}document.ico`]: I.documentIco(),
    [`${B}about.png`]: I.centredPng(300, 236, 180),
    [`${B}about-logo.png`]: I.appPng(192),
    [`${B}about-logo@2x.png`]: I.appPng(384),
    [`${B}about-logo-private.png`]: I.appPng(192, I.PURPLE),
    [`${B}about-logo-private@2x.png`]: I.appPng(384, I.PURPLE),
  };
  for (const size of [16, 32, 48, 64, 128]) files[`${B}icon${size}.png`] = I.appPng(size);
  return files;
}
