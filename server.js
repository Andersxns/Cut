import http from 'node:http';
import path from 'node:path';
import module from 'node:module';
import { config } from './src/config.js';

// Inside Cut Browser, cache compiled code between runs so later starts are
// quicker.
if (process.env.CUT_DATA_DIR) module.enableCompileCache?.(path.join(process.env.CUT_DATA_DIR, 'compile-cache'));

// Listen first, then load the app: its dependencies take a few seconds to
// load on a cold start (and loading holds up everything else), so requests
// that arrive in the meantime simply wait for it.
let app = null;
const loadApp = () =>
  (app ||= import('./src/app.js').catch((err) => {
    console.error(`[cut] Couldn't load Cut: ${err.stack || err}`);
    process.exit(1);
  }));

// Note what's missing: there is no request logger. Cut never records who
// searched for what.
const server = http.createServer((req, res) => {
  loadApp().then(({ handle }) => handle(req, res));
});
server.keepAliveTimeout = 30_000;
server.headersTimeout = 35_000;
server.requestTimeout = 60_000;

server.on('error', (err) => {
  console.error(`[cut] ${err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use` : err.message}`);
  process.exit(err.code === 'EADDRINUSE' ? 3 : 1);
});

server.listen(config.port, config.host, () => {
  const host = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  // Cut Browser waits for this exact line to know the server is ready.
  if (process.env.CUT_EMBEDDED) console.log(`CUT_READY ${config.port}`);
  else console.log(`\n  Cut is running → http://${host}:${config.port}${config.dev ? '  (dev mode)' : ''}\n`);
  setImmediate(loadApp);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}

// Inside Cut Browser the server lives only as long as the browser does, even
// if the browser crashes and can't stop it.
const parent = Number(process.env.CUT_PARENT_PID);
if (parent > 0) {
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch (err) {
      if (err.code !== 'EPERM') process.exit(0);
    }
  }, 3000).unref();
}
