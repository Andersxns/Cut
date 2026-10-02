import fs from 'node:fs';
import path from 'node:path';
import { readZip, writeZip, ZipEntry } from './zip.mjs';
import { brandingFiles } from './branding.mjs';
import { PRODUCT } from './product.mjs';

// Applies Cut Browser to Firefox's browser/omni.ja: branding, default
// prefs, and the chrome files that make up Cut's interface.

const CUT_CHROME = 'chrome/browser/content/browser/cut/';

function* walk(dir, prefix = '') {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) yield* walk(path.join(dir, item.name), rel);
    else yield rel;
  }
}

// Replaces one message (and its indented attribute lines) in a Fluent file.
function replaceFluent(text, id, definition, name) {
  const pattern = new RegExp(`^${id} =.*(?:\\n[ \\t]+.*)*`, 'm');
  if (!pattern.test(text)) throw new Error(`${name}: couldn't find the "${id}" string`);
  return text.replace(pattern, definition);
}

// The About dialog, told the truth: Cut Browser, built on Firefox, updated
// by Cut Browser itself rather than by Mozilla.
function aboutDialogStrings(text) {
  const name = 'aboutDialog.ftl';
  text = replaceFluent(text, 'aboutDialog-version', `aboutDialog-version = Cut Browser ${PRODUCT.version} · Firefox { $version } ({ $bits }-bit)`, name);
  text = replaceFluent(text, 'aboutdialog-version-arch', `aboutdialog-version-arch = Cut Browser ${PRODUCT.version} · Firefox { $version } ({ $arch })`, name);
  text = replaceFluent(text, 'update-policy-disabled', 'update-policy-disabled = Cut Browser updates itself: see Settings › Cut Browser.', name);
  text = replaceFluent(
    text,
    'community-2',
    'community-2 = { -brand-short-name } is a private web browser with Cut Search built in. It is built on <label data-l10n-name="community-mozillaLink">Mozilla Firefox</label>, made by a <label data-l10n-name="community-creditsLink">global community</label>.',
    name,
  );
  return text;
}

// Inserts `addition` before `marker`, failing loudly if Firefox changed the
// file so the marker is gone (better a failed build than a silently
// unbranded one).
function insertBefore(text, marker, addition, name) {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`${name}: couldn't find ${JSON.stringify(marker)}`);
  return text.slice(0, at) + addition + text.slice(at);
}

// Inserts `addition` after the element that starts with `marker` (an empty
// element, <tag … />).
function insertAfterElement(text, marker, addition, name) {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`${name}: couldn't find ${JSON.stringify(marker)}`);
  const end = text.indexOf('/>', at);
  if (end < 0 || text.slice(at, end).includes('>')) throw new Error(`${name}: ${JSON.stringify(marker)} isn't an empty element`);
  return text.slice(0, end + 2) + addition + text.slice(end + 2);
}

// Tor windows: the menu items, Alt+Shift+N, the link menu item and the
// ".onion" button in the address bar. cut-window.js makes them work.
// Items marked cut-tor-item are for opening Tor windows; cut-tor-only ones
// appear only in Tor windows.
function torWindowMarkup(t) {
  const name = 'browser.xhtml';
  t = insertBefore(t, '<command id="Tools:PrivateBrowsing"', '<command id="Cut:NewTorWindow"/>\n<command id="Cut:NewIdentity"/>\n<command id="Cut:NewTorCircuit"/>\n', name);
  t = insertBefore(t, '<key id="key_privatebrowsing"', '<key id="key_cutTorWindow" key="N" modifiers="alt,shift" command="Cut:NewTorWindow"/>\n', name);
  t = insertAfterElement(
    t,
    '<toolbarbutton id="appMenu-new-private-window-button2"',
    '\n<toolbarbutton id="appMenu-new-tor-window-button" class="subviewbutton cut-tor-item" label="New Tor window" key="key_cutTorWindow" command="Cut:NewTorWindow"/>' +
      '\n<toolbarbutton id="appMenu-cut-new-circuit" class="subviewbutton cut-tor-only" label="New Tor circuit for this site" command="Cut:NewTorCircuit"/>' +
      '\n<toolbarbutton id="appMenu-cut-new-identity" class="subviewbutton cut-tor-only" label="New identity" command="Cut:NewIdentity"/>',
    name,
  );
  t = insertAfterElement(t, '<menuitem id="menu_newPrivateWindow"', '\n<menuitem id="menu_newTorWindow" class="cut-tor-item" label="New Tor Window" accesskey="r" key="key_cutTorWindow" command="Cut:NewTorWindow"/>', name);
  t = insertAfterElement(t, '<menuitem id="context-openlinkprivate"', '\n<menuitem id="context-openlinkintor" class="context-menu-open-link cut-tor-item" label="Open Link in New Tor Window" accesskey="r" hidden="true"/>', name);
  t = insertBefore(
    t,
    '<hbox id="star-button-box"',
    '<hbox id="cut-onion-button" class="urlbar-page-action" role="button" hidden="true"><image class="urlbar-icon"/><label class="cut-onion-label" value=".onion"/></hbox>\n',
    name,
  );
  return t;
}

