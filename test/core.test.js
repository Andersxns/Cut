import { test } from 'node:test';
import assert from 'node:assert/strict';

import { html, raw, escapeHtml } from '../src/util/html.js';
import { cleanUrl, urlKey, breadcrumb, isPublicHost } from '../src/util/url.js';
import { highlight, formatBytes, parseSize, timeAgo, significantTokens } from '../src/util/text.js';
import { calculate } from '../src/answers/calc.js';
import { convertUnits } from '../src/answers/units.js';
import { matchCurrency } from '../src/answers/currency.js';
import { resolveBang, suggestBangs } from '../src/bangs.js';
import { normalizeHash, buildMagnet, guessCategory, hashFromMagnet } from '../src/engines/torrents/common.js';
import { mergeWeb, offTopic } from '../src/search/web.js';
import { runEngines } from '../src/search/run.js';
import { mergeTorrents, rankTorrents } from '../src/search/torrents.js';
import { decodeBingUrl } from '../src/engines/web/bing.js';
import { unwrapDdgUrl, isDdgAd } from '../src/engines/ddg-common.js';
import { readPrefs, serializePrefs, mergePrefs, DEFAULT_PREFS, COOKIE_NAME } from '../src/prefs.js';

test('html templates escape interpolations unless marked safe', () => {
  const evil = '<script>alert("x")</script>';
  assert.equal(String(html`<p>${evil}</p>`), '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
  assert.equal(String(html`<p>${raw('<b>ok</b>')}</p>`), '<p><b>ok</b></p>');
  assert.equal(String(html`<ul>${['a', '<b>'].map((x) => html`<li>${x}</li>`)}</ul>`), '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
  assert.equal(String(html`${null}${false}${undefined}${0}`), '0');
  assert.equal(escapeHtml(`"'&`), '&quot;&#39;&amp;');
});

test('tracking parameters are stripped and URLs are keyed for de-duplication', () => {
  assert.equal(cleanUrl('https://ex.com/a?utm_source=x&id=7&fbclid=abc'), 'https://ex.com/a?id=7');
  assert.equal(cleanUrl('https://youtu.be/abc?si=tracker'), 'https://youtu.be/abc');
  assert.equal(cleanUrl('https://example.org/?si=keep'), 'https://example.org/?si=keep');
  assert.equal(urlKey('https://www.kernel.org/'), urlKey('http://kernel.org'));
  assert.equal(urlKey('https://ex.com/a?b=2&a=1'), urlKey('https://ex.com/a?a=1&b=2&utm_medium=email'));
  assert.deepEqual(breadcrumb('https://www.github.com/torvalds/linux'), { host: 'github.com', parts: ['torvalds', 'linux'] });
  assert.equal(isPublicHost('192.168.1.10'), false);
  assert.equal(isPublicHost('localhost'), false);
  assert.equal(isPublicHost('tse1.mm.bing.net'), true);
});

test('text helpers', () => {
  assert.equal(String(highlight('The Linux kernel <3', ['linux', 'kernel'])), 'The <b>Linux</b> <b>kernel</b> &lt;3');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(0), '');
  assert.equal(parseSize('389.7 MiB'), Math.round(389.7 * 1024 ** 2));
  assert.equal(timeAgo(Date.now() - 3 * 86_400_000), '3 days ago');
  assert.deepEqual(significantTokens('The Night of the Living Dead'), ['night', 'living', 'dead']);
});

test('calculator evaluates expressions safely', () => {
  const value = (q) => calculate(q)?.value;
  assert.equal(value('2+2*3'), 8);
  assert.equal(value('(1+2)(3+4)'), 21);
  assert.equal(value('2^10'), 1024);
  assert.equal(value('-2^2'), -4);
  assert.equal(value('5!'), 120);
  assert.equal(value('15% of 200'), 30);
  assert.equal(value('200 * 15%'), 30);
  assert.equal(value('10 mod 3'), 1);
  assert.equal(value('what is 7 x 6'), 42);
  assert.equal(value('log10(1000)'), 3);
  assert.equal(Math.round(value('sin(30 deg)') * 1e9) / 1e9, 0.5);
  assert.equal(calculate('0.1+0.2').result, '0.3');
  for (const notMath of ['windows 10', '2024', '2024-10-12', '1-800-555-1234', '2 3', 'pi', '-5', 'constructor', 'process.exit()']) {
    assert.equal(calculate(notMath), null, notMath);
  }
});

test('unit conversion', () => {
  const miles = convertUnits('10 km to miles');
  assert.equal(miles.to.value, '6.213712');
  assert.equal(miles.to.unit, 'miles');
  assert.equal(convertUnits('72 f in c').to.value, '22.22222');
  assert.equal(convertUnits('how many feet in a mile').to.value, '5,280');
  assert.equal(convertUnits('100 Mb to MB').to.value, '12.5');
  assert.equal(convertUnits('cm to inches').from.value, '1');
  assert.equal(convertUnits('move to canada'), null);
  assert.equal(convertUnits('10 km to kg'), null);
});

test('currency queries are recognised without a network call', () => {
  assert.equal(typeof matchCurrency('100 usd to eur'), 'function');
  assert.equal(typeof matchCurrency('€50 in dollars'), 'function');
  assert.equal(typeof matchCurrency('gbp to jpy'), 'function');
  assert.equal(matchCurrency('usd to usd'), null);
  assert.equal(matchCurrency('go to school'), null);
});

test('bangs', () => {
  assert.equal(resolveBang('!w Ada Lovelace').redirect, 'https://en.wikipedia.org/wiki/Special:Search?search=Ada%20Lovelace');
  assert.equal(resolveBang('react hooks !gh').redirect, 'https://github.com/search?q=react%20hooks&type=repositories');
  assert.equal(resolveBang('!yt').redirect, 'https://www.youtube.com/');
  assert.deepEqual(resolveBang('!t ubuntu'), { type: 'torrents', query: 'ubuntu' });
  assert.deepEqual(resolveBang('\\kernel.org'), { lucky: true, query: 'kernel.org' });
  assert.equal(resolveBang("let's go!"), null);
  assert.equal(resolveBang('hello !notabang'), null);
  assert.equal(suggestBangs('!g')[0].trigger, 'g');
});

test('info hashes and magnets', () => {
  const hex = 'df1f5ca98deb5f6821453edc6e9357c1f0be40aa';
  assert.equal(normalizeHash(hex.toUpperCase()), hex);
  assert.equal(normalizeHash('34PVZKMN5NPWQIKFH3OG5E2XYHYL4QFK'), hex);
  assert.equal(normalizeHash('nope'), '');
  const magnet = buildMagnet(hex, 'Ubuntu ISO', { webseeds: ['https://archive.org/download/'] });
  assert.ok(magnet.startsWith(`magnet:?xt=urn:btih:${hex}&dn=Ubuntu%20ISO&tr=`));
  assert.ok(magnet.includes('&ws=https%3A%2F%2Farchive.org%2Fdownload%2F'));
  assert.equal(hashFromMagnet(magnet), hex);
  assert.equal(guessCategory('Movie.2020.1080p.BluRay.x264'), 'video');
  assert.equal(guessCategory('Artist - Album (2019) [FLAC]'), 'audio');
  assert.equal(guessCategory('[SubsPlease] Frieren - 01 (1080p).mkv'), 'anime');
  assert.equal(guessCategory('Some Book.epub'), 'books');
});

test('web results are merged by consensus', () => {
  const ddg = { id: 'duckduckgo', weight: 1 };
  const bing = { id: 'bing', weight: 1 };
  const outcomes = [
    { engine: ddg, results: [{ url: 'https://a.com/x?utm_source=t', title: 'A', snippet: 'short' }, { url: 'https://only-ddg.com', title: 'D' }] },
    { engine: bing, results: [{ url: 'https://b.com', title: 'B' }, { url: 'http://www.a.com/x', title: 'Official site', snippet: 'a much longer snippet' }] },
  ];
  const merged = mergeWeb(outcomes);
  assert.equal(merged[0].url, 'https://a.com/x');
  assert.deepEqual(merged[0].engines, ['duckduckgo', 'bing']);
  assert.equal(merged[0].snippet, 'a much longer snippet');
  assert.equal(merged[0].official, true);
  assert.equal(merged.length, 3);
});

test('a stalled minor engine does not hold up the page', async () => {
  const engine = (id, ms, { core = false, fail = false } = {}) => ({
    id,
    core,
    timeout: 60_000,
    search: () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => (fail ? reject(Object.assign(new Error('x'), { code: 'captcha' })) : resolve([{ url: `https://${id}.example/` }])), ms);
        if (ms >= 5000) timer.unref(); // stalled engines shouldn't keep the test process alive
      }),
  });
  const params = (query) => ({ query, page: 1, region: { code: 'wt-wt' }, safe: 'moderate', time: '' });
  const status = (run) => run.outcomes.map((o) => o.error || 'ok');
  const [main, empty, none] = await Promise.all([
    runEngines('test', [engine('a', 30, { core: true }), engine('b', 60, { core: true, fail: true }), engine('minor', 90), engine('stalled', 10_000)], params('q1')),
    // With nothing to show yet, every engine is waited for.
    runEngines('test', [engine('c', 20, { core: true, fail: true }), engine('slow', 1200)], params('q2')),
    // Without core engines, half of them must answer first.
    runEngines('test', [engine('d', 20), engine('e', 40), engine('f', 10_000)], params('q3')),
  ]);
  assert.ok(main.ms < 1500, `returned after ${main.ms} ms`);
  assert.deepEqual(status(main), ['ok', 'captcha', 'ok', 'late']);
  assert.ok(empty.ms >= 1200);
  assert.deepEqual(status(empty), ['captcha', 'ok']);
  assert.deepEqual(status(none), ['ok', 'ok', 'late']);
});

