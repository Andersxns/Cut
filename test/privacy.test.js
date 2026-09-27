import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanLink, parseDomainList, isAdDomain } from '../src/privacy/links.js';
import { applyResultPrefs } from '../src/privacy/results.js';
import { downloadRisk } from '../src/privacy/threats.js';
import { DEFAULT_PREFS, mergePrefs, serializePrefs, features, exportCode, importCode, readPrefs, COOKIE_NAME } from '../src/prefs.js';

const prefs = (overrides = {}) => mergePrefs(structuredClone(DEFAULT_PREFS), new URLSearchParams(overrides), ['duckduckgo', 'bing'], ['nyaa']);
const clean = (url, p = prefs()) => cleanLink(url, p).url;

test('redirect wrappers are undone', () => {
  assert.equal(clean('https://www.google.com/url?q=https://example.com/a&sa=D'), 'https://example.com/a');
  assert.equal(clean('https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.org%2F&h=AT0'), 'https://example.org/');
  assert.equal(clean('https://out.reddit.com/t3_x?url=https%3A%2F%2Fexample.net%2Fpage&token=1'), 'https://example.net/page');
  assert.equal(clean('https://www.google.com/url?q=https://example.com/a', prefs({ etp: 'custom', unwrap: '0' })), 'https://www.google.com/url?q=https://example.com/a');
});

test('AMP pages are replaced with the original', () => {
  assert.equal(clean('https://www.google.com/amp/s/www.bbc.co.uk/news/world-1'), 'https://www.bbc.co.uk/news/world-1');
  assert.equal(clean('https://www-bbc-co-uk.cdn.ampproject.org/c/s/www.bbc.co.uk/news/x'), 'https://www.bbc.co.uk/news/x');
});

test('tracking parameters: standard vs strict', () => {
  const url = 'https://ex.com/p?utm_source=a&ref=b&id=1&fbclid=z';
  assert.equal(clean(url), 'https://ex.com/p?ref=b&id=1');
  assert.equal(clean(url, prefs({ etp: 'strict' })), 'https://ex.com/p?id=1');
  assert.equal(clean(url, prefs({ etp: 'custom', strip: 'off' })), url);
  assert.equal(clean('https://www.amazon.com/Some-Thing/dp/B0ABCDEFGH/ref=sr_1_1?crid=X&tag=aff-20', prefs({ etp: 'strict' })), 'https://www.amazon.com/dp/B0ABCDEFGH');
});

test('HTTPS-only mode', () => {
  assert.equal(clean('http://example.com/a'), 'https://example.com/a');
  const marked = cleanLink('http://example.com/a', prefs({ https: 'mark' }));
  assert.deepEqual(marked, { url: 'http://example.com/a', insecure: true });
  assert.equal(clean('http://example.com/a', prefs({ https: 'off' })), 'http://example.com/a');
});

test('privacy-friendly front-ends', () => {
  assert.equal(clean('https://www.youtube.com/watch?v=abc123', prefs({ fe_youtube: 'invidious' })), 'https://yewtu.be/watch?v=abc123');
  assert.equal(clean('https://youtu.be/abc123?t=5', prefs({ fe_youtube: 'piped' })), 'https://piped.video/watch?v=abc123&t=5');
  assert.equal(clean('https://www.youtube.com/watch?v=abc', prefs({ fe_youtube: 'invidious', fi_youtube: 'https://inv.example.org' })), 'https://inv.example.org/watch?v=abc');
  assert.equal(clean('https://www.reddit.com/r/linux/comments/1', prefs({ fe_reddit: 'old' })), 'https://old.reddit.com/r/linux/comments/1');
  assert.equal(clean('https://x.com/user/status/1', prefs({ fe_twitter: 'nitter' })), 'https://nitter.net/user/status/1');
  assert.equal(clean('https://someone.medium.com/a-post-123', prefs({ fe_medium: 'scribe' })), 'https://scribe.rip/@someone/a-post-123');
  // Invalid custom servers are ignored rather than used.
  assert.equal(prefs({ fe_youtube: 'invidious', fi_youtube: 'javascript:alert(1)' }).fi_youtube, '');
});

test('site lists, ad domains and boosting', () => {
  assert.deepEqual(parseDomainList('https://www.Pinterest.com/pin/1\n*.example.org, bad value, example.org'), ['pinterest.com', 'example.org']);
  assert.equal(isAdDomain('ad.doubleclick.net'), true);
  assert.equal(isAdDomain('example.com'), false);
  const results = [
    { url: 'https://www.pinterest.com/a', score: 5 },
    { url: 'https://ad.doubleclick.net/x', score: 4 },
    { url: 'https://example.com/a', score: 3 },
    { url: 'https://en.wikipedia.org/wiki/X', score: 1 },
  ];
  const p = prefs({ etp: 'strict', blockSites: 'pinterest.com', boostSites: 'wikipedia.org' });
  const out = applyResultPrefs(results, { ...p, safeBrowsing: 'off' }, { rerank: true });
  assert.deepEqual(out.map((r) => r.url), ['https://example.com/a', 'https://en.wikipedia.org/wiki/X']);
});

test('suspicious torrents are recognised', () => {
  assert.equal(downloadRisk({ name: 'New.Movie.2026.1080p.mp4.exe', category: 'video' }), 'Disguised program file');
  assert.equal(downloadRisk({ name: 'Album 2026 setup.exe', category: 'audio' }), 'Program file in a media torrent');
  assert.equal(downloadRisk({ name: 'Movie 2026 [codec required]', category: 'video' }), 'Wording common in scam torrents');
  assert.equal(downloadRisk({ name: 'LibreOffice 26.2 x64.msi', category: 'apps' }), null);
  assert.equal(downloadRisk({ name: 'Ubuntu 26.04 Desktop', category: 'apps', virus: 0.8 }), 'Flagged by Knaben’s malware check');
});

test('presets, security levels and settings codes', () => {
  assert.equal(serializePrefs(DEFAULT_PREFS), '', 'defaults produce no cookie');
  const strict = prefs({ etp: 'strict', adblock: '0' });
  assert.equal(strict.adblock, true, 'presets win over individual choices');
  assert.equal(prefs({ etp: 'custom', adblock: '1' }).adblock, true);
  assert.deepEqual(features(prefs({ level: 'safest' })), { js: false, webfont: false, favicons: false, thumbnails: false, images: false, proxyImages: true });
  assert.equal(features(prefs({ level: 'safer' })).js, true);
  const custom = prefs({ theme: 'dark', fe_reddit: 'old', level: 'safer', keep: 'session', blockSites: 'example.com' });
  const code = exportCode(custom);
  assert.match(code, /^cut1\.[A-Za-z0-9_-]+$/);
  const back = importCode(code, ['duckduckgo', 'bing'], ['nyaa']);
  assert.equal(back.theme, 'dark');
  assert.equal(back.frontends.reddit, 'old');
  assert.equal(back.level, 'safer');
  assert.equal(back.keep, 'session');
  assert.deepEqual(back.blockSites, ['example.com']);
  assert.equal(importCode('nonsense'), null);
  const fromCookie = readPrefs(`${COOKIE_NAME}=${serializePrefs(custom)}`, ['duckduckgo', 'bing'], ['nyaa']);
  assert.equal(fromCookie.level, 'safer');
  assert.equal(readPrefs(`${COOKIE_NAME}=${encodeURIComponent('ac=0')}`, [], []).suggest, 'off', 'older cookies still work');
});
