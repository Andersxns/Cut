import duckduckgo from './web/duckduckgo.js';
import bing from './web/bing.js';
import brave from './web/brave.js';
import rightdao from './web/rightdao.js';
import { wikipedia, marginalia, mwmbl, wiby } from './web/independent.js';
import { piratebay, nyaa, torrentscsv, knaben, archive, bt4g } from './torrents/sources.js';
import { ddgImages, bingImages } from './media/images.js';
import { ddgNews, bingNews } from './media/news.js';
import { ddgVideos, youtube } from './media/videos.js';

// Engines that honour the time filter; the rest are skipped while it is on.
duckduckgo.supportsTime = true;
bing.supportsTime = true;
brave.supportsTime = true;

export const WEB_ENGINES = [duckduckgo, bing, brave, rightdao, wikipedia, marginalia, mwmbl, wiby];
export const TORRENT_SOURCES = [piratebay, nyaa, torrentscsv, knaben, archive, bt4g];

// Media verticals: the primary engine answers, the fallback steps in if it fails.
export const MEDIA_ENGINES = {
  images: [ddgImages, bingImages],
  news: [ddgNews, bingNews],
  videos: [ddgVideos, youtube],
};

export const WEB_ENGINE_IDS = WEB_ENGINES.map((e) => e.id);
export const TORRENT_SOURCE_IDS = TORRENT_SOURCES.map((s) => s.id);

const ALL = new Map([...WEB_ENGINES, ...TORRENT_SOURCES].map((e) => [e.id, e]));
export const engineName = (id) => ALL.get(id)?.name || id;
export const sourceShort = (id) => ALL.get(id)?.short || ALL.get(id)?.name || id;
