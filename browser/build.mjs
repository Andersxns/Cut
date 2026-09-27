// Builds Cut Browser.
//
//   node build.mjs                    Windows and Linux packages
//   node build.mjs --target win       Windows only (or: linux)
//   node build.mjs --stage-only       stop after assembling the app folder
//   node build.mjs --interface-only   re-apply the interface to a staged build
//   node build.mjs --fetch-only       just download (and verify) the sources
//
// FIREFOX_VERSION / NODE_VERSION pin versions; by default the newest Firefox
// release and Node 24 LTS are used, so rebuilding picks up security fixes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVersions, fetchSources } from './lib/sources.mjs';
import { PRODUCT } from './lib/product.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const appDir = path.join(here, 'app');
const cache = path.join(here, '.cache');
// CUT_BUILD_DIR builds somewhere else, e.g. while a staged copy is running.
const buildDir = process.env.CUT_BUILD_DIR ? path.resolve(process.env.CUT_BUILD_DIR) : path.join(here, '.build');
const distDir = path.join(here, 'dist');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const targets = option('--target', 'win,linux').split(',');

const started = Date.now();
const step = (message) => console.log(`\n▸ ${message}`);

if (flag('--interface-only')) {
  const { reapplyInterface } = await import('./lib/windows.mjs');
  step('Re-applying the interface to the Windows build');
  console.log(`  ${reapplyInterface(path.join(buildDir, 'win'), appDir, repoRoot)}`);
  process.exit(0);
}

const versions = await resolveVersions();
console.log(`${PRODUCT.name} ${PRODUCT.version} on Firefox ${versions.firefox}, Cut Search on Node ${versions.node}`);

step('Fetching sources');
const sources = await fetchSources(cache, versions, targets);
if (flag('--fetch-only')) process.exit(0);
fs.mkdirSync(distDir, { recursive: true });

if (targets.includes('win')) {
  const { stageWindows } = await import('./lib/windows.mjs');
  step('Assembling Cut Browser for Windows');
  const work = path.join(buildDir, 'win');
  const { stage } = stageWindows({ firefoxInstaller: sources.win.firefox, nodeZip: sources.win.node, work, repoRoot, appDir });
  console.log(`  ${stage}`);
  if (!flag('--stage-only')) {
    const { buildWindowsInstaller } = await import('./lib/installer-win.mjs');
    step('Building the Windows installer');
    const out = await buildWindowsInstaller({ stage, work, distDir, versions, here });
    console.log(`  ${out}`);
  }
}

if (targets.includes('linux')) {
  const { buildLinux } = await import('./lib/linux.mjs');
  step('Building Cut Browser for Linux');
  for (const out of await buildLinux({ firefoxTarball: sources.linux.firefox, nodeTarball: sources.linux.node, work: path.join(buildDir, 'linux'), repoRoot, appDir, distDir, versions })) console.log(`  ${out}`);
}

console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)} s.`);
