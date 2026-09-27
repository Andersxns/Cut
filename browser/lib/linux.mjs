import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as I from './icons.mjs';
import { patchAppData } from './binaries.mjs';
import { patchBrowserOmni } from './omni.mjs';
import { readTarXz, TarWriter, xzWriter } from './tar.mjs';
import { cutSearchFiles } from './cutsearch.mjs';
import { IDENTITY, PRODUCT, appIni, buildStamp } from './product.mjs';

// Builds Cut Browser for Linux (x86-64) from Mozilla's tarball, streaming
// it so file modes and symlinks survive being built on any system:
//   dist/cut-browser_<version>_amd64.deb         Debian, Ubuntu, Mint, Pop!_OS…
//   dist/cut-browser-<version>-linux-x86_64.tar.xz  any distribution (install.sh)

const NAME = PRODUCT.linuxName; // cut-browser
const APP = `/opt/${NAME}`;

// Files from Mozilla's tarball that Cut Browser doesn't ship.
const DROP = new Set([
  'updater',
  'updater.ini',
  'update-settings.ini',
  'precomplete',
  'removed-files',
  'crashreporter',
  'crashreporter.ini',
  'crashhelper',
  'minidump-analyzer',
  'pingsender',
  'distribution/distribution.ini',
  'firefox.sig',
  'firefox-bin.sig',
  'icons/updater.png',
]);

// firefox is a tiny launcher that runs "<its own name>-bin", so renaming the
// pair keeps them working together.
const RENAME = { firefox: NAME, 'firefox-bin': `${NAME}-bin` };

const HICOLOR = [16, 22, 24, 32, 48, 64, 128, 256, 512];

function desktopFile(exec) {
  return `[Desktop Entry]
Version=1.0
Type=Application
Name=Cut Browser
GenericName=Web Browser
Comment=Browse the web privately, with Cut Search built in
Exec=${exec} %u
Icon=${NAME}
Terminal=false
StartupNotify=true
StartupWMClass=${IDENTITY.remotingName}
Categories=Network;WebBrowser;
Keywords=web;browser;internet;private;search;cut;
MimeType=text/html;text/xml;application/xhtml+xml;application/xml;application/pdf;image/svg+xml;image/webp;x-scheme-handler/http;x-scheme-handler/https;
Actions=new-window;new-private-window;

[Desktop Action new-window]
Name=New Window
Exec=${exec} --new-window %u

[Desktop Action new-private-window]
Name=New Private Window
Exec=${exec} --private-window %u
`;
}

const INSTALL_SH = `#!/bin/sh
# Installs Cut Browser from this folder.
#   ./install.sh            for you only (~/.local), no root needed
#   sudo ./install.sh --system   for everyone (/opt/${NAME})
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
if [ "\${1:-}" = "--system" ]; then
  dest="/opt/${NAME}"; bin="/usr/local/bin"; share="/usr/local/share"
else
  dest="\${XDG_DATA_HOME:-$HOME/.local/share}/${NAME}"; bin="$HOME/.local/bin"; share="\${XDG_DATA_HOME:-$HOME/.local/share}"
fi
echo "Installing Cut Browser to $dest"
rm -rf "$dest.new"
mkdir -p "$dest.new" "$bin" "$share/applications"
cp -a "$here/." "$dest.new/"
rm -f "$dest.new/install.sh"
rm -rf "$dest"
mv "$dest.new" "$dest"
ln -sf "$dest/${NAME}" "$bin/${NAME}"
for size in ${HICOLOR.join(' ')}; do
  mkdir -p "$share/icons/hicolor/\${size}x\${size}/apps"
  cp "$dest/icons/${NAME}-\${size}.png" "$share/icons/hicolor/\${size}x\${size}/apps/${NAME}.png"
done
sed "s|${APP}/${NAME}|$dest/${NAME}|g" "$dest/icons/${NAME}.desktop" > "$share/applications/${NAME}.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$share/applications" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$share/icons/hicolor" >/dev/null 2>&1 || true
echo "Done. Start Cut Browser from your applications menu, or run: ${NAME}"
case ":$PATH:" in *":$bin:"*) ;; *) echo "(Add $bin to your PATH to run ${NAME} from a terminal.)";; esac
`;

