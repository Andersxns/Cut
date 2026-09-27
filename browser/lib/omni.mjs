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
// by new Cut Browser builds rather than by Mozilla.
function aboutDialogStrings(text) {
  const name = 'aboutDialog.ftl';
  text = replaceFluent(text, 'aboutDialog-version', `aboutDialog-version = Cut Browser ${PRODUCT.version} · Firefox { $version } ({ $bits }-bit)`, name);
  text = replaceFluent(text, 'aboutdialog-version-arch', `aboutdialog-version-arch = Cut Browser ${PRODUCT.version} · Firefox { $version } ({ $arch })`, name);
  text = replaceFluent(text, 'update-policy-disabled', 'update-policy-disabled = Security fixes arrive with new Cut Browser builds.', name);
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
  put('defaults/preferences/cut.js', fs.readFileSync(path.join(appDir, 'prefs', 'cut.js')));

  const chromeDir = path.join(appDir, 'chrome');
  for (const rel of walk(chromeDir)) put(CUT_CHROME + rel, fs.readFileSync(path.join(chromeDir, rel)));

  // resource://cut/ serves the same folder, for Cut's modules and pages.
  edit('chrome/chrome.manifest', (t) => `${t.trimEnd()}\nresource cut browser/content/browser/cut/\n`);

  edit('chrome/browser/content/browser/browser.xhtml', (t) =>
    insertBefore(
      t,
      '</head>',
      '<link rel="stylesheet" href="chrome://browser/content/cut/cut.css" />\n<script src="chrome://browser/content/cut/cut-window.js"></script>\n',
      'browser.xhtml',
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
