import { AsyncLocalStorage } from 'node:async_hooks';

// Per-request upstream context (Tor circuit isolation key, privacy headers),
// carried implicitly through every await so engines don't need to pass it on.
const storage = new AsyncLocalStorage();

export const currentContext = () => storage.getStore() || {};
export const runWithContext = (context, fn) => storage.run({ ...currentContext(), ...context }, fn);
