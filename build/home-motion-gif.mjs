// Builds a frame sequence for the home-icon motion preview, then a GIF.
//   node build/home-motion-gif.mjs
// Frames are rendered from a paused CSS animation with negative delays, so the
// result is deterministic and matches index.css exactly.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'frontend', 'dist');
const FRAMES = path.join(ROOT, 'build', 'shots', 'home-motion');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9455;
const HTTP_PORT = 8126;

const HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Home motion</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; width: 200px; height: 170px; background: #161719; display: flex;
    align-items: center; justify-content: center;
    font-family: "Segoe UI", "PingFang SC", system-ui, sans-serif; }
  .stage { width: 140px; height: 140px; display: flex; align-items: center; justify-content: center; }
  .hover { width: 76px; height: 76px; border-radius: 999px; display: flex; align-items: center;
    justify-content: center; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.10); }
  .icon { color: #FF5C00; }
  svg { display: block; overflow: visible; }
  .anim { --t: 0ms; }

  .anim svg { animation: icon-settle 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: var(--t); animation-play-state: paused; }
  .anim .vi-home { transform-box: fill-box; transform-origin: 50% 100%; animation: home-hop 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: var(--t); animation-play-state: paused; }
  .anim .vi-home-eyes { transform-box: fill-box; transform-origin: center; animation: home-blink 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: calc(var(--t) + 160ms); animation-play-state: paused; }
  .anim .vi-home-smile { transform-box: fill-box; transform-origin: center; animation: home-smile 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: calc(var(--t) + 60ms); animation-play-state: paused; }

  @keyframes icon-settle { 0% { transform: scale(1); } 30% { transform: scale(.93); } 62% { transform: scale(1.05); } 100% { transform: scale(1); } }
  @keyframes home-hop {
    0% { transform: translateY(0) scale(1,1) rotate(0); }
    12% { transform: translateY(.6px) scale(1.06,.88) rotate(0); }
    30% { transform: translateY(-2.6px) scale(.96,1.08) rotate(-2.5deg); }
    48% { transform: translateY(-3px) scale(1,1.02) rotate(-1deg); }
    64% { transform: translateY(0) scale(1.08,.9) rotate(1.5deg); }
    80% { transform: translateY(-.7px) scale(.98,1.02) rotate(-.5deg); }
    100% { transform: translateY(0) scale(1,1) rotate(0); }
  }
  @keyframes home-blink {
    0%, 20% { transform: scaleY(1); }
    38% { transform: scaleY(.18); }
    52% { transform: scaleY(1.12); }
    66%, 100% { transform: scaleY(1); }
  }
  @keyframes home-smile {
    0%, 15% { transform: scaleX(1); }
    35% { transform: scaleX(1.25); }
    55% { transform: scaleX(1.3); }
    72%, 100% { transform: scaleX(1); }
  }
</style></head>
<body><div class="stage"><div class="hover anim"><div class="icon">
<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <g class="vi-home">
    <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <g class="vi-home-face">
      <g class="vi-home-eyes">
        <circle cx="9.2" cy="14" r="1.15" fill="currentColor" stroke="none"/>
        <circle cx="14.8" cy="14" r="1.15" fill="currentColor" stroke="none"/>
      </g>
      <path class="vi-home-smile" d="M8.7 17c.9 1.3 2.1 1.9 3.3 1.9s2.4-.6 3.3-1.9" stroke-width="1.8"/>
    </g>
  </g>
</svg></div></div></div></body></html>`;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || !path.extname(file)) file = path.join(DIST, '__home-motion.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
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
  await mkdir(DIST, { recursive: true });
  await writeFile(path.join(DIST, '__home-motion.html'), HTML);
  await rm(FRAMES, { recursive: true, force: true });
  await mkdir(FRAMES, { recursive: true });
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
      '--window-size=200,170',
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
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 200, height: 170, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` });
  await sleep(700);

  const times = [];
  for (let t = 0; t <= 620; t += 40) times.push(t);
  for (const [i, t] of times.entries()) {
    await cdp.send('Runtime.evaluate', {
      expression: `document.querySelectorAll('.anim').forEach((el) => el.style.setProperty('--t', '-${t}ms'))`,
      returnByValue: true,
    });
    await sleep(40);
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: { x: 10, y: 5, width: 180, height: 160, scale: 3 },
    });
    await writeFile(path.join(FRAMES, `frame-${String(i).padStart(2, '0')}.png`), Buffer.from(shot.data, 'base64'));
  }

  cdp.close();
  browser.kill();
  server.close();
  console.log(`[frames] ${times.length} frames -> ${FRAMES}`);
};

main().catch((err) => {
  console.error('[fatal]', err.message);
  server.close();
  process.exit(1);
});
