import { calculate } from './calc.js';
import { convertUnits } from './units.js';
import { matchCurrency } from './currency.js';
import { matchWeather, matchWorldClock } from './weather.js';
import { matchDefinition } from './define.js';
import { MISC_ANSWERS } from './misc.js';

// Instant answers shown above web results. Local answers are computed
// immediately; network-backed ones (currency, weather, clock, dictionary)
// get a short deadline so they never hold up the page.

const ASYNC_MATCHERS = [matchCurrency, matchWeather, matchWorldClock, matchDefinition];
const DEADLINE = 3000;

export async function getInstantAnswer(ctx) {
  const query = ctx.query.trim();
  if (!query || query.length > 300) return null;
  for (const answer of [...MISC_ANSWERS, convertUnits, calculate]) {
    const result = answer(query, ctx);
    if (result) return result;
  }
  for (const match of ASYNC_MATCHERS) {
    const run = match(query, ctx);
    if (!run) continue;
    const timeout = new Promise((resolve) => setTimeout(resolve, DEADLINE, null).unref());
    return Promise.race([run().catch(() => null), timeout]);
  }
  return null;
}
