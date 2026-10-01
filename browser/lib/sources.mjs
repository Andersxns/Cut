import path from 'node:path';
import { download, fetchText, parseSums } from './download.mjs';

// Where Cut Browser's ingredients come from. FIREFOX_VERSION, NODE_VERSION and
// TOR_VERSION pin a version; otherwise the newest Firefox release, Node 24 LTS
// and the Tor from the newest Tor Browser release are used.

const MOZ = 'https://archive.mozilla.org/pub/firefox/releases';
const NODE = 'https://nodejs.org/dist';
const TOR = 'https://archive.torproject.org/tor-package-archive/torbrowser';

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
  // Tor's "expert bundle" is published with each Tor Browser release.
  let tor = process.env.TOR_VERSION;
  if (!tor) {
    const release = JSON.parse(await fetchText('https://aus1.torproject.org/torbrowser/update_3/release/download-linux-x86_64.json'));
    tor = release.version;
  }
  return { firefox, node, tor };
}

export async function fetchSources(cache, { firefox, node, tor }, targets) {
  const mozSums = parseSums(await fetchText(`${MOZ}/${firefox}/SHA512SUMS`));
  const nodeSums = parseSums(await fetchText(`${NODE}/v${node}/SHASUMS256.txt`));
  const torSums = parseSums(await fetchText(`${TOR}/${tor}/sha256sums-signed-build.txt`));
  const want = {
    win: [
      { moz: `win64/en-US/Firefox Setup ${firefox}.exe`, file: `firefox-${firefox}-win64.exe` },
      { node: `node-v${node}-win-x64.zip` },
      { tor: `tor-expert-bundle-windows-x86_64-${tor}.tar.gz` },
    ],
    linux: [
      { moz: `linux-x86_64/en-US/firefox-${firefox}.tar.xz`, file: `firefox-${firefox}-linux-x86_64.tar.xz` },
      { node: `node-v${node}-linux-x64.tar.xz` },
      { tor: `tor-expert-bundle-linux-x86_64-${tor}.tar.gz` },
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
      } else if (item.node) {
        const digest = nodeSums.get(item.node);
        if (!digest) throw new Error(`SHASUMS256.txt has no entry for ${item.node}`);
        files[target].node = await download(`${NODE}/v${node}/${item.node}`, path.join(cache, item.node), { algorithm: 'sha256', digest });
      } else {
        const digest = torSums.get(item.tor);
        if (!digest) throw new Error(`Tor's sha256sums-signed-build.txt has no entry for ${item.tor}`);
        files[target].tor = await download(`${TOR}/${tor}/${item.tor}`, path.join(cache, item.tor), { algorithm: 'sha256', digest });
      }
    }
  }
  return files;
}
