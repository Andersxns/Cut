import path from 'node:path';
import { download, fetchText, parseSums } from './download.mjs';

// Where Cut Browser's ingredients come from. FIREFOX_VERSION / NODE_VERSION
// pin a version; otherwise the newest Firefox release and Node 24 LTS are used.

const MOZ = 'https://archive.mozilla.org/pub/firefox/releases';
const NODE = 'https://nodejs.org/dist';

export async function resolveVersions() {
  let firefox = process.env.FIREFOX_VERSION;
  if (!firefox) {
    const versions = JSON.parse(await fetchText('https://product-details.mozilla.org/1.0/firefox_versions.json'));
    firefox = versions.LATEST_FIREFOX_VERSION;
  }
  let node = process.env.NODE_VERSION;
  if (!node) {
    const index = JSON.parse(await fetchText(`${NODE}/index.json`));
    node = index.find((v) => v.version.startsWith('v24.') && v.lts).version.slice(1);
  }
  return { firefox, node };
}

export async function fetchSources(cache, { firefox, node }, targets) {
  const mozSums = parseSums(await fetchText(`${MOZ}/${firefox}/SHA512SUMS`));
  const nodeSums = parseSums(await fetchText(`${NODE}/v${node}/SHASUMS256.txt`));
  const want = {
    win: [
      { moz: `win64/en-US/Firefox Setup ${firefox}.exe`, file: `firefox-${firefox}-win64.exe` },
      { node: `node-v${node}-win-x64.zip` },
    ],
    linux: [
      { moz: `linux-x86_64/en-US/firefox-${firefox}.tar.xz`, file: `firefox-${firefox}-linux-x86_64.tar.xz` },
      { node: `node-v${node}-linux-x64.tar.xz` },
    ],
  };
  const files = {};
  for (const target of targets) {
    files[target] = {};
    for (const item of want[target]) {
      if (item.moz) {
        const digest = mozSums.get(item.moz);
        if (!digest) throw new Error(`SHA512SUMS has no entry for ${item.moz}`);
        const url = `${MOZ}/${firefox}/${item.moz.split('/').map(encodeURIComponent).join('/')}`;
        files[target].firefox = await download(url, path.join(cache, item.file), { algorithm: 'sha512', digest });
      } else {
        const digest = nodeSums.get(item.node);
        if (!digest) throw new Error(`SHASUMS256.txt has no entry for ${item.node}`);
        files[target].node = await download(`${NODE}/v${node}/${item.node}`, path.join(cache, item.node), { algorithm: 'sha256', digest });
      }
    }
  }
  return files;
}