const UNINSTALL_SH = `#!/bin/sh
# Removes Cut Browser installed with install.sh. Your profile (~/.cut) is kept;
# pass --remove-data to delete it too.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
case "$here" in
  /opt/*) bin="/usr/local/bin"; share="/usr/local/share" ;;
  *) bin="$HOME/.local/bin"; share="\${XDG_DATA_HOME:-$HOME/.local/share}" ;;
esac
rm -f "$bin/${NAME}" "$share/applications/${NAME}.desktop"
for size in ${HICOLOR.join(' ')}; do rm -f "$share/icons/hicolor/\${size}x\${size}/apps/${NAME}.png"; done
if [ "\${1:-}" = "--remove-data" ]; then rm -rf "$HOME/.cut" "\${XDG_CONFIG_HOME:-$HOME/.config}/cut" "$HOME/.cache/cut"; fi
rm -rf "$here"
echo "Cut Browser was removed."
`;

const POSTINST = `#!/bin/sh
set -e
if [ "$1" = "configure" ]; then
  update-alternatives --install /usr/bin/x-www-browser x-www-browser /usr/bin/${NAME} 40
  update-alternatives --install /usr/bin/gnome-www-browser gnome-www-browser /usr/bin/${NAME} 40
fi
exit 0
`;

const PRERM = `#!/bin/sh
set -e
if [ "$1" = "remove" ] || [ "$1" = "deconfigure" ]; then
  update-alternatives --remove x-www-browser /usr/bin/${NAME} || true
  update-alternatives --remove gnome-www-browser /usr/bin/${NAME} || true
fi
exit 0
`;

function copyright(versions) {
  return `Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: Cut Browser

Files: *
Copyright: Mozilla contributors; Cut
License: MPL-2.0
Comment: Cut Browser is built on Mozilla Firefox ${versions.firefox}. Firefox is a
 trademark of the Mozilla Foundation; Cut Browser is not affiliated with
 Mozilla. Firefox's source code: https://github.com/mozilla-firefox/firefox

Files: opt/${NAME}/cut-search/app/*
Copyright: Cut
License: MIT

Files: opt/${NAME}/cut-search/cut-search
Copyright: Node.js contributors
License: MIT and others (see opt/${NAME}/cut-search/NODE-LICENSE.txt)
`;
}

