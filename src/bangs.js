// !bangs: type "!w cats" to search Wikipedia directly. The redirect happens on
// the server (or in your browser with JavaScript) — Cut keeps no record of it.

// [trigger(s), name, url template, category]
const BANG_TABLE = [
  // Search engines
  ['g google', 'Google', 'https://www.google.com/search?q={q}', 'Search'],
  ['b bing', 'Bing', 'https://www.bing.com/search?q={q}', 'Search'],
  ['ddg', 'DuckDuckGo', 'https://duckduckgo.com/?q={q}', 'Search'],
  ['sp startpage', 'Startpage', 'https://www.startpage.com/do/search?q={q}', 'Search'],
  ['brave', 'Brave Search', 'https://search.brave.com/search?q={q}', 'Search'],
  ['qw qwant', 'Qwant', 'https://www.qwant.com/?q={q}', 'Search'],
  ['eco ecosia', 'Ecosia', 'https://www.ecosia.org/search?q={q}', 'Search'],
  ['mj mojeek', 'Mojeek', 'https://www.mojeek.com/search?q={q}', 'Search'],
  ['mg marginalia', 'Marginalia', 'https://marginalia-search.com/search?query={q}', 'Search'],
  ['ya yandex', 'Yandex', 'https://yandex.com/search/?text={q}', 'Search'],
  ['baidu', 'Baidu', 'https://www.baidu.com/s?wd={q}', 'Search'],
  ['wa wolfram', 'Wolfram|Alpha', 'https://www.wolframalpha.com/input?i={q}', 'Search'],
  ['gi', 'Google Images', 'https://www.google.com/search?tbm=isch&q={q}', 'Search'],
  ['gs scholar', 'Google Scholar', 'https://scholar.google.com/scholar?q={q}', 'Search'],
  // Knowledge
  ['w wiki wikipedia', 'Wikipedia', 'https://en.wikipedia.org/wiki/Special:Search?search={q}', 'Knowledge'],
  ['wt wiktionary', 'Wiktionary', 'https://en.wiktionary.org/wiki/Special:Search?search={q}', 'Knowledge'],
  ['wd wikidata', 'Wikidata', 'https://www.wikidata.org/w/index.php?search={q}', 'Knowledge'],
  ['commons', 'Wikimedia Commons', 'https://commons.wikimedia.org/w/index.php?search={q}', 'Knowledge'],
  ['ia archive', 'Internet Archive', 'https://archive.org/search?query={q}', 'Knowledge'],
  ['wb wayback', 'Wayback Machine', 'https://web.archive.org/web/*/{q}', 'Knowledge'],
  ['arxiv', 'arXiv', 'https://arxiv.org/search/?query={q}&searchtype=all', 'Knowledge'],
  ['pubmed', 'PubMed', 'https://pubmed.ncbi.nlm.nih.gov/?term={q}', 'Knowledge'],
  ['gutenberg', 'Project Gutenberg', 'https://www.gutenberg.org/ebooks/search/?query={q}', 'Knowledge'],
  ['ol openlibrary', 'Open Library', 'https://openlibrary.org/search?q={q}', 'Knowledge'],
  ['gr goodreads', 'Goodreads', 'https://www.goodreads.com/search?q={q}', 'Knowledge'],
  ['d mw', 'Merriam-Webster', 'https://www.merriam-webster.com/dictionary/{q}', 'Knowledge'],
  ['th thesaurus', 'Thesaurus.com', 'https://www.thesaurus.com/browse/{q}', 'Knowledge'],
  ['ud urban', 'Urban Dictionary', 'https://www.urbandictionary.com/define.php?term={q}', 'Knowledge'],
  ['wh wikihow', 'wikiHow', 'https://www.wikihow.com/wikiHowTo?search={q}', 'Knowledge'],
  ['tr translate', 'Google Translate', 'https://translate.google.com/?sl=auto&tl=en&text={q}', 'Knowledge'],
  ['deepl', 'DeepL', 'https://www.deepl.com/translator#auto/en/{q}', 'Knowledge'],
  // Developer
  ['gh github', 'GitHub', 'https://github.com/search?q={q}&type=repositories', 'Developer'],
  ['gl gitlab', 'GitLab', 'https://gitlab.com/search?search={q}', 'Developer'],
  ['so stackoverflow', 'Stack Overflow', 'https://stackoverflow.com/search?q={q}', 'Developer'],
  ['se stackexchange', 'Stack Exchange', 'https://stackexchange.com/search?q={q}', 'Developer'],
  ['au askubuntu', 'Ask Ubuntu', 'https://askubuntu.com/search?q={q}', 'Developer'],
  ['mdn', 'MDN Web Docs', 'https://developer.mozilla.org/en-US/search?q={q}', 'Developer'],
  ['caniuse', 'Can I use', 'https://caniuse.com/?search={q}', 'Developer'],
  ['npm', 'npm', 'https://www.npmjs.com/search?q={q}', 'Developer'],
  ['pypi pip', 'PyPI', 'https://pypi.org/search/?q={q}', 'Developer'],
  ['crates cargo', 'crates.io', 'https://crates.io/search?q={q}', 'Developer'],
  ['go godoc', 'Go Packages', 'https://pkg.go.dev/search?q={q}', 'Developer'],
  ['rs rust', 'Rust std docs', 'https://doc.rust-lang.org/std/?search={q}', 'Developer'],
  ['py python', 'Python docs', 'https://docs.python.org/3/search.html?q={q}', 'Developer'],
  ['php', 'PHP manual', 'https://www.php.net/search.php?pattern={q}', 'Developer'],
  ['dh docker', 'Docker Hub', 'https://hub.docker.com/search?q={q}', 'Developer'],
  ['aw archwiki', 'ArchWiki', 'https://wiki.archlinux.org/index.php?search={q}', 'Developer'],
  ['aur', 'AUR', 'https://aur.archlinux.org/packages?K={q}', 'Developer'],
  ['man', 'man pages', 'https://man.archlinux.org/search?q={q}', 'Developer'],
  ['hn', 'Hacker News', 'https://hn.algolia.com/?q={q}', 'Developer'],
  ['fdroid', 'F-Droid', 'https://search.f-droid.org/?q={q}', 'Developer'],
  // Media
  ['yt youtube', 'YouTube', 'https://www.youtube.com/results?search_query={q}', 'Media'],
  ['vimeo', 'Vimeo', 'https://vimeo.com/search?q={q}', 'Media'],
  ['twitch', 'Twitch', 'https://www.twitch.tv/search?term={q}', 'Media'],
  ['imdb', 'IMDb', 'https://www.imdb.com/find/?q={q}', 'Media'],
  ['rt', 'Rotten Tomatoes', 'https://www.rottentomatoes.com/search?search={q}', 'Media'],
  ['lb letterboxd', 'Letterboxd', 'https://letterboxd.com/search/{q}/', 'Media'],
  ['mal', 'MyAnimeList', 'https://myanimelist.net/search/all?q={q}', 'Media'],
  ['spotify', 'Spotify', 'https://open.spotify.com/search/{q}', 'Media'],
  ['sc soundcloud', 'SoundCloud', 'https://soundcloud.com/search?q={q}', 'Media'],
  ['bc bandcamp', 'Bandcamp', 'https://bandcamp.com/search?q={q}', 'Media'],
  ['genius lyrics', 'Genius', 'https://genius.com/search?q={q}', 'Media'],
  ['discogs', 'Discogs', 'https://www.discogs.com/search/?q={q}', 'Media'],
  ['unsplash', 'Unsplash', 'https://unsplash.com/s/photos/{q}', 'Media'],
  ['pin pinterest', 'Pinterest', 'https://www.pinterest.com/search/pins/?q={q}', 'Media'],
  ['steam', 'Steam', 'https://store.steampowered.com/search/?term={q}', 'Media'],
  ['gog', 'GOG', 'https://www.gog.com/en/games?query={q}', 'Media'],
  ['pcgw', 'PCGamingWiki', 'https://www.pcgamingwiki.com/w/index.php?search={q}', 'Media'],
  // Torrents
  ['tpb piratebay', 'The Pirate Bay', 'https://thepiratebay.org/search.php?q={q}', 'Torrents'],
  ['nyaa', 'Nyaa', 'https://nyaa.si/?q={q}', 'Torrents'],
  ['1337x', '1337x', 'https://1337x.to/search/{q}/1/', 'Torrents'],
  ['knaben', 'Knaben', 'https://knaben.org/search/{q}/0/1/seeders', 'Torrents'],
  ['tcsv', 'Torrents-CSV', 'https://torrents-csv.com/search?q={q}', 'Torrents'],
  // Social & community
  ['r reddit', 'Reddit', 'https://www.reddit.com/search/?q={q}', 'Social'],
  ['x tw twitter', 'X (Twitter)', 'https://x.com/search?q={q}', 'Social'],
  ['bsky', 'Bluesky', 'https://bsky.app/search?q={q}', 'Social'],
  ['q quora', 'Quora', 'https://www.quora.com/search?q={q}', 'Social'],
  ['li linkedin', 'LinkedIn', 'https://www.linkedin.com/search/results/all/?keywords={q}', 'Social'],
  ['fb facebook', 'Facebook', 'https://www.facebook.com/search/top/?q={q}', 'Social'],
  ['ig instagram', 'Instagram', 'https://www.instagram.com/explore/search/keyword/?q={q}', 'Social'],
  ['tt tiktok', 'TikTok', 'https://www.tiktok.com/search?q={q}', 'Social'],
  // Shopping & places
  ['a amazon', 'Amazon', 'https://www.amazon.com/s?k={q}', 'Shopping'],
  ['e ebay', 'eBay', 'https://www.ebay.com/sch/i.html?_nkw={q}', 'Shopping'],
  ['etsy', 'Etsy', 'https://www.etsy.com/search?q={q}', 'Shopping'],
  ['ali aliexpress', 'AliExpress', 'https://www.aliexpress.com/wholesale?SearchText={q}', 'Shopping'],
  ['walmart', 'Walmart', 'https://www.walmart.com/search?q={q}', 'Shopping'],
  ['m maps osm', 'OpenStreetMap', 'https://www.openstreetmap.org/search?query={q}', 'Places'],
  ['gm gmaps', 'Google Maps', 'https://www.google.com/maps/search/{q}', 'Places'],
  ['yelp', 'Yelp', 'https://www.yelp.com/search?find_desc={q}', 'Places'],
  ['ta tripadvisor', 'Tripadvisor', 'https://www.tripadvisor.com/Search?q={q}', 'Places'],
  // News
  ['bbc', 'BBC', 'https://www.bbc.co.uk/search?q={q}', 'News'],
  ['reuters', 'Reuters', 'https://www.reuters.com/site-search/?query={q}', 'News'],
  ['ap apnews', 'AP News', 'https://apnews.com/search?q={q}', 'News'],
];

