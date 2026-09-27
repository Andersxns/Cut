import * as cheerio from 'cheerio';
import { fetchUpstream } from '../../http.js';
import { parseSize, squash, toTimestamp } from '../../util/text.js';
import { normalizeHash, hashFromMagnet, guessCategory, categoryFromLabel } from './common.js';

// Each source returns items shaped like:
// { name, hash, size, seeders, leechers, date, category, source, url, torrentUrl?, magnet?, files?, uploader?, trusted?, webseed? }

const int = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Math.max(0, parseInt(v, 10)));

function tpbCategory(code) {
  const n = Number(code);
  if (n === 102 || n === 601 || n === 602) return 'books';
  if (n >= 100 && n < 200) return 'audio';
  if (n >= 200 && n < 300) return 'video';
  if (n >= 300 && n < 400) return 'apps';
  if (n >= 400 && n < 500) return 'games';
  if (n >= 500 && n < 600) return 'xxx';
  return 'other';
}

export const piratebay = {
  id: 'piratebay',
  name: 'The Pirate Bay',
  short: 'TPB',
  description: 'Largest general-purpose public index (via its JSON API).',
  timeout: 5000,
  async search(p) {
    const data = await fetchUpstream('https://apibay.org/q.php?' + new URLSearchParams({ q: p.query, cat: '0' }), {
      timeout: p.timeout,
      as: 'json',
      headers: { Accept: 'application/json' },
    });
    return (Array.isArray(data) ? data : [])
      .filter((t) => t.id !== '0' && normalizeHash(t.info_hash))
      .map((t) => ({
        name: t.name,
        hash: normalizeHash(t.info_hash),
        size: Number(t.size) || 0,
        seeders: int(t.seeders),
        leechers: int(t.leechers),
        date: toTimestamp(Number(t.added)),
        category: tpbCategory(t.category),
        source: 'piratebay',
        url: `https://thepiratebay.org/description.php?id=${encodeURIComponent(t.id)}`,
        files: int(t.num_files),
        uploader: t.username,
        trusted: t.status === 'vip' || t.status === 'trusted',
      }));
  },
};

const NYAA_CATEGORY = { 1: 'anime', 2: 'audio', 3: 'books', 4: 'video', 5: 'other' };

export const nyaa = {
  id: 'nyaa',
  name: 'Nyaa',
  short: 'Nyaa',
  description: 'The main index for anime, manga and East Asian media.',
  timeout: 5000,
  async search(p) {
    const xml = await fetchUpstream('https://nyaa.si/?' + new URLSearchParams({ page: 'rss', q: p.query, c: '0_0', f: '0', s: 'seeders', o: 'desc' }), {
      timeout: p.timeout,
      headers: { Accept: 'application/rss+xml, application/xml' },
    });
    const $ = cheerio.load(xml, { xmlMode: true });
    const items = [];
    $('item').each((_, el) => {
      const item = $(el);
      const get = (tag) => item.find(tag.replace(':', '\\:')).first().text().trim();
      const hash = normalizeHash(get('nyaa:infoHash'));
      if (!hash) return;
      const [major, minor] = get('nyaa:categoryId').split('_');
      let category = NYAA_CATEGORY[major] || 'other';
      if (major === '6') category = minor === '2' ? 'games' : 'apps';
      items.push({
        name: get('title'),
        hash,
        size: parseSize(get('nyaa:size')),
        seeders: int(get('nyaa:seeders')),
        leechers: int(get('nyaa:leechers')),
        date: toTimestamp(get('pubDate')),
        category,
        source: 'nyaa',
        url: get('guid'),
        torrentUrl: get('link'),
        trusted: get('nyaa:trusted') === 'Yes',
      });
    });
    return items;
  },
};

export const torrentscsv = {
  id: 'torrentscsv',
  name: 'Torrents-CSV',
  short: 'CSV',
  description: 'Open, community-maintained database of healthy torrents.',
  timeout: 5000,
  async search(p) {
    const data = await fetchUpstream('https://torrents-csv.com/service/search?' + new URLSearchParams({ q: p.query, size: '50' }), {
      timeout: p.timeout,
      as: 'json',
      headers: { Accept: 'application/json' },
    });
    return (data?.torrents || [])
      .filter((t) => normalizeHash(t.infohash))
      .map((t) => ({
        name: t.name,
        hash: normalizeHash(t.infohash),
        size: Number(t.size_bytes) || 0,
        seeders: int(t.seeders),
        leechers: int(t.leechers),
        date: toTimestamp(Number(t.created_unix)),
        category: guessCategory(t.name),
        source: 'torrentscsv',
        url: `https://torrents-csv.com/search?q=${encodeURIComponent(t.name)}`,
      }));
  },
};

