// Rasterises build/icons/appicon.svg to a transparent 1024px PNG with Edge.
//   node build/app-icon-render.mjs
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ICON = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'build', 'icons', 'appicon.svg');
const OUT = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(ROOT, 'build', 'icons', 'appicon-1024.png');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9466;
const HTTP_PORT = 8128;

const svg = await readFile(ICON, 'utf8');
const HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:1024px;height:1024px;background:transparent!important;overflow:hidden}
svg,img{display:block;width:1024px;height:1024px}</style></head>
<body>${svg}</body></html>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let nextId = 0;
    ws.addEventListener('open', () =>
      resolve({
        send(method, params = {}) {
          const id = ++nextId;
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close: () => ws.close(),
      }),
    );
    ws.addEventListener('error', () => reject(new Error('websocket error')));
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.error) entry.rej(new Error(msg.error.message));
      else entry.res(msg.result);
    });
  });
}

const main = async () => {
  await mkdir(path.join(ROOT, 'build', 'icons'), { recursive: true });
  await new Promise((resolve) => server.listen(HTTP_PORT, '127.0.0.1', resolve));

  const profile = path.join(ROOT, 'build', 'tmp', `edge-${randomUUID()}`);
  await mkdir(profile, { recursive: true });
  const browser = spawn(
    EDGE,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-crash-reporter',
      '--disable-extensions',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--window-size=1024,1024',
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  browser.on('error', () => {});

  let targets = [];
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await res.json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target; is Edge running?');

  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', {
    color: { r: 0, g: 0, b: 0, a: 0 },
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1024,
    height: 1024,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` });
  await sleep(900);

  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    omitBackground: true,
    clip: { x: 0, y: 0, width: 1024, height: 1024, scale: 1 },
  });
  await writeFile(OUT, Buffer.from(shot.data, 'base64'));
  console.log(`[icon] ${OUT}`);

  cdp.close();
  browser.kill();
  server.close();
};

main().catch((err) => {
  console.error('[fatal]', err.message);
  server.close();
  process.exit(1);
});
