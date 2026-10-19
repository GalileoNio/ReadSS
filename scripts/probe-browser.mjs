// Does a real browser get through the 36kr WAF, and what does /feed return then?
// Usage: node scripts/probe-browser.mjs <url> [waitMs]
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const url = process.argv[2];
const waitMs = Number(process.argv[3] ?? 9000);
if (!url) throw new Error('usage: probe-browser.mjs <url> [waitMs]');

const port = 9333;
const profile = mkdtempSync(path.join(tmpdir(), 'kr-probe-'));
const child = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
);
child.on('error', () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('devtools not reachable');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let id = 0;
    ws.addEventListener('open', () =>
      resolve({
        send(method, params = {}) {
          const n = ++id;
          return new Promise((res, rej) => {
            pending.set(n, { res, rej });
            ws.send(JSON.stringify({ id: n, method, params }));
          });
        },
      }),
    );
    ws.addEventListener('error', reject);
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      }
    });
  });
}

const page = await target();
const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Network.enable').catch(() => {});

// Record the main document response so the content type is known.
let mainType = '?';
await cdp.send('Network.enable').then(() => {
  // No event plumbing here; read from performance instead.
});

await cdp.send('Page.navigate', { url });
await sleep(waitMs);

const probe = await cdp.send('Runtime.evaluate', {
  expression: `(() => {
    const dt = performance.getEntriesByType('navigation')[0] || {};
    const text = (document.body ? document.body.innerText : '').trim();
    return JSON.stringify({
      url: location.href,
      title: document.title,
      textHead: text.slice(0, 300),
      textLen: text.length,
      isXml: text.trimStart().startsWith('<'),
      hasChallenge: !!document.getElementById('__waf_verification_challenge'),
      cookie: document.cookie.slice(0, 200),
      status: dt.responseStatus ?? null,
      transferSize: dt.transferSize ?? null,
    }, null, 1);
  })()`,
  returnByValue: true,
});
console.log(probe.result.value);

// If the document became XML, the browser shows a source view; sample its text.
const sample = await cdp.send('Runtime.evaluate', {
  expression: `(document.documentElement ? document.documentElement.outerHTML : '').slice(0, 400)`,
  returnByValue: true,
});
console.log('--- dom head ---');
console.log(sample.result.value);

child.kill();
process.exit(0);
