import { config } from '../config.js';
import { TTLCache, cacheKey } from '../util/cache.js';
import { UpstreamError } from '../http.js';

// Per-engine result cache. Keeping results per engine (rather than per merged
// page) means a flaky engine is retried next time instead of being cached as
// "missing" alongside the engines that did answer.
const engineCache = new TTLCache({ max: 3000, ttl: config.resultTtl });

// Once the core engines have answered (or, when none are marked core, half of
// them) and there is something to show, the rest get a short grace period
// instead of their full timeout. Over Tor a stalled minor engine would
// otherwise hold every page for its whole (tripled) timeout. Late engines keep
// running in the background and fill the cache, so a repeat search has them.
const GRACE_MIN = 800;
const GRACE_MAX = 3000;
export const graceFor = (elapsed) => Math.min(Math.max(elapsed * 0.5, GRACE_MIN), GRACE_MAX);

// Resolves to the promise's value, or to `fallback` if it isn't ready in time.
export const within = (promise, ms, fallback) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms, fallback).unref())]);

function untilEnough(engines, tasks, outcomes, started) {
  const core = engines.flatMap((e, i) => (e.core ? [i] : []));
  const quorum = Math.ceil(engines.length / 2);
  return new Promise((resolve) => {
    let timer = null;
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      const settled = outcomes.filter(Boolean);
      if (settled.length === engines.length) return done();
      if (timer) return;
      const coreSettled = core.length ? core.every((i) => outcomes[i]) : settled.length >= quorum;
      if (coreSettled && settled.some((o) => o.ok && o.results.length)) timer = setTimeout(done, graceFor(Date.now() - started));
    };
    for (const task of tasks) task.then(check);
    check();
  });
}

// validate(results) may reject an engine's answer (e.g. unrelated results);
// a rejected answer counts as a failure and isn't cached.
export async function runEngines(kind, engines, params, { validate } = {}) {
  const started = Date.now();
  const signature = JSON.stringify([params.query, params.page, params.region.code, params.safe, params.time, params.extra || null]);
  const outcomes = new Array(engines.length);
  const tasks = engines.map(async (engine, i) => {
    const t0 = Date.now();
    try {
      const results = await engineCache.wrap(cacheKey(kind, engine.id, signature), async () => {
        const answer = await engine.search({ ...params, timeout: engine.timeout });
        const problem = validate?.(answer);
        if (problem) throw new UpstreamError(problem, { code: 'offtopic' });
        return answer;
      });
      outcomes[i] = { engine, ok: true, results, ms: Date.now() - t0 };
    } catch (err) {
      if (config.debug) console.warn(`[${kind}:${engine.id}] ${err.code || 'error'} — ${err.message}`);
      outcomes[i] = { engine, ok: false, error: err.code || 'error', results: [], ms: Date.now() - t0 };
    }
  });
  await untilEnough(engines, tasks, outcomes, started);
  const ms = Date.now() - started;
  return {
    outcomes: engines.map((engine, i) => {
      if (outcomes[i]) return outcomes[i];
      if (config.debug) console.warn(`[${kind}:${engine.id}] late — still running after ${ms} ms, not waiting`);
      return { engine, ok: false, error: 'late', results: [], ms };
    }),
    ms,
  };
}

// Compact per-engine status, used to explain an empty results page.
export const summarize = (outcomes) =>
  outcomes.map(({ engine, ok, error, results, ms }) => ({ id: engine.id, name: engine.name, ok, error, count: results.length, ms }));
