import * as cheerio from 'cheerio';
import { fetchUpstream } from '../../http.js';
import { hostname } from '../../util/url.js';
import { squash } from '../../util/text.js';
import { getVqd, ddgJson } from '../ddg-common.js';
import { bingCookie } from '../web/bing.js';

// Image filters, in the positional order DuckDuckGo's `f` parameter expects.
export const IMAGE_FILTERS = [
  { key: 'time', param: 'itime', label: 'Time', options: [['', 'Any time'], ['Day', 'Past day'], ['Week', 'Past week'], ['Month', 'Past month'], ['Year', 'Past year']] },
  { key: 'size', param: 'isize', label: 'Size', options: [['', 'All sizes'], ['Small', 'Small'], ['Medium', 'Medium'], ['Large', 'Large'], ['Wallpaper', 'Wallpaper']] },
  { key: 'color', param: 'icolor', label: 'Color', options: [['', 'All colors'], ['color', 'Color only'], ['Monochrome', 'Black & white'], ['Red', 'Red'], ['Orange', 'Orange'], ['Yellow', 'Yellow'], ['Green', 'Green'], ['Blue', 'Blue'], ['Purple', 'Purple'], ['Pink', 'Pink'], ['Brown', 'Brown'], ['Black', 'Black'], ['Gray', 'Gray'], ['Teal', 'Teal'], ['White', 'White']] },
  { key: 'type', param: 'itype', label: 'Type', options: [['', 'All types'], ['photo', 'Photograph'], ['clipart', 'Clipart'], ['gif', 'Animated GIF'], ['transparent', 'Transparent'], ['line', 'Line drawing']] },
  { key: 'layout', param: 'ilayout', label: 'Layout', options: [['', 'All layouts'], ['Square', 'Square'], ['Tall', 'Tall'], ['Wide', 'Wide']] },
  { key: 'license', param: 'ilicense', label: 'License', options: [['', 'All licenses'], ['Any', 'Creative Commons'], ['Public', 'Public domain'], ['Share', 'Free to share'], ['ShareCommercially', 'Share commercially'], ['Modify', 'Free to modify'], ['ModifyCommercially', 'Modify commercially']] },
];

export const ddgImageFilterString = (filters = {}) =>
  IMAGE_FILTERS.map((f) => (filters[f.key] ? `${f.key}:${filters[f.key]}` : '')).join(',');

export const ddgImages = {
  id: 'duckduckgo',
  name: 'DuckDuckGo',
  weight: 1,
  timeout: 5000,
  async search(p) {
    const vqd = await getVqd(p.query, p.region);
    const params = { l: p.region.code, o: 'json', q: p.query, vqd, f: ddgImageFilterString(p.extra), p: p.safe === 'off' ? '-1' : '1' };
    if (p.page > 1) params.s = String((p.page - 1) * 100);
    const data = await ddgJson('i.js', params, p.region, p.timeout);
    return (data?.results || []).map((r) => ({
      url: r.url,
      title: squash(r.title),
      image: r.image,
      thumbnail: r.thumbnail,
      width: Number(r.width) || 0,
      height: Number(r.height) || 0,
      domain: hostname(r.url),
    }));
  },
};

const BING_SIZE = { Small: 'small', Medium: 'medium', Large: 'large', Wallpaper: 'wallpaper' };

export const bingImages = {
  id: 'bing',
  name: 'Bing',
  weight: 0.8,
  timeout: 5000,
  async search(p) {
    const params = new URLSearchParams({ q: p.query, async: '1', first: String((p.page - 1) * 35 + 1), count: '35', mkt: p.region.market });
    const qft = [];
    if (p.extra?.size && BING_SIZE[p.extra.size]) qft.push(`+filterui:imagesize-${BING_SIZE[p.extra.size]}`);
    if (p.extra?.layout) qft.push(`+filterui:aspect-${p.extra.layout.toLowerCase()}`);
    if (p.extra?.type && p.extra.type !== 'gif') qft.push(`+filterui:photo-${p.extra.type}`);
    if (p.extra?.type === 'gif') qft.push('+filterui:photo-animatedgif');
    if (qft.length) params.set('qft', qft.join(''));
    const page = await fetchUpstream('https://www.bing.com/images/async?' + params, {
      timeout: p.timeout,
      lang: p.region.acceptLanguage,
      headers: { Cookie: bingCookie(p) },
    });
    const $ = cheerio.load(page);
    const results = [];
    $('a.iusc').each((_, el) => {
      let meta;
      try {
        meta = JSON.parse($(el).attr('m') || '{}');
      } catch {
        return;
      }
      if (!meta.murl || !meta.purl) return;
      const info = squash($(el).closest('li').find('.img_info span, .imgpt span').first().text());
      const dims = info.match(/(\d+)\s*[x×]\s*(\d+)/);
      results.push({
        url: meta.purl,
        title: squash(meta.t || meta.desc || ''),
        image: meta.murl,
        thumbnail: meta.turl || meta.murl,
        width: dims ? Number(dims[1]) : 0,
        height: dims ? Number(dims[2]) : 0,
        domain: hostname(meta.purl),
      });
    });
    return results;
  },
};
