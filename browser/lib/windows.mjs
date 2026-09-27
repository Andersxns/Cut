import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as I from './icons.mjs';
import { patchAppData, rebrandExecutable } from './binaries.mjs';
import { patchBrowserOmni } from './omni.mjs';
import { readZip } from './zip.mjs';
import { cutSearchFiles } from './cutsearch.mjs';
import { IDENTITY, PRODUCT, appIni, buildStamp } from './product.mjs';

// Builds the Windows app folder ("Cut Browser") from Mozilla's installer.

const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

// Firefox pieces Cut Browser doesn't ship: Mozilla's updater and
// maintenance service, telemetry senders, the crash reporter, Mozilla's
// installer helpers and extra launchers.
const REMOVE = [
  'updater.exe',
  'updater.ini',
  'update-settings.ini',
  'maintenanceservice.exe',
  'maintenanceservice_installer.exe',
  'precomplete',
  'removed-files',
  'pingsender.exe',
  'default-browser-agent.exe',
  'crashreporter.exe',
  'crashhelper.exe',
  'minidump-analyzer.exe',
  'uninstall',
  'private_browsing.exe',
  'private_browsing.VisualElementsManifest.xml',
  'browser/VisualElements/PrivateBrowsing_150.png',
  'browser/VisualElements/PrivateBrowsing_70.png',
  'desktop-launcher',
  'nmhproxy.exe',
  'firefox.exe.sig',
];

const EXE_STRINGS = {
  ProductName: PRODUCT.name,
  FileDescription: PRODUCT.name,
  CompanyName: PRODUCT.vendor,
  InternalName: 'cut',
  OriginalFilename: 'cut.exe',
  LegalCopyright: 'Cut Browser is built on Mozilla Firefox, available under the MPL 2.0.',
  LegalTrademarks: 'Firefox is a trademark of the Mozilla Foundation. Cut Browser is not affiliated with Mozilla.',
  Comments: 'A private web browser with Cut Search built in.',
};

// Icon groups in firefox.exe: 1 app, 2 document, 3/4 jump-list glyphs (kept),
// 5 private window, 6 PDF, 1100+ alternative app icons, 32512 default.
function iconFor(group, cache) {
  const key = group === 2 ? 'doc' : group === 5 ? 'private' : group === 6 ? 'pdf' : 'app';
  cache[key] ||= key === 'doc' ? I.documentIco() : key === 'pdf' ? I.pdfIco() : key === 'private' ? I.appIco(I.PURPLE) : I.appIco();
  return cache[key];
}

export function extractFirefox(installer, work) {
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  // Mozilla's installer is a 7-Zip archive; Windows' tar reads it directly,
  // so nothing of Mozilla's installer ever runs.
  execFileSync(TAR, ['-xf', installer, '-C', work, 'core'], { stdio: 'inherit' });
  return path.join(work, 'core');
}

export function stageWindows({ firefoxInstaller, nodeZip, work, repoRoot, appDir }) {
  const core = extractFirefox(firefoxInstaller, work);
  const stage = path.join(work, PRODUCT.name);
  fs.renameSync(core, stage);

  for (const rel of REMOVE) fs.rmSync(path.join(stage, rel), { recursive: true, force: true });

  // The executable: Cut's identity, icons and version details.
  const exe = fs.readFileSync(path.join(stage, 'firefox.exe'));
  const { version, buildID } = patchAppData(exe, { ...IDENTITY, buildID: buildStamp() });
  const iconCache = {};
  const rebranded = rebrandExecutable(exe, {
    icons: (group) => (group === 3 || group === 4 ? null : iconFor(group, iconCache)),
    strings: { ...EXE_STRINGS, FileVersion: version, ProductVersion: version },
  });
  fs.writeFileSync(path.join(stage, 'cut.exe'), rebranded);
  fs.rmSync(path.join(stage, 'firefox.exe'));
  fs.writeFileSync(path.join(stage, 'cut.ico'), I.appIco());

  const originalIni = fs.readFileSync(path.join(stage, 'application.ini'), 'utf8');
  fs.writeFileSync(path.join(stage, 'application.ini'), appIni(originalIni, { buildID }));

  // Start-menu tiles.
  fs.rmSync(path.join(stage, 'firefox.VisualElementsManifest.xml'));
  fs.writeFileSync(
    path.join(stage, 'cut.VisualElementsManifest.xml'),
    `<Application xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance'>
  <VisualElements
      ShowNameOnSquare150x150Logo='on'
      Square150x150Logo='browser\\VisualElements\\VisualElements_150.png'
      Square70x70Logo='browser\\VisualElements\\VisualElements_70.png'
      ForegroundText='light'
      BackgroundColor='#17161c'/>
</Application>
`,
  );
  fs.writeFileSync(path.join(stage, 'browser', 'VisualElements', 'VisualElements_150.png'), I.centredPng(300, 300, 150));
  fs.writeFileSync(path.join(stage, 'browser', 'VisualElements', 'VisualElements_70.png'), I.centredPng(142, 142, 84));

  // The interface, branding and default prefs. A pristine copy of Mozilla's
  // archive is kept so the interface can be re-applied quickly.
  const omni = path.join(stage, 'browser', 'omni.ja');
  fs.copyFileSync(omni, path.join(work, 'browser-omni.orig.ja'));
  patchBrowserOmni(omni, { appDir });

  fs.mkdirSync(path.join(stage, 'distribution'), { recursive: true });
  fs.copyFileSync(path.join(appDir, 'policies.json'), path.join(stage, 'distribution', 'policies.json'));

  stageCutSearch(stage, { nodeZip, repoRoot });
  return { stage, version, buildID };
}

// Cut Search: Node's runtime plus the server. The runtime is only renamed,
// not modified, so it keeps the OpenJS Foundation's signature (an unsigned
// copy is scanned far more slowly by antivirus software on every start).
function stageCutSearch(stage, { nodeZip, repoRoot }) {
  const dir = path.join(stage, 'cut-search');
  fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
  const zip = readZip(nodeZip);
  const top = [...zip.keys()][0].split('/')[0];
  fs.writeFileSync(path.join(dir, 'cut-search.exe'), zip.get(`${top}/node.exe`).data);
  fs.writeFileSync(path.join(dir, 'NODE-LICENSE.txt'), zip.get(`${top}/LICENSE`).data);
  copyCutSearchApp(dir, repoRoot);
}

function copyCutSearchApp(dir, repoRoot) {
  fs.rmSync(path.join(dir, 'app'), { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  for (const { rel, abs } of cutSearchFiles(repoRoot)) {
    const dest = path.join(dir, 'app', ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
  }
}

// Re-applies the interface (from the pristine archive) and Cut Search's
// files to a staged build; used while developing.
export function reapplyInterface(work, appDir, repoRoot) {
  const stage = path.join(work, PRODUCT.name);
  const omni = path.join(stage, 'browser', 'omni.ja');
  // A browser that has just exited can hold its files for a moment.
  for (let attempt = 1; ; attempt++) {
    try {
      fs.copyFileSync(path.join(work, 'browser-omni.orig.ja'), omni);
      break;
    } catch (e) {
      if (attempt >= 20) throw new Error(`${omni} is in use; is Cut Browser still running? (${e.code})`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  patchBrowserOmni(omni, { appDir });
  fs.copyFileSync(path.join(appDir, 'policies.json'), path.join(stage, 'distribution', 'policies.json'));
  copyCutSearchApp(path.join(stage, 'cut-search'), repoRoot);
  return stage;
}
