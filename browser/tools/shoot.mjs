// Runs a script in the browser window, then snapshots it within the same
// command (so focus-dependent UI stays open).  Usage:
//   node tools/shoot.mjs out.png "script body"
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [out, body = ''] = process.argv.slice(2);
const snap = fs.readFileSync(path.join(here, 'snap.js'), 'utf8');
const script = `${snap}\n${body}\nawait new Promise(r => setTimeout(r, 400));\nreturn JSON.stringify({ shot: await cutSnapshot() });`;
const r = spawnSync(process.execPath, [path.join(here, 'session.mjs'), 'eval', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(1);
}
const { shot } = JSON.parse(r.stdout);
fs.writeFileSync(out, Buffer.from(shot.split(',')[1], 'base64'));
console.log(out);
