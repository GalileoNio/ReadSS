// Reports layout overflow from the real DOM, using headless Edge's DevTools
// protocol, and can also capture a screenshot at the emulated size.
//
//   node scripts/measure-dom.mjs --width 390 --height 844 --extra "list=1"
//   node scripts/measure-dom.mjs --width 390 --shot build/shots/x.png
//
// Screenshots go through CDP rather than --window-size because Chromium
// enforces a minimum window width on Windows (around 500px), so a
// --window-size=390 capture silently crops a ~500px-wide layout.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'frontend', 'dist');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const strOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const width = argOf('width', 390);
const height = argOf('height', 844);
const extra = strOf('extra', '');
const theme = strOf('theme', 'dark');
// An alternative page under dist/, for harness pages that render stored markup.
const altPath = strOf('path', '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
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

/** Launches the browser without waiting for it to exit. */
function launch(cmd, args) {
  const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  return child;
}

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

/** Runs in the page: describes every offending element. */
const PROBE = `(() => {
  const vw = document.documentElement.clientWidth;
  const describe = (el) => {
    const cls = (typeof el.className === 'string' ? el.className : '').slice(0, 90);
    return el.tagName.toLowerCase() + (cls ? '.' + cls.trim().split(/\\s+/).slice(0, 4).join('.') : '');
  };
  const overflow = [];
  const outside = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      overflow.push({ el: describe(el), scrollW: el.scrollWidth, clientW: el.clientWidth });
    }
    if (r.right > vw + 1) {
      outside.push({ el: describe(el), right: Math.round(r.right), width: Math.round(r.width) });
    }
  }
  return JSON.stringify({
    viewport: vw,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    overflow: overflow.slice(0, 12),
    outside: outside.slice(0, 12),
  }, null, 1);
})()`;

const main = async () => {
  await new Promise((resolve) => server.listen(8124, '127.0.0.1', resolve));

  const browser = launch(EDGE, [
    '--headless=new',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-crash-reporter',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ROOT, '.toolchain', 'edge-measure')}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ]);

  let targets = [];
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await res.json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch {
      /* not up yet */
    }
    await sleep(400);
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target; is Edge running?');

  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // The window size does not always equal the layout viewport, so set it.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', {
    url: altPath
      ? `http://127.0.0.1:8124${altPath}`
      : `http://127.0.0.1:8124/?theme=${theme}&${extra}`,
  });
  await sleep(2500);

  // Optionally click something first, so states that need interaction (the
  // docked comment pane on a phone, which starts hidden) can be measured and
  // captured rather than guessed at.
  const clickArg = strOf('click', '');
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
    await sleep(700);
  }

  const result = await cdp.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
  console.log(result.result.value);

  // A one-off expression to inspect the live DOM (computed styles, geometry),
  // which is how layout questions get answered instead of guessed at.
  const evalArg = strOf('eval', '');
  if (evalArg) {
    const evaluated = await cdp.send('Runtime.evaluate', {
      expression: evalArg,
      returnByValue: true,
      awaitPromise: true,
    });
    if (evaluated.exceptionDetails) {
      console.error('[eval] threw:', evaluated.exceptionDetails.text);
    } else {
      const value = evaluated.result.value;
      console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 1));
    }
  }

  // Scroll the reader before capturing, so lower sections can be inspected.
  // The entry list also has a scrollbar, so walk up from the article instead
  // of taking the first scrollable element in the document.
  const scroll = argOf('scroll', 0);
  if (scroll > 0) {
    const scrolled = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        let el = document.querySelector('.article-content');
        while (el && el !== document.body) {
          const style = getComputedStyle(el);
          if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 10) break;
          el = el.parentElement;
        }
        if (!el || el === document.body) return 'no reader scroll container';
        el.scrollTop = ${scroll};
        return 'scrolled to ' + el.scrollTop + ' of ' + el.scrollHeight;
      })()`,
      returnByValue: true,
    });
    console.log(`[scroll] ${scrolled.result.value}`);
    await sleep(400);
  }

  const shotPath = strOf('shot', '');
  if (shotPath) {
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    await writeFile(path.resolve(ROOT, shotPath), Buffer.from(shot.data, 'base64'));
    console.log(`[shot] ${shotPath}`);
  }

  cdp.close();
  browser.kill();
  server.close();
};

main().catch((err) => {
  console.error('[fatal]', err.message);
  server.close();
  process.exit(1);
});
