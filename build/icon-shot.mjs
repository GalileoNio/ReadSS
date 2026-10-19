// Local visual-lab screenshot helper (build/ is gitignored).
//
//   node build/icon-shot.mjs --path /__icon-lab.html --width 1400 --height 1050 --shot build/shots/icon-lab.png
//
// Serves frontend/dist and captures with headless Edge over CDP. A unique
// user-data-dir per run avoids Edge handing the launch to an already-running
// browser (which silently skips --remote-debugging-port).
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'frontend', 'dist');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9444;
const HTTP_PORT = 8125;

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const strOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const width = argOf('width', 1400);
const height = argOf('height', 1050);
const delay = argOf('delay', 1200);
const pathArg = strOf('path', '/');
const shot = strOf('shot', 'build/shots/lab.png');
const evalArg = strOf('eval', '');
const clickArg = strOf('click', '');
const clickRow = strOf('clickRow', '');
const clickView = strOf('clickView', '');
const hoverArg = strOf('hover', '');
const hoverView = strOf('hoverView', '');
const reduced = process.argv.includes('--reduced');
const frame = argOf('frame', 0);
const clipArg = strOf('clip', '');
const scale = argOf('scale', 1);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/wails/')) {
      res.writeHead(404).end('not found');
      return;
    }
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || !path.extname(file)) file = path.join(DIST, 'index.html');
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
      `--window-size=${width},${height}`,
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
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  if (reduced) {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
  }
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}${pathArg}` });
  await sleep(delay);

  if (clickRow) {
    const clicked = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const el = [...document.querySelectorAll('.smart-row')]
          .find((b) => (b.textContent || '').includes(${JSON.stringify(clickRow)}));
        if (!el) return 'no smart row matching ' + ${JSON.stringify(clickRow)};
        el.click();
        return 'clicked: ' + el.textContent.trim();
      })()`,
      returnByValue: true,
    });
    console.log(`[clickRow] ${clicked.result.value}`);
  }

  if (clickView) {
    const clicked = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const el = [...document.querySelectorAll('.view-tab')]
          .find((b) => (b.textContent || '').includes(${JSON.stringify(clickView)})
                    || (b.getAttribute('title') || '').includes(${JSON.stringify(clickView)}));
        if (!el) return 'no view tab matching ' + ${JSON.stringify(clickView)};
        el.click();
        return 'clicked: ' + (el.getAttribute('title') || el.textContent || '').trim();
      })()`,
      returnByValue: true,
    });
    console.log(`[clickView] ${clicked.result.value}`);
  }

  if (clickArg) {
    const clicked = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const el = [...document.querySelectorAll('button')]
          .find((b) => (b.getAttribute('title') || '').includes(${JSON.stringify(clickArg)})
                    || (b.textContent || '').includes(${JSON.stringify(clickArg)}));
        if (!el) return 'no button matching ' + ${JSON.stringify(clickArg)};
        el.click();
        return 'clicked: ' + (el.getAttribute('title') || el.textContent || '').trim();
      })()`,
      returnByValue: true,
    });
    console.log(`[click] ${clicked.result.value}`);
    await sleep(500);
  }

  if (hoverView) {
    const found = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const el = [...document.querySelectorAll('.view-tab')]
          .find((b) => (b.textContent || '').includes(${JSON.stringify(hoverView)})
                    || (b.getAttribute('title') || '').includes(${JSON.stringify(hoverView)}));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: el.getAttribute('title') || el.textContent.trim() };
      })()`,
      returnByValue: true,
    });
    const point = found.result.value;
    if (!point) {
      console.log(`[hoverView] no view tab matching ${hoverView}`);
    } else {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y,
        button: 'none',
        pointerType: 'mouse',
      });
      console.log(`[hoverView] ${point.text} @ ${Math.round(point.x)},${Math.round(point.y)}`);
    }
  }

  if (hoverArg) {
    const found = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const el = [...document.querySelectorAll('.smart-row')]
          .find((b) => (b.textContent || '').includes(${JSON.stringify(hoverArg)}));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: el.textContent.trim() };
      })()`,
      returnByValue: true,
    });
    const point = found.result.value;
    if (!point) {
      console.log(`[hover] no smart row containing ${hoverArg}`);
    } else {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y,
        button: 'none',
        pointerType: 'mouse',
      });
      console.log(`[hover] ${point.text} @ ${Math.round(point.x)},${Math.round(point.y)}`);
    }
  }
  if (frame > 0) await sleep(frame);

  if (evalArg) {
    const evaluated = await cdp.send('Runtime.evaluate', {
      expression: evalArg,
      returnByValue: true,
      awaitPromise: true,
    });
    if (evaluated.exceptionDetails) console.error('[eval] threw:', evaluated.exceptionDetails.text);
    else console.log(JSON.stringify(evaluated.result.value, null, 1));
    await sleep(argOf('post', 300));
  }

  const out = path.resolve(ROOT, shot);
  await mkdir(path.dirname(out), { recursive: true });
  const params = { format: 'png', captureBeyondViewport: false };
  if (clipArg) {
    const [x, y, width, height] = clipArg.split(',').map(Number);
    params.clip = { x, y, width, height, scale };
  }
  const capture = await cdp.send('Page.captureScreenshot', params);
  await writeFile(out, Buffer.from(capture.data, 'base64'));
  console.log(`[shot] ${shot}`);

  cdp.close();
  browser.kill();
  server.close();
};

main().catch((err) => {
  console.error('[fatal]', err.message);
  server.close();
  process.exit(1);
});