export const knaben = {
  id: 'knaben',
  name: 'Knaben',
  short: 'Knaben',
  description: 'Meta-index that aggregates many public trackers at once.',
  timeout: 5000,
  async search(p) {
    const data = await fetchUpstream('https://api.knaben.org/v1', {
      method: 'POST',
      timeout: p.timeout,
      as: 'json',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        search_type: '100%',
        search_field: 'title',
        query: p.query,
        order_by: 'seeders',
        order_direction: 'desc',
        size: 30,
        hide_unsafe: true,
        hide_xxx: p.safe !== 'off',
      }),
    });
    return (data?.hits || [])
      .filter((t) => normalizeHash(t.hash) || hashFromMagnet(t.magnetUrl))
      .map((t) => {
        let origin = '';
        try {
          origin = new URL(t.link || '').searchParams.get('knabensource') || '';
        } catch {}
        return {
          name: t.title,
          hash: normalizeHash(t.hash) || hashFromMagnet(t.magnetUrl),
          size: Number(t.bytes) || 0,
          seeders: int(t.seeders),
          leechers: int(t.peers),
          date: toTimestamp(t.date),
          category: categoryFromLabel(t.category, t.title),
          source: 'knaben',
          via: t.tracker,
          virus: Number(t.virusDetection) || 0,
          url: /^https?:\/\//.test(origin) ? origin : t.details,
        };
      });
  },
};

const IA_CATEGORY = { movies: 'video', audio: 'audio', etree: 'audio', texts: 'books', software: 'apps' };
const IA_TRACKERS = ['http://bt1.archive.org:6969/announce', 'http://bt2.archive.org:6969/announce'];
const luceneEscape = (s) => s.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');

export const archive = {
  id: 'archive',
  name: 'Internet Archive',
  short: 'Archive',
  description: 'Public-domain films, music, books and software — always web-seeded.',
  timeout: 5000,
  async search(p) {
    const terms = p.query.split(/\s+/).filter(Boolean).map(luceneEscape).join(' ');
    if (!terms) return [];
    const params = new URLSearchParams({
      q: `title:(${terms}) AND btih:* AND -mediatype:(collection OR account OR web)`,
      rows: '40',
      output: 'json',
    });
    for (const field of ['identifier', 'title', 'btih', 'item_size', 'mediatype', 'downloads', 'publicdate', 'creator']) params.append('fl[]', field);
    params.append('sort[]', 'downloads desc');
    const data = await fetchUpstream('https://archive.org/advancedsearch.php?' + params, {
      timeout: p.timeout,
      as: 'json',
      headers: { Accept: 'application/json' },
    });
    return (data?.response?.docs || [])
      .filter((d) => normalizeHash(d.btih))
      .map((d) => {
        const id = encodeURIComponent(d.identifier);
        const title = Array.isArray(d.title) ? d.title[0] : d.title;
        return {
          name: squash(title) || d.identifier,
          hash: normalizeHash(d.btih),
          size: Number(d.item_size) || 0,
          seeders: null,
          leechers: null,
          date: toTimestamp(d.publicdate),
          category: IA_CATEGORY[d.mediatype] || 'other',
          source: 'archive',
          url: `https://archive.org/details/${id}`,
          torrentUrl: `https://archive.org/download/${id}/${id}_archive.torrent`,
          uploader: Array.isArray(d.creator) ? d.creator[0] : d.creator,
          downloads: int(d.downloads),
          webseed: true,
          trackers: IA_TRACKERS,
          webseeds: ['https://archive.org/download/'],
        };
      });
  },
};

export const bt4g = {
  id: 'bt4g',
  name: 'BT4G',
  short: 'BT4G',
  description: 'Huge DHT-crawled index. Finds rare files, but reports no seed counts.',
  timeout: 5000,
  async search(p) {
    const xml = await fetchUpstream('https://bt4gprx.com/search?' + new URLSearchParams({ q: p.query, page: 'rss', orderby: 'seeders' }), {
      timeout: p.timeout,
      headers: { Accept: 'application/rss+xml, application/xml' },
    });
    const $ = cheerio.load(xml, { xmlMode: true });
    const items = [];
    $('item').each((_, el) => {
      const item = $(el);
      const magnet = item.find('link').first().text().trim();
      const hash = hashFromMagnet(magnet);
      if (!hash) return;
      const parts = item.find('description').first().text().split(/<br\s*\/?>/i).map((s) => s.trim());
      const name = item.find('title').first().text().trim();
      items.push({
        name,
        hash,
        size: parseSize(parts[1]),
        seeders: null,
        leechers: null,
        date: toTimestamp(item.find('pubDate').first().text().replace(/,(\S)/, ', $1')),
        category: categoryFromLabel(parts[2], name),
        source: 'bt4g',
        url: item.find('guid').first().text().trim(),
      });
    });
    return items;
  },
};
