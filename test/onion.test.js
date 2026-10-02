import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { parseAhmia, parseSeen } from '../src/engines/onion/ahmia.js';
import { mentionsAbuse, isExplicit, isBannedOnion, onionAddress } from '../src/privacy/abuse.js';
import { searchOnion } from '../src/search/onion.js';
import { cleanLink } from '../src/privacy/links.js';
import { DEFAULT_PREFS, getRegion } from '../src/prefs.js';

const ONION = 'duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion';

test('Ahmia results link straight to v3 onion sites', () => {
  const page = `<div class="resultsSubheader"><p>Displaying 3 matches</p></div><ol class="searchResults">
    <li class="result"><h4><a href="/search/redirect?search_term=privacy&amp;redirect_url=http://${ONION}/about/"> DuckDuckGo </a></h4>
      <p>Privacy, simplified.</p><cite>${ONION}</cite> — <span class="lastSeen" data-timestamp="Oct. 1, 2026, 8:15 a.m."> 0 minutes </span></li>
    <li class="result"><h4><a href="/search/redirect?search_term=privacy&amp;redirect_url=http://abcdefghijklmnop.onion/">Old address</a></h4><p>A v2 address.</p></li>
    <li class="result"><h4><a href="/search/redirect?search_term=privacy&amp;redirect_url=https://example.com/">Not an onion site</a></h4><p>x</p></li>
  </ol>`;
  assert.deepEqual(parseAhmia(page), [{ url: `http://${ONION}/about/`, title: 'DuckDuckGo', snippet: 'Privacy, simplified.', seen: Date.UTC(2026, 9, 1, 8, 15) }]);
  assert.equal(parseAhmia('<form id="searchForm"></form>'), null, 'Ahmia’s home page, sent when the search field has changed');
  const placeholder = `<ol class="searchResults"><li class="result"><h4><a href="/search/redirect?redirect_url=http://${ONION}/">Untitled</a></h4><p>No description provided</p></li></ol>`;
  assert.equal(parseAhmia(placeholder)[0].snippet, '', 'Ahmia’s placeholder isn’t a description');
  assert.equal(parseSeen('Sept. 30, 2026, noon'), Date.UTC(2026, 8, 30, 12));
  assert.equal(parseSeen('March 3, 2026, 4 p.m.'), Date.UTC(2026, 2, 3, 16));
  assert.equal(parseSeen('Oct. 1, 2026, 12:05 a.m.'), Date.UTC(2026, 9, 1, 0, 5));
  assert.equal(parseSeen('Oct. 1, 2026, midnight'), Date.UTC(2026, 9, 1, 0));
  assert.equal(parseSeen(''), 0);
});

test('onion links stay as they are', () => {
  const upgraded = cleanLink(`http://${ONION}/`, { https: 'upgrade', strip: 'known' });
  assert.equal(upgraded.url, `http://${ONION}/`, 'onion sites are encrypted by Tor, and most don’t serve HTTPS');
  assert.equal(cleanLink(`http://${ONION}/`, { https: 'mark', strip: 'known' }).insecure, false);
  assert.equal(cleanLink('http://example.com/', { https: 'upgrade', strip: 'known' }).url, 'https://example.com/');
});

test('sites on Ahmia’s list of banned onion sites are recognised', () => {
  const list = new Set([createHash('md5').update(ONION).digest('hex')]);
  assert.equal(onionAddress(`http://www.${ONION}/page`), ONION);
  assert.equal(isBannedOnion(`http://${ONION}/page`, list), true);
  assert.equal(isBannedOnion(`http://www.${ONION}/`, list), true, 'subdomains count');
  assert.equal(isBannedOnion(`http://${'a'.repeat(56)}.onion/`, list), false);
  assert.equal(isBannedOnion('https://example.com/', list), false);
  assert.equal(isBannedOnion(`http://${ONION}/`, null), false, 'before the list is in');
});

test('searches and results plainly about sexual material involving children are caught', () => {
  for (const text of ['child porn', 'CH1LD P0RN', 'pthc', '12yo nude', '12 yo nude', 'underage sex']) assert.equal(mentionsAbuse(text), true, text);
  for (const text of ['privacy forum', 'kids games', 'nude beach', 'tor hidden wiki', '18yo', 'cp24 news']) assert.equal(mentionsAbuse(text), false, text);
  assert.equal(isExplicit('free porn'), true);
  assert.equal(isExplicit('privacy forum'), false);
});

test('onion search: only over Tor, and never for abuse material', async () => {
  const ctx = (mode, query) => ({ network: { mode }, query, page: 1, safe: 'moderate', time: '', region: getRegion('wt-wt'), prefs: DEFAULT_PREFS });
  assert.equal((await searchOnion(ctx('direct', 'privacy forum'))).unavailable, true);
  const refused = await searchOnion(ctx('tor', 'child porn'));
  assert.equal(refused.refused, true);
  assert.deepEqual(refused.results, []);
});
