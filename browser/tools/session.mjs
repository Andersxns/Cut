// Drives a test instance of the staged Windows build.
//
//   node tools/session.mjs start [--headed] [--fresh] [--size 1400x900]
//   node tools/session.mjs eval "return Services.appinfo.name"
//   node tools/session.mjs shot out.png [--content]
//   node tools/session.mjs open https://example.com
//   node tools/session.mjs stop

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Marionette } from './marionette.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const exe = process.env.CUT_EXE || path.join(root, '.build', 'win', 'Cut Browser', 'cut.exe');
const profile = path.join(root, '.build', 'test-profile');
const PORT = 2829;
const pidFile = path.join(root, '.build', 'test-session.pid');

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

// The test browser's main process, found by the test profile on its command
// line. Only this instance (and its own child processes) is ever stopped, so
// a Cut Browser you have open yourself is left alone.
function testBrowserPids() {
  const script = `Get-CimInstance Win32_Process -Filter "Name = 'cut.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${profile.replace(/'/g, "''")}') -and -not $_.CommandLine.Contains('-contentproc') } | ForEach-Object { $_.ProcessId }`;
  const out = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).stdout || '';
  return out.split(/\s+/).filter(Boolean).map(Number);
}

const [command, ...rest] = process.argv.slice(2);
const has = (f) => rest.includes(f);
const opt = (f, d) => (rest.includes(f) ? rest[rest.indexOf(f) + 1] : d);

async function withSession(fn, context = 'chrome') {
  const m = await Marionette.connect(PORT, { timeout: 60000 });
  try {
    await m.session();
    await m.context(context);
    return await fn(m);
  } finally {
    try {
      await m.send('WebDriver:DeleteSession');
    } catch {}
    m.close();
  }
}

if (command === 'start') {
  if (has('--fresh')) fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(
    path.join(profile, 'user.js'),
    [`user_pref("marionette.port", ${PORT});`, 'user_pref("browser.sessionstore.resume_from_crash", false);', 'user_pref("remote.prefs.recommended", false);'].join('\n') + '\n',
  );
  const args = ['-profile', profile, '-no-remote', '-purgecaches', '--marionette', '--remote-allow-system-access'];
  if (!has('--headed')) args.push('--headless');
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  fs.writeFileSync(pidFile, String(child.pid));
  const [w, h] = opt('--size', '1400x900').split('x').map(Number);
  await withSession(async (m) => {
    // Right after startup the window may not be ready for commands yet.
    for (let attempt = 1; ; attempt++) {
      try {
        await m.send('WebDriver:SetWindowRect', { width: w, height: h });
        const info = await m.execute('return { name: Services.appinfo.name, vendor: Services.appinfo.vendor, version: Services.appinfo.version, profile: Services.dirsvc.get("ProfD", Ci.nsIFile).path, userData: Services.dirsvc.get("DefProfRt", Ci.nsIFile).path }');
        console.log(JSON.stringify({ pid: child.pid, ...info }, null, 2));
        return;
      } catch (e) {
        if (attempt >= 10) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  });
} else if (command === 'eval') {
  const result = await withSession((m) => m.execute(rest[0]), has('--content') ? 'content' : 'chrome');
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
} else if (command === 'shot') {
  const file = rest[0] || 'shot.png';
  const png = await withSession((m) => m.screenshot(), has('--content') ? 'content' : 'chrome');
  fs.writeFileSync(file, png);
  console.log(`${file} (${png.length} bytes)`);
} else if (command === 'open') {
  await withSession((m) => m.send('WebDriver:Navigate', { url: rest[0] }), 'content');
  console.log('ok');
} else if (command === 'stop') {
  try {
    const m = await Marionette.connect(PORT, { timeout: 5000 });
    await m.session().catch(() => {});
    await m.quit();
  } catch {}
  // Wait for the test browser to exit, and force only its own process tree
  // (content processes and its Cut Search server) if it hangs. The PID we
  // started is Firefox's launcher, which hands over to a new main process,
  // so the main process is found by its test-profile command line.
  const deadline = Date.now() + 10000;
  let pids = testBrowserPids();
  while (pids.some(alive) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    pids = pids.filter(alive);
  }
  for (const pid of pids.filter(alive)) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  fs.rmSync(pidFile, { force: true });
  await new Promise((r) => setTimeout(r, 500));
  console.log('stopped');
} else {
  console.log('usage: start | eval <js> | shot <file> | open <url> | stop');
}
