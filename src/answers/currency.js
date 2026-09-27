import { fetchUpstream } from '../http.js';
import { TTLCache } from '../util/cache.js';

// Official daily reference rates from the European Central Bank. No API key,
// no account, refreshed every few hours.
const CURRENCIES = {
  EUR: 'Euro', USD: 'US dollar', JPY: 'Japanese yen', CZK: 'Czech koruna', DKK: 'Danish krone',
  GBP: 'British pound', HUF: 'Hungarian forint', PLN: 'Polish złoty', RON: 'Romanian leu',
  SEK: 'Swedish krona', CHF: 'Swiss franc', ISK: 'Icelandic króna', NOK: 'Norwegian krone',
  TRY: 'Turkish lira', AUD: 'Australian dollar', BRL: 'Brazilian real', CAD: 'Canadian dollar',
  CNY: 'Chinese yuan', HKD: 'Hong Kong dollar', IDR: 'Indonesian rupiah', ILS: 'Israeli shekel',
  INR: 'Indian rupee', KRW: 'South Korean won', MXN: 'Mexican peso', MYR: 'Malaysian ringgit',
  NZD: 'New Zealand dollar', PHP: 'Philippine peso', SGD: 'Singapore dollar', THB: 'Thai baht',
  ZAR: 'South African rand', BGN: 'Bulgarian lev',
};

const ALIASES = {
  $: 'USD', 'us$': 'USD', dollar: 'USD', dollars: 'USD', buck: 'USD', bucks: 'USD',
  '€': 'EUR', euro: 'EUR', euros: 'EUR',
  '£': 'GBP', pound: 'GBP', pounds: 'GBP', quid: 'GBP', sterling: 'GBP',
  '¥': 'JPY', yen: 'JPY', yuan: 'CNY', rmb: 'CNY', renminbi: 'CNY',
  '₹': 'INR', rupee: 'INR', rupees: 'INR', '₩': 'KRW', won: 'KRW', '₺': 'TRY', lira: 'TRY',
  '₪': 'ILS', shekel: 'ILS', shekels: 'ILS', '฿': 'THB', baht: 'THB', franc: 'CHF', francs: 'CHF',
  real: 'BRL', reais: 'BRL', 'r$': 'BRL', peso: 'MXN', pesos: 'MXN', rand: 'ZAR',
  krona: 'SEK', kronor: 'SEK', krone: 'NOK', kroner: 'NOK', zloty: 'PLN', 'zł': 'PLN', forint: 'HUF',
  ringgit: 'MYR', rupiah: 'IDR', 'c$': 'CAD', 'ca$': 'CAD', 'a$': 'AUD', 'au$': 'AUD', 'nz$': 'NZD',
  'hk$': 'HKD', 's$': 'SGD',
};

const ratesCache = new TTLCache({ max: 1, ttl: 6 * 3600_000 });

async function getRates() {
  return ratesCache.wrap('ecb', async () => {
    const xml = await fetchUpstream('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', { timeout: 3000 });
    const rates = { EUR: 1 };
    for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates[m[1]] = parseFloat(m[2]);
    const date = (xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/) || [])[1] || '';
    if (Object.keys(rates).length < 10) throw new Error('unexpected ECB response');
    return { rates, date };
  });
}

function resolve(text) {
  const t = text.trim().toLowerCase().replace(/\.$/, '');
  if (/^[a-z]{3}$/.test(t) && CURRENCIES[t.toUpperCase()]) return t.toUpperCase();
  return ALIASES[t] || null;
}

const SYMBOLS = '[$€£¥₹₩₺₪฿]|[a-z]{1,2}\\$|zł';
const PATTERN = new RegExp(
  `^(?:convert\\s+)?(?:(${SYMBOLS})?\\s*(\\d[\\d,]*\\.?\\d*|\\.\\d+)\\s*)?(${SYMBOLS}|[a-z]{3,9})?\\s+(?:to|in|into|as|=|->|→)\\s+(${SYMBOLS}|[a-z]{3,9})\\??$`,
  'i',
);

// Returns null synchronously when the query isn't a currency conversion.
export function matchCurrency(query) {
  const m = query.trim().match(PATTERN);
  if (!m) return null;
  const [, prefixSymbol, amountText, fromText, toText] = m;
  const from = resolve(prefixSymbol || fromText || '');
  const to = resolve(toText);
  if (!from || !to || from === to) return null;
  const amount = amountText ? parseFloat(amountText.replace(/,/g, '')) : 1;
  if (!Number.isFinite(amount)) return null;
  return async () => {
    const { rates, date } = await getRates();
    if (!rates[from] || !rates[to]) return null;
    const rate = rates[to] / rates[from];
    const fmt = (n, code) => {
      const digits = ['JPY', 'KRW', 'IDR', 'ISK', 'HUF'].includes(code) ? 0 : 2;
      return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    };
    return {
      type: 'currency',
      from: { code: from, name: CURRENCIES[from], amount: fmt(amount, from) },
      to: { code: to, name: CURRENCIES[to], amount: fmt(amount * rate, to) },
      rate: rate.toPrecision(5),
      inverse: (1 / rate).toPrecision(5),
      date,
    };
  };
}
