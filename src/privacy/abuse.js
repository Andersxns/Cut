import { createHash } from 'node:crypto';
import { fetchUpstream } from '../http.js';
import { AHMIA_ONION } from '../engines/onion/ahmia.js';

// Keeping child sexual abuse material out of onion search, three ways:
//
// 1. Ahmia, the onion search engine Cut asks, bans sites with such material
//    from its index.
// 2. Ahmia publishes the banned sites, as MD5 sums of their onion addresses,
//    for other search engines to filter with (https://ahmia.fi/blacklist/).
//    Cut drops every result on that list.
// 3. Searches plainly looking for such material get no results at all, and
//    results described in those terms are dropped.

// ---------- Ahmia's list of banned onion sites ----------

const LIST_TTL = 12 * 3600_000;
const RETRY_AFTER = 60_000; // e.g. while Tor is still connecting
let banned = null;
let nextFetch = 0;
let pending = null;

// The list, fetched over Tor from Ahmia's onion address and refreshed twice a
// day. Resolves to the last list Cut has (null before the first one is in).
export function bannedOnions(timeout) {
  if (Date.now() < nextFetch) return Promise.resolve(banned);
  pending ||= fetchUpstream(`${AHMIA_ONION}/blacklist/banned/`, { timeout, headers: { Accept: 'text/plain' } })
    .then((text) => {
      const hashes = text.split(/\s+/).filter((h) => /^[0-9a-f]{32}$/.test(h));
      if (hashes.length < 1000) throw new Error('the list looks incomplete');
      banned = new Set(hashes);
      nextFetch = Date.now() + LIST_TTL;
      return banned;
    })
    .catch(() => {
      nextFetch = Date.now() + RETRY_AFTER;
      return banned;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

// The onion address a URL points to, without subdomains: "abc….onion".
export function onionAddress(url) {
  try {
    const m = new URL(url).hostname.toLowerCase().match(/(?:^|\.)([a-z2-7]{16}|[a-z2-7]{56})\.onion$/);
    return m ? `${m[1]}.onion` : '';
  } catch {
    return '';
  }
}

export const onionHash = (address) => createHash('md5').update(address).digest('hex');

export function isBannedOnion(url, list) {
  const address = onionAddress(url);
  return Boolean(address && list?.has(onionHash(address)));
}

// ---------- Words ----------

// Words that on their own plainly mean sexual material involving children.
const ABUSE_WORDS = new Set([
  'childporn', 'kidporn', 'kiddieporn', 'pedoporn', 'pthc', 'jailbait', 'lolicon', 'shotacon', 'hurtcore', 'preteen', 'preteens',
  'pedo', 'pedos', 'pedophile', 'pedophiles', 'pedophilia', 'paedo', 'paedophile', 'paedophiles', 'paedophilia', 'csam', 'cp',
]);
// Words for a child, which with a sexual word make a search about abuse.
const CHILD_WORDS = new Set([
  'child', 'children', 'childs', 'kid', 'kids', 'kiddie', 'kiddy', 'underage', 'minor', 'minors', 'toddler', 'toddlers', 'infant',
  'infants', 'baby', 'babies', 'loli', 'lolis', 'lolita', 'shota', 'teen', 'teens', 'schoolgirl', 'schoolgirls', 'schoolboy', 'schoolboys',
]);
const SEXUAL_WORDS = new Set([
  'porn', 'porno', 'pornography', 'sex', 'sexual', 'sexy', 'nude', 'nudes', 'nudity', 'naked', 'xxx', 'rape', 'raped', 'fuck', 'fucked',
  'fucking', 'hentai', 'erotic', 'erotica', 'lewd', 'nsfw', 'pussy', 'cock', 'dick', 'cum', 'blowjob', 'orgasm', 'masturbation',
]);
const AGE_WORDS = new Set(['yo', 'y', 'yr', 'yrs', 'year', 'years']);

// Lower-case words, with digits standing in for letters read as letters
// ("ch1ld" → "child"), except in numbers.
function words(text) {
  return (String(text || '').toLowerCase().match(/[\p{L}\p{N}@$]+/gu) || []).map((w) =>
    /^\d+$/.test(w) || /^\d+[a-z]{1,5}$/.test(w) ? w : w.replace(/[013457@$]/g, (c) => ({ 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' })[c]),
  );
}

// An age under 18 ("12yo", "12 yo", "12 years").
function childAge(list, i) {
  const glued = list[i].match(/^(\d{1,2})(yo|y|yr|yrs|years?)$/);
  if (glued) return Number(glued[1]) < 18;
  return /^\d{1,2}$/.test(list[i]) && Number(list[i]) < 18 && AGE_WORDS.has(list[i + 1]);
}

// True when a search or a result is plainly about sexual material involving
// children.
export function mentionsAbuse(text) {
  const list = words(text);
  if (list.some((w) => ABUSE_WORDS.has(w))) return true;
  const child = list.some((w, i) => CHILD_WORDS.has(w) || childAge(list, i));
  return child && list.some((w) => SEXUAL_WORDS.has(w));
}

// True for sexual results, which strict safe search leaves out.
export const isExplicit = (text) => words(text).some((w) => SEXUAL_WORDS.has(w));
