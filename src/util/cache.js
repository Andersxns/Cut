import { createHash, randomBytes } from 'node:crypto';

// Keys are hashed with a per-process salt, so even a memory dump of the
// cache never contains a readable search query as a key.
const SALT = randomBytes(16);
export const cacheKey = (...parts) =>
  createHash('sha256').update(SALT).update(parts.map((p) => String(p ?? '')).join('␟')).digest('base64url');

// Small in-memory LRU with per-entry TTL and in-flight request sharing.
export class TTLCache {
  constructor({ max = 500, ttl = 10 * 60_000 } = {}) {
    this.max = max;
    this.ttl = ttl;
    this.map = new Map();
    this.pending = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, ttl = this.ttl) {
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + ttl });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }

  // Returns the cached value or runs `producer` once, sharing the promise
  // between concurrent callers. Failures are never cached.
  async wrap(key, producer, ttl = this.ttl) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = (async () => {
      try {
        const value = await producer();
        this.set(key, value, ttl);
        return value;
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, promise);
    return promise;
  }
}