test('an engine answering with unrelated results is set aside', () => {
  const result = (title, url = 'https://example.com/') => ({ title, snippet: '', url });
  const junk = ['Metal Processing Corporation', 'About Us - Metal Processing', 'Industrial coatings', 'Steel supplier', 'Contact us'].map((t) => result(t));
  assert.match(offTopic(junk, 'rust ownership'), /unrelated/);
  const good = [result('Understanding Ownership - The Rust Book'), result('What is ownership?', 'https://doc.rust-lang.org/book/'), result('Rust borrow checker explained'), result('Ownership and borrowing'), result('Stack Overflow')];
  assert.equal(offTopic(good, 'rust ownership'), null);
  assert.equal(offTopic(junk.slice(0, 3), 'rust ownership'), null, 'too few results to judge');
  assert.equal(offTopic(junk, 'yt'), null, 'short queries are not judged');
});

test('torrents are merged by hash, filtered for relevance and safe search', () => {
  const hash = 'a'.repeat(40);
  const outcomes = [
    { results: [{ name: 'Ubuntu 24.04 Desktop ISO', hash, size: 6e9, seeders: 10, leechers: 1, date: 2, category: 'apps', source: 'piratebay', url: 'u1' }] },
    {
      results: [
        { name: 'Ubuntu 24.04 Desktop ISO', hash, size: 0, seeders: 25, leechers: 3, date: 1, category: 'other', source: 'knaben', url: 'u2' },
        { name: 'Something unrelated', hash: 'b'.repeat(40), seeders: 900, category: 'video', source: 'knaben', url: 'u3' },
        { name: 'Ubuntu xxx edition', hash: 'c'.repeat(40), seeders: 5, category: 'xxx', source: 'knaben', url: 'u4' },
      ],
    },
  ];
  const merged = mergeTorrents(outcomes);
  const ubuntu = merged.find((t) => t.hash === hash);
  assert.equal(ubuntu.seeders, 25);
  assert.equal(ubuntu.size, 6e9);
  assert.equal(ubuntu.date, 1);
  assert.equal(ubuntu.category, 'apps');
  assert.deepEqual(ubuntu.sources.map((s) => s.id), ['piratebay', 'knaben']);
  const ranked = rankTorrents(merged, 'ubuntu', 'moderate');
  assert.deepEqual(ranked.map((t) => t.hash), [hash]);
  assert.ok(ranked[0].magnet.startsWith('magnet:?xt=urn:btih:'));
  assert.equal(rankTorrents(mergeTorrents(outcomes), 'ubuntu', 'off').length, 2);
});

