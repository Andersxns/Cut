import { randomBytes } from 'node:crypto';

const env = process.env;
const flag = (value, fallback) => (value === undefined ? fallback : /^(1|true|yes|on)$/i.test(value));

export const config = {
  port: Number(env.PORT) || 8080,
  // Bind to localhost by default. Set HOST=0.0.0.0 to expose Cut on your network.
  host: env.HOST || '127.0.0.1',
  // Signs image-proxy URLs so the proxy can't be abused as an open relay.
  // A random secret per process is fine: links simply expire on restart.
  secret: env.CUT_SECRET || randomBytes(32).toString('hex'),
  // Only honour X-Forwarded-* headers when running behind your own reverse proxy.
  trustProxy: flag(env.TRUST_PROXY, false),
  // Logs upstream engine failures (never queries or client addresses).
  debug: flag(env.DEBUG, false),
  // Development mode: static files are re-read on every request.
  dev: process.argv.includes('--dev') || flag(env.CUT_DEV, false),
  rateLimit: {
    enabled: flag(env.RATE_LIMIT, true),
    searchPerMinute: Number(env.RATE_LIMIT_SEARCH) || 40,
    suggestPerMinute: Number(env.RATE_LIMIT_SUGGEST) || 300,
  },
  resultTtl: 10 * 60_000,
};