// Collects every file of the app folder, in tar order, as
// { rel, mode, data } or { rel, dir: true } or { rel, symlink }.
async function assembleApp({ firefoxTarball, nodeTarball, repoRoot, appDir, work, buildID }) {
  const files = [];
  const dirs = new Set();
  const addDir = (rel) => {
    if (!dirs.has(rel)) {
      dirs.add(rel);
      files.push({ rel, dir: true });
    }
  };
  let version = null;
  for await (const entry of readTarXz(firefoxTarball)) {
    let rel = entry.name.replace(/^firefox\/?/, '');
    if (!rel || DROP.has(rel)) continue;
    const top = rel.split('/')[0];
    if (RENAME[top]) rel = [RENAME[top], ...rel.split('/').slice(1)].join('/');
    if (entry.type === 'dir') {
      addDir(rel);
      continue;
    }
    if (entry.type === 'symlink') {
      files.push({ rel, symlink: entry.linkname });
      continue;
    }
    let data = entry.data;
    if (rel === `${NAME}-bin`) {
      data = Buffer.from(data);
      ({ version } = patchAppData(data, { ...IDENTITY, buildID }));
    } else if (rel === 'application.ini') {
      data = Buffer.from(appIni(data.toString('utf8'), { buildID }));
    } else if (rel === 'browser/omni.ja') {
      const tmp = path.join(work, 'omni.ja');
      fs.writeFileSync(tmp, data);
      patchBrowserOmni(tmp, { appDir });
      data = fs.readFileSync(tmp);
      fs.rmSync(tmp);
    } else if (/^browser\/chrome\/icons\/default\/default(\d+)\.png$/.test(rel)) {
      data = I.appPng(Number(rel.match(/default(\d+)\.png$/)[1]));
    }
    files.push({ rel, mode: entry.mode || 0o644, data });
  }
  if (!version) throw new Error("Mozilla's tarball didn't contain firefox-bin");

  addDir('distribution');
  files.push({ rel: 'distribution/policies.json', mode: 0o644, data: fs.readFileSync(path.join(appDir, 'policies.json')) });

  // Cut Search: Node's runtime and the server.
  addDir('cut-search');
  for await (const entry of readTarXz(nodeTarball)) {
    const rel = entry.name.split('/').slice(1).join('/');
    if (rel === 'bin/node') files.push({ rel: 'cut-search/cut-search', mode: 0o755, data: entry.data });
    else if (rel === 'LICENSE') files.push({ rel: 'cut-search/NODE-LICENSE.txt', mode: 0o644, data: entry.data });
  }
  for (const { rel, abs } of cutSearchFiles(repoRoot)) {
    const parts = `cut-search/app/${rel}`.split('/');
    for (let i = 2; i < parts.length; i++) addDir(parts.slice(0, i).join('/'));
    files.push({ rel: `cut-search/app/${rel}`, mode: 0o644, data: fs.readFileSync(abs) });
  }

  // Desktop integration files, used by the .deb and by install.sh.
  addDir('icons');
  for (const size of HICOLOR) files.push({ rel: `icons/${NAME}-${size}.png`, mode: 0o644, data: I.appPng(size) });
  files.push({ rel: `icons/${NAME}.svg`, mode: 0o644, data: Buffer.from(I.markSvg()) });
  files.push({ rel: `icons/${NAME}.desktop`, mode: 0o644, data: Buffer.from(desktopFile(`${APP}/${NAME}`)) });
  return { files, version };
}

// ar(1) archive, the container format of .deb files.
function arMember(name, data) {
  const header = Buffer.alloc(60, ' ');
  header.write(name, 0, 'latin1');
  header.write('0', 16, 'latin1');
  header.write('0', 28, 'latin1');
  header.write('0', 34, 'latin1');
  header.write('100644', 40, 'latin1');
  header.write(String(data.length), 48, 'latin1');
  header.write('`\n', 58, 'latin1');
  return Buffer.concat([header, data, data.length % 2 ? Buffer.from('\n') : Buffer.alloc(0)]);
}

async function writeTarXz(file, build) {
  const xz = xzWriter(file);
  const tar = new TarWriter(xz.stream);
  await build(tar);
  await tar.finish();
  await xz.done();
}

