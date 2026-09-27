import { fetchUpstream, UpstreamError } from '../../http.js';
import { squash, toTimestamp } from '../../util/text.js';
import { getVqd, ddgJson } from '../ddg-common.js';

export const VIDEO_FILTERS = [
  { key: 'publishedAfter', param: 'vtime', label: 'Time', options: [['', 'Any time'], ['d', 'Past day'], ['w', 'Past week'], ['m', 'Past month']] },
  { key: 'videoDuration', param: 'vlen', label: 'Duration', options: [['', 'Any length'], ['short', 'Short (< 4 min)'], ['medium', 'Medium (4–20 min)'], ['long', 'Long (> 20 min)']] },
  { key: 'videoDefinition', param: 'vres', label: 'Resolution', options: [['', 'Any resolution'], ['high', 'High definition'], ['standard', 'Standard definition']] },
  { key: 'videoLicense', param: 'vlic', label: 'License', options: [['', 'Any license'], ['creativeCommon', 'Creative Commons'], ['youtube', 'YouTube standard']] },
];

const filterString = (filters = {}) => VIDEO_FILTERS.map((f) => (filters[f.key] ? `${f.key}:${filters[f.key]}` : '')).join(',');

export const ddgVideos = {
  id: 'duckduckgo',
  name: 'DuckDuckGo',
  weight: 1,
  timeout: 5000,
  async search(p) {
    const vqd = await getVqd(p.query, p.region);
    const params = { l: p.region.code, o: 'json', q: p.query, vqd, f: filterString(p.extra), p: p.safe === 'off' ? '-1' : '1' };
    if (p.page > 1) params.s = String((p.page - 1) * 60);
    const data = await ddgJson('v.js', params, p.region, p.timeout);
    return (data?.results || []).map((r) => ({
      url: r.content,
      title: squash(r.title),
      description: squash(r.description),
      duration: r.duration || '',
      thumbnail: r.images?.large || r.images?.medium || r.images?.small || '',
      publisher: r.publisher || '',
      uploader: r.uploader || '',
      date: toTimestamp(r.published),
      views: Number(r.statistics?.viewCount) || 0,
    }));
  },
};

// Pulls every `videoRenderer` object out of YouTube's embedded page data.
function collectRenderers(node, out) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) collectRenderers(child, out);
    return out;
  }
  if (node.videoRenderer) out.push(node.videoRenderer);
  for (const key in node) if (key !== 'videoRenderer') collectRenderers(node[key], out);
  return out;
}

const text = (t) => squash(t?.simpleText || (t?.runs || []).map((r) => r.text).join(''));

function parseRelative(label) {
  const m = String(label || '').match(/(\d+)\s+(second|minute|hour|day|week|month|year)/);
  if (!m) return 0;
  const unit = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629746, year: 31556952 }[m[2]];
  return Date.now() - Number(m[1]) * unit * 1000;
}

export const youtube = {
  id: 'youtube',
  name: 'YouTube',
  weight: 0.8,
  timeout: 5000,
  async search(p) {
    if (p.page > 1) return [];
    const page = await fetchUpstream('https://www.youtube.com/results?' + new URLSearchParams({ search_query: p.query, hl: 'en', gl: p.region.country }), {
      timeout: p.timeout,
      headers: { Cookie: 'CONSENT=YES+cb; SOCS=CAI' },
    });
    const start = page.indexOf('var ytInitialData = ');
    if (start < 0) throw new UpstreamError('no data', { code: 'parse' });
    const end = page.indexOf(';</script>', start);
    let data;
    try {
      data = JSON.parse(page.slice(start + 'var ytInitialData = '.length, end));
    } catch {
      throw new UpstreamError('bad data', { code: 'parse' });
    }
    return collectRenderers(data, []).map((v) => {
      const thumbs = v.thumbnail?.thumbnails || [];
      return {
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        title: text(v.title),
        description: text(v.detailedMetadataSnippets?.[0]?.snippetText || v.descriptionSnippet),
        duration: text(v.lengthText),
        thumbnail: (thumbs[thumbs.length - 1]?.url || '').split('?')[0],
        publisher: 'YouTube',
        uploader: text(v.ownerText),
        date: parseRelative(text(v.publishedTimeText)),
        views: Number(text(v.viewCountText).replace(/[^\d]/g, '')) || 0,
      };
    });
  },
};
