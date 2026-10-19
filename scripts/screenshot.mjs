// Captures a screenshot of the running ReadS window through the WebView2
// DevTools protocol.
//
// Requires the app to be started with READS_DEBUG_PORT set, e.g.
//   $env:READS_DEBUG_PORT = '9222'; .\build\bin\ReadS.exe
//
//   node scripts/screenshot.mjs <port> <out.png> [--width 1440] [--height 900]
import { writeFileSync } from 'node:fs';

const port = Number(process.argv[2] || 9222);
const out = process.argv[3] || 'screenshot.png';
const argOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const width = argOf('width', 1440);
const height = argOf('height', 900);

const listTargets = async () => {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`devtools endpoint returned ${res.status}`);
  return res.json();
};

/** Minimal CDP client over the target's WebSocket. */
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
    ws.addEventListener('error', (e) => reject(new Error(`websocket error: ${e.message ?? ''}`)));
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.error) entry.rej(new Error(`${msg.error.message} (${msg.error.code})`));
      else entry.res(msg.result);
    });
  });
}

const main = async () => {
  // The window can take a moment to register with the DevTools endpoint.
  let targets = [];
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      targets = await listTargets();
      if (targets.some((t) => t.type === 'page')) break;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target found — is the app running with READS_DEBUG_PORT?');
  console.log(`[cdp] target: ${page.title || '(untitled)'} ${page.url}`);

  const cdp = await connect(page.webSocketDebuggerUrl);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // Report whether the React tree actually mounted, before trusting the pixels.
  const probe = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      root: !!document.getElementById('root'),
      children: document.getElementById('root')?.children.length ?? 0,
      asides: document.querySelectorAll('aside').length,
      headers: document.querySelectorAll('header').length,
      text: (document.body.innerText || '').slice(0, 300)
    })`,
    returnByValue: true,
  });
  console.log('[dom]', probe.result.value);

  // Let fonts, layout and the initial data fetch settle.
  await new Promise((r) => setTimeout(r, 1200));

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`[ok] wrote ${out}`);

  cdp.close();
};

main().catch((err) => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