export function patchBrowserOmni(file, { appDir }) {
  const entries = readZip(file);
  const put = (name, data) => {
    let entry = entries.get(name);
    if (!entry) entries.set(name, (entry = new ZipEntry(name)));
    entry.set(data);
  };
  const edit = (name, fn) => {
    const entry = entries.get(name);
    if (!entry) throw new Error(`${name} is missing from browser/omni.ja`);
    entry.set(fn(entry.text));
  };

  for (const [name, data] of Object.entries(brandingFiles())) {
    if (!entries.has(name) && !name.startsWith('chrome/browser/content/branding/')) throw new Error(`${name} is missing from browser/omni.ja`);
    put(name, data);
  }
  // Cut Browser's own version, which the updater compares with new releases.
  put('defaults/preferences/cut.js', `${fs.readFileSync(path.join(appDir, 'prefs', 'cut.js'), 'utf8').trimEnd()}\n\npref("cut.version", "${PRODUCT.version}");\n`);

  const chromeDir = path.join(appDir, 'chrome');
  for (const rel of walk(chromeDir)) put(CUT_CHROME + rel, fs.readFileSync(path.join(chromeDir, rel)));

  // resource://cut/ serves the same folder, for Cut's modules and pages.
  edit('chrome/chrome.manifest', (t) => `${t.trimEnd()}\nresource cut browser/content/browser/cut/\n`);

  edit('chrome/browser/content/browser/browser.xhtml', (t) =>
    torWindowMarkup(
      insertBefore(
        t,
        '</head>',
        '<link rel="stylesheet" href="chrome://browser/content/cut/cut.css" />\n<script src="chrome://browser/content/cut/cut-window.js"></script>\n',
        'browser.xhtml',
      ),
    ),
  );

  edit('localization/en-US/browser/aboutDialog.ftl', aboutDialogStrings);

  // Settings: a "Cut Browser" pane, first in the list.
  const PREFS = 'chrome/browser/content/browser/preferences/preferences.xhtml';
  const pane = fs.readFileSync(path.join(appDir, 'preferences', 'pane.xhtml'), 'utf8').replace(/^<!--[\s\S]*?-->\s*/, '');
  edit(PREFS, (t) => {
    t = insertBefore(
      t,
      '<html:moz-page-nav-button id="category-general"',
      '<html:moz-page-nav-button id="category-cut" view="paneCut" iconsrc="chrome://browser/content/cut/icons/mark.svg">Cut Browser</html:moz-page-nav-button>\n      ',
      'preferences.xhtml',
    );
    t = insertBefore(t, '<html:template id="template-paneGeneral">', `${pane}\n`, 'preferences.xhtml');
    return insertBefore(t, '<script src="chrome://browser/content/preferences/extensionControlled.js"/>', '<script src="chrome://browser/content/cut/cut-prefs.js"/>\n', 'preferences.xhtml');
  });

  writeZip(file, entries);
  return entries.size;
}