export const BANGS = BANG_TABLE.map(([triggers, name, url, category]) => ({
  triggers: triggers.split(' '),
  trigger: triggers.split(' ')[0],
  name,
  url,
  category,
  domain: new URL(url).hostname.replace(/^www\./, ''),
}));

// Bangs that switch Cut's own tabs instead of leaving the site.
export const INTERNAL_BANGS = { i: 'images', img: 'images', images: 'images', v: 'videos', vid: 'videos', videos: 'videos', n: 'news', news: 'news', t: 'torrents', torrent: 'torrents', torrents: 'torrents', web: 'web' };

const BY_TRIGGER = new Map();
for (const bang of BANGS) for (const trigger of bang.triggers) BY_TRIGGER.set(trigger, bang);

// Parses a query for a bang anywhere in it ("!w cats" or "cats !w").
// Returns { redirect } for external bangs, { type, query } for internal ones,
// { lucky, query } for "\query" / "! query", or null.
export function resolveBang(rawQuery) {
  const query = rawQuery.trim();
  if (query.startsWith('\\') && query.length > 1) return { lucky: true, query: query.slice(1).trim() };
  const tokens = query.split(/\s+/);
  if (tokens[0] === '!' && tokens.length > 1) return { lucky: true, query: tokens.slice(1).join(' ') };
  const index = tokens.findIndex((t) => /^!\S+$/.test(t) && (INTERNAL_BANGS[t.slice(1).toLowerCase()] || BY_TRIGGER.has(t.slice(1).toLowerCase())));
  if (index < 0) return null;
  const trigger = tokens[index].slice(1).toLowerCase();
  const rest = tokens.filter((_, i) => i !== index).join(' ').trim();
  if (INTERNAL_BANGS[trigger]) return { type: INTERNAL_BANGS[trigger], query: rest };
  const bang = BY_TRIGGER.get(trigger);
  if (!bang) return null;
  const redirect = rest ? bang.url.replace('{q}', encodeURIComponent(rest)) : `https://${new URL(bang.url).host}/`;
  return { redirect, bang };
}

export function suggestBangs(prefix, limit = 8) {
  const p = prefix.replace(/^!/, '').toLowerCase();
  const seen = new Set();
  const out = [];
  for (const bang of BANGS) {
    const hit = bang.triggers.find((t) => t.startsWith(p)) || (p.length > 1 && bang.name.toLowerCase().startsWith(p) ? bang.trigger : null);
    if (hit && !seen.has(bang)) {
      seen.add(bang);
      out.push({ trigger: hit, name: bang.name, domain: bang.domain });
    }
  }
  return out.sort((a, b) => a.trigger.length - b.trigger.length).slice(0, limit);
}
