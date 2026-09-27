import { fetchUpstream } from '../http.js';

// Dangerous and deceptive site protection. Cut downloads public blocklists and
// checks result links against them locally — your searches are never sent
// anywhere to be checked.

const FEEDS = [
  {
    id: 'urlhaus',
    name: 'URLhaus (abuse.ch)',
    kind: 'malware',
    url: 'https://urlhaus.abuse.ch/downloads/hostfile/',
    parse: (text) => text.split('\n').map((line) => (line.match(/^127\.0\.0\.1\s+(\S+)/) || [])[1]).filter(Boolean),
  },
  {
    id: 'phishing-army',
    name: 'Phishing Army',
    kind: 'phishing',
    url: 'https://phishing.army/download/phishing_army_blocklist.txt',
    parse: (text) => text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#')),
  },
  {
    id: 'openphish',
    name: 'OpenPhish',
    kind: 'phishing',
    url: 'https://openphish.com/feed.txt',
    parse: (text) =>
      text
        .split('\n')
        .map((line) => {
          try {
            return new URL(line.trim()).hostname;
          } catch {
            return '';
          }
        })
        .filter(Boolean),
  },
];

const REFRESH = 12 * 3600_000;
let hosts = new Map();
let updated = 0;
let loading = null;
let lastError = '';

async function refresh() {
  const next = new Map();
  let ok = 0;
  await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const text = await fetchUpstream(feed.url, { timeout: 30_000, headers: { Accept: 'text/plain' } });
        for (const host of feed.parse(text)) next.set(host.toLowerCase().replace(/^www\./, ''), feed.kind);
        ok++;
      } catch (err) {
        lastError = `${feed.name}: ${err.message}`;
      }
    }),
  );
  if (ok) {
    hosts = next;
    updated = Date.now();
    lastError = ok === FEEDS.length ? '' : lastError;
  }
}

// Starts a background refresh when the lists are missing or stale.
export function ensureThreatLists() {
  if (!loading && Date.now() - updated > REFRESH) {
    loading = refresh().finally(() => (loading = null));
  }
  return loading;
}

// 'malware' | 'phishing' | null for a host name (checks parent domains too).
export function threatFor(hostname) {
  if (!hosts.size || !hostname) return null;
  const parts = hostname.toLowerCase().replace(/^www\./, '').split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const kind = hosts.get(parts.slice(i).join('.'));
    if (kind) return kind;
  }
  return null;
}

export const threatListStatus = () => ({ count: hosts.size, updated, loading: Boolean(loading), error: lastError, feeds: FEEDS.map((f) => f.name) });

// ---------- Dangerous downloads (torrents) ----------

const EXECUTABLE = /\.(exe|scr|com|bat|cmd|pif|vbs|vbe|jse?|wsf|wsh|msi|lnk|hta|cpl|ps1|reg|apk)$/i;
const DISGUISED = /\.(mp4|mkv|avi|mov|wmv|m4v|mp3|flac|wav|pdf|epub|jpe?g|png|docx?|txt|srt)\s*\.(exe|scr|com|bat|cmd|pif|vbs|js|lnk|msi|hta)$/i;
const SCAM = /\b(codec (pack )?required|password (in|protected)|click (here|link)|survey|free download now|full crack keygen serial)\b/i;

// Returns a reason string when a torrent looks like malware bait, else null.
export function downloadRisk(torrent) {
  const name = torrent.name || '';
  if (DISGUISED.test(name)) return 'Disguised program file';
  if (['video', 'audio', 'books', 'anime'].includes(torrent.category) && EXECUTABLE.test(name)) return 'Program file in a media torrent';
  if (SCAM.test(name)) return 'Wording common in scam torrents';
  if (torrent.virus >= 0.5) return 'Flagged by Knaben’s malware check';
  return null;
}