test('upstream redirect unwrapping', () => {
  const target = 'https://www.kernel.org/';
  const bing = `https://www.bing.com/ck/a?!&&p=abc&u=a1${Buffer.from(target).toString('base64url')}&ntb=1`;
  assert.equal(decodeBingUrl(bing), target);
  assert.equal(unwrapDdgUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fkernel.org&rut=x'), 'https://kernel.org');
  assert.equal(isDdgAd('https://duckduckgo.com/y.js?ad_domain=x'), true);
});

test('preferences round-trip through the cookie and ignore junk', () => {
  const engines = ['duckduckgo', 'bing', 'wikipedia'];
  const sources = ['piratebay', 'nyaa'];
  const prefs = { ...DEFAULT_PREFS, theme: 'midnight', region: 'de-de', safe: 'off', newTab: true, engines: ['bing'], torrents: [] };
  const cookie = `${COOKIE_NAME}=${serializePrefs(prefs)}`;
  const back = readPrefs(`other=1; ${cookie}`, engines, sources);
  assert.equal(back.theme, 'midnight');
  assert.equal(back.region, 'de-de');
  assert.equal(back.safe, 'off');
  assert.equal(back.newTab, true);
  assert.deepEqual(back.engines, ['bing']);
  assert.deepEqual(back.torrents, []);
  const junk = readPrefs(`${COOKIE_NAME}=${encodeURIComponent('th=<script>&kl=xx-xx&we=evil.bing')}`, engines, sources);
  assert.equal(junk.theme, DEFAULT_PREFS.theme);
  assert.equal(junk.region, DEFAULT_PREFS.region);
  assert.deepEqual(junk.engines, ['bing']);
  const merged = mergePrefs(DEFAULT_PREFS, new URLSearchParams('theme=dark'), engines, sources);
  assert.equal(merged.theme, 'dark');
  assert.deepEqual(merged.engines, DEFAULT_PREFS.engines);
});
