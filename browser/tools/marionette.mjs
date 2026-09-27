import net from 'node:net';

// A minimal Marionette client (Firefox's remote-control protocol), used to
// test Cut Browser: run code in the browser's chrome and take screenshots.

export class Marionette {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 1;
    this.handshake = null;
    socket.on('data', (chunk) => this.#receive(chunk));
  }

  static async connect(port = 2828, { timeout = 60000 } = {}) {
    const deadline = Date.now() + timeout;
    while (true) {
      try {
        const socket = await new Promise((resolve, reject) => {
          const s = net.connect(port, '127.0.0.1', () => resolve(s));
          s.once('error', reject);
        });
        const client = new Marionette(socket);
        await new Promise((resolve, reject) => {
          if (client.handshake) return resolve();
          const t = setTimeout(() => reject(new Error('no handshake')), 20000);
          client.onHandshake = () => {
            clearTimeout(t);
            resolve();
          };
        });
        return client;
      } catch (e) {
        if (Date.now() > deadline) throw new Error(`Marionette didn't answer on port ${port}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  #receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const colon = this.buffer.indexOf(':');
      if (colon < 0) return;
      const length = Number(this.buffer.toString('latin1', 0, colon));
      if (this.buffer.length < colon + 1 + length) return;
      const message = JSON.parse(this.buffer.toString('utf8', colon + 1, colon + 1 + length));
      this.buffer = this.buffer.subarray(colon + 1 + length);
      if (!Array.isArray(message)) {
        this.handshake = message;
        this.onHandshake?.();
        continue;
      }
      const [, id, error, result] = message;
      const waiter = this.pending.get(id);
      if (!waiter) continue;
      this.pending.delete(id);
      if (error) waiter.reject(new Error(`${error.error}: ${error.message}${error.stacktrace ? `\n${error.stacktrace}` : ''}`));
      else waiter.resolve(result);
    }
  }

  send(command, params = {}) {
    const id = this.nextId++;
    const body = Buffer.from(JSON.stringify([0, id, command, params]), 'utf8');
    this.socket.write(`${body.length}:`);
    this.socket.write(body);
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async session() {
    await this.send('WebDriver:NewSession', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
  }

  async context(value) {
    await this.send('Marionette:SetContext', { value });
  }

  // Runs `body` (an async function body) and returns its value.
  async execute(body, args = []) {
    const script = `return (async (...args) => {\n${body}\n})(...arguments);`;
    const result = await this.send('WebDriver:ExecuteScript', { script, args });
    return result?.value;
  }

  async screenshot() {
    const result = await this.send('WebDriver:TakeScreenshot', { full: false, hash: false });
    return Buffer.from(result.value, 'base64');
  }

  async quit() {
    try {
      await this.send('Marionette:Quit', { flags: ['eForceQuit'] });
    } catch {}
    this.socket.destroy();
  }

  close() {
    this.socket.destroy();
  }
}