export async function buildLinux({ firefoxTarball, nodeTarball, work, repoRoot, appDir, distDir, versions }) {
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const buildID = buildStamp();
  const { files } = await assembleApp({ firefoxTarball, nodeTarball, repoRoot, appDir, work, buildID });
  const outputs = [];

  // 1. Portable archive with install.sh.
  const tarball = path.join(distDir, `${NAME}-${PRODUCT.version}-linux-x86_64.tar.xz`);
  await writeTarXz(tarball, async (tar) => {
    await tar.dir(NAME);
    for (const f of files) {
      const name = `${NAME}/${f.rel}`;
      if (f.dir) await tar.dir(name);
      else if (f.symlink) await tar.symlink(name, f.symlink);
      else await tar.file(name, f.data, f.mode);
    }
    await tar.file(`${NAME}/install.sh`, INSTALL_SH, 0o755);
    await tar.file(`${NAME}/uninstall.sh`, UNINSTALL_SH, 0o755);
  });
  outputs.push(tarball);

  // 2. Debian package.
  const md5 = [];
  let installedBytes = 0;
  const data = path.join(work, 'data.tar.xz');
  await writeTarXz(data, async (tar) => {
    const dirs = ['./opt', `.${APP}`, './usr', './usr/bin', './usr/share', './usr/share/applications', './usr/share/icons', './usr/share/icons/hicolor', './usr/share/doc', `./usr/share/doc/${NAME}`];
    for (const size of HICOLOR) dirs.push(`./usr/share/icons/hicolor/${size}x${size}`, `./usr/share/icons/hicolor/${size}x${size}/apps`);
    dirs.push('./usr/share/icons/hicolor/scalable', './usr/share/icons/hicolor/scalable/apps');
    await tar.dir('.');
    for (const d of dirs) await tar.dir(d);
    const add = async (name, content, mode) => {
      await tar.file(name, content, mode);
      md5.push(`${crypto.createHash('md5').update(content).digest('hex')}  ${name.slice(2)}`);
      installedBytes += content.length;
    };
    for (const f of files) {
      const name = `.${APP}/${f.rel}`;
      if (f.dir) await tar.dir(name);
      else if (f.symlink) await tar.symlink(name, f.symlink);
      else await add(name, f.data, f.mode);
    }
    await tar.symlink(`./usr/bin/${NAME}`, `${APP}/${NAME}`);
    await add(`./usr/share/applications/${NAME}.desktop`, Buffer.from(desktopFile(`/usr/bin/${NAME}`)), 0o644);
    for (const size of HICOLOR) await add(`./usr/share/icons/hicolor/${size}x${size}/apps/${NAME}.png`, I.appPng(size), 0o644);
    await add(`./usr/share/icons/hicolor/scalable/apps/${NAME}.svg`, Buffer.from(I.markSvg()), 0o644);
    await add(`./usr/share/doc/${NAME}/copyright`, Buffer.from(copyright(versions)), 0o644);
  });

  const debVersion = `${PRODUCT.version}+firefox${versions.firefox}`;
  const control = `Package: ${NAME}
Version: ${debVersion}
Architecture: amd64
Maintainer: Cut Browser <cut-browser@localhost>
Installed-Size: ${Math.ceil(installedBytes / 1024)}
Depends: libgtk-3-0t64 | libgtk-3-0, libasound2t64 | libasound2, libx11-xcb1, libdbus-1-3, libc6 (>= 2.28)
Provides: www-browser, gnome-www-browser
Section: web
Priority: optional
Description: Private web browser with Cut Search built in
 Cut Browser is a privacy-focused web browser built on Mozilla Firefox
 ${versions.firefox}. It sends no telemetry, blocks trackers and ads, and
 searches with Cut Search, a metasearch engine that runs on your own
 computer and asks search engines for you, without cookies or tracking.
`;
  const controlTar = path.join(work, 'control.tar.xz');
  await writeTarXz(controlTar, async (tar) => {
    await tar.dir('.');
    await tar.file('./control', control, 0o644);
    await tar.file('./md5sums', md5.join('\n') + '\n', 0o644);
    await tar.file('./postinst', POSTINST, 0o755);
    await tar.file('./prerm', PRERM, 0o755);
  });
  const deb = path.join(distDir, `${NAME}_${debVersion}_amd64.deb`);
  fs.writeFileSync(
    deb,
    Buffer.concat([
      Buffer.from('!<arch>\n'),
      arMember('debian-binary', Buffer.from('2.0\n')),
      arMember('control.tar.xz', fs.readFileSync(controlTar)),
      arMember('data.tar.xz', fs.readFileSync(data)),
    ]),
  );
  outputs.push(deb);
  fs.rmSync(work, { recursive: true, force: true });
  return outputs;
}
