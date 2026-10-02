import * as cheerio from 'cheerio';
import { fetchUpstream, UpstreamError } from '../../http.js';
import { squash } from '../../util/text.js';

// Ahmia, the search engine for onion services, asked at its own onion address
// (so only over Tor). Ahmia keeps sites with child sexual abuse material out
// of its index; privacy/abuse.js adds Cut's own checks.

export const AHMIA_ONION = 'http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion';

// Ahmia's search form carries a hidden field, whose name and value change now
// and then, and a search has to send it back. Without it, Ahmia answers with
// its home page.
let formField = null;

async function searchField(timeout, fresh) {
  if (formField && !fresh) return formField;
  const page = await fetchUpstream(`${AHMIA_ONION}/`, { timeout });
  const input = cheerio.load(page)('#searchForm input[type="hidden"]').first();
  formField = { name: input.attr('name') || '', value: input.attr('value') || '' };
  return formField;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// When Ahmia last found the site up, as Django writes it: "Oct. 1, 2026,
// 8:15 a.m.", "Sept. 30, 2026, noon". Read as UTC.
export function parseSeen(text) {
  const m = String(text || '').toLowerCase().match(/^([a-z]+)\.? (\d{1,2}), (\d{4})(?:, (\d{1,2})(?::(\d{2}))? ?(a\.m\.|p\.m\.)|, (noon|midnight))?/);
  const month = m ? MONTHS.indexOf(m[1].slice(0, 3)) : -1;
  if (month < 0) return 0;
  const hour = m[4] ? (Number(m[4]) % 12) + (m[6] === 'p.m.' ? 12 : 0) : m[7] === 'noon' ? 12 : 0;
  return Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5] || 0));
}

const MAX_RESULTS = 200; // Ahmia sends every match on one page, often hundreds
const ONION_URL = /^https?:\/\/([a-z0-9-]+\.)*[a-z2-7]{56}\.onion(\/|$)/i; // v3 addresses only: v2 ones no longer work

// Results from Ahmia's results page, or null for any other page.
export function parseAhmia(page) {
  const $ = cheerio.load(page);
  if (!$('ol.searchResults, .resultsSubheader').length) return null;
  const results = [];
  $('li.result').each((_, el) => {
    if (results.length >= MAX_RESULTS) return false;
    const item = $(el);
    const link = item.find('h4 a').first();
    let url = '';
    try {
      // Links go through Ahmia's click counter; Cut links straight to the site.
      url = new URL(link.attr('href') || '', AHMIA_ONION).searchParams.get('redirect_url') || '';
    } catch {
      return;
    }
    if (!ONION_URL.test(url)) return;
    const snippet = squash(item.find('p').first().text());
    results.push({
      url,
      title: squash(link.text()) || url,
      snippet: /^no description provided\.?$/i.test(snippet) ? '' : snippet,
      seen: parseSeen(item.find('.lastSeen').attr('data-timestamp')),
    });
  });
  return results;
}

const DAYS = { d: '1', w: '7', m: '30' }; // Ahmia's "last seen" filter

export const ahmia = {
  id: 'ahmia',
  name: 'Ahmia',
  timeout: 8000, // three times as long over Tor; Ahmia itself takes a few seconds
  async search(p) {
    for (const fresh of [false, true]) {
      const field = await searchField(Math.round(p.timeout / 2), fresh);
      const params = new URLSearchParams({ q: p.query });
      if (field.name) params.set(field.name, field.value);
      if (DAYS[p.time]) params.set('d', DAYS[p.time]);
      const page = await fetchUpstream(`${AHMIA_ONION}/search/?${params}`, { timeout: p.timeout, headers: { Referer: `${AHMIA_ONION}/` } });
      const results = parseAhmia(page);
      if (!results) continue; // the field had changed: fetch it again
      const yearAgo = Date.now() - 365 * 86_400_000;
      return p.time === 'y' ? results.filter((r) => !r.seen || r.seen > yearAgo) : results;
    }
    throw new UpstreamError('unexpected page', { code: 'parse' });
  },
};
