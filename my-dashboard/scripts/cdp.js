// Minimal Chrome DevTools Protocol client for the local perf scripts (Node >= 22, no deps).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LOCAL = ['127.0.0.1', 'localhost', '[::1]'];
function assertLocal(...urls) {
  for (const u of urls) {
    const host = new URL(u).hostname;
    if (!LOCAL.includes(host)) {
      console.error(`Refusing to run against non-local host ${host}.`);
      process.exit(2);
    }
  }
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    this.ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        this.handlers.forEach((h) => h(msg));
      }
    };
    this.ready = new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(fn) { this.handlers.push(fn); }
}

// Port 0: Chrome picks a free port and writes it to <profile>/DevToolsActivePort, so we never
// attach to some other Chrome that happens to be listening on a fixed port.
async function launch(_unused, size = '1280,800') {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'b4p-perf-'));
  const chrome = spawn(CHROME, [
    ...(process.env.HEADED ? [] : ['--headless=new']), '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    // Headless paces frames at 30 Hz; UNCAPPED=1 lets frames run as fast as the work allows.
    ...(process.env.UNCAPPED === '1' ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []),
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    `--window-size=${size}`, 'about:blank',
  ], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100; i += 1) {
    try {
      const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return { chrome, profile, wsUrl: page.webSocketDebuggerUrl };
    } catch { /* not up yet */ }
    await sleep(100);
  }
  chrome.kill();
  throw new Error('Chrome did not start');
}

async function shutdown(chrome, profile) {
  const exited = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await Promise.race([exited, sleep(5000)]);
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch { /* temp dir; the OS cleans it up */ }
}

module.exports = { CDP, launch, shutdown, sleep, assertLocal, CHROME };
