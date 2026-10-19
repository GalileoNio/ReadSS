// Serves frontend/dist over HTTP and screenshots it with headless Edge.
//
// This renders the real production bundle in a browser, where the app falls
// back to its built-in mock backend (no Wails bridge), so the layout can be
// verified without opening the desktop window.
//
//   node scripts/shoot-ui.mjs               # dark + light, wide
//   node scripts/shoot-ui.mjs --width 1280
import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'frontend', 'dist');
const OUT_DIR = path.join(ROOT, 'build', 'shots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

/**
 * Runs a command with stdio ignored.
 *
 * The DSH Windows sandbox blocks child processes that use piped stdio, so the
 * browser is spawned without capturing its output.
 */
function runQuiet(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`exited with code ${code}`));
    });
  });
}

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const width = argOf('width', 1512);
const height = argOf('height', 950);
const prefixIdx = process.argv.indexOf('--prefix');
const prefix = prefixIdx >= 0 && process.argv[prefixIdx + 1] ? `${process.argv[prefixIdx + 1]}-` : '';
// Extra query parameters, e.g. --extra "list=1" to capture the list-only view.
const extraIdx = process.argv.indexOf('--extra');
const extra = extraIdx >= 0 && process.argv[extraIdx + 1] ? `&${process.argv[extraIdx + 1]}` : '';
// An alternative page under dist/, e.g. --path /__comments.html to capture a
// harness page that renders stored markup with the real stylesheet. Such a page
// links the built CSS itself, so no theme query is appended.
const pathIdx = process.argv.indexOf('--path');
const altPath = pathIdx >= 0 && process.argv[pathIdx + 1] ? process.argv[pathIdx + 1] : null;
// With --path, skip the theme sweep unless a single theme was asked for.
const onlyIdx = process.argv.indexOf('--theme');
const onlyTheme = onlyIdx >= 0 && process.argv[onlyIdx + 1] ? process.argv[onlyIdx + 1] : null;

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

    // The Wails IPC endpoint must 404 here: the SPA fallback below would
    // otherwise answer it with index.html and make the app think a real
    // backend is present.
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

const shoot = async (name, theme) => {
  const out = path.join(OUT_DIR, `${prefix}${name}.png`);
  await runQuiet(
    EDGE,
    [
      '--headless=new',
      // Chromium's own sandbox cannot initialise inside the DSH Windows
      // sandbox; disabling it is required for headless capture here.
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-crash-reporter',
      '--disable-extensions',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--force-device-scale-factor=1',
      `--window-size=${width},${height}`,
      `--screenshot=${out}`,
      `--user-data-dir=${path.join(ROOT, '.toolchain', 'edge-profile')}`,
      '--virtual-time-budget=4000',
      altPath ? `http://127.0.0.1:8123${altPath}` : `http://127.0.0.1:8123/?theme=${theme}${extra}`,
    ],
    120000,
  );
  const info = await stat(out);
  console.log(`[ok] ${name} (${theme}) ${(info.size / 1024).toFixed(1)} KiB`);
};

const main = async () => {
  await mkdir(OUT_DIR, { recursive: true });
  await new Promise((resolve) => server.listen(8123, '127.0.0.1', resolve));
  console.log(`[serve] http://127.0.0.1:8123 -> ${DIST}`);

  if (altPath) {
    // The harness page states its own theme via <html class="dark">.
    await shoot(path.basename(altPath, '.html').replace(/^__/, ''), onlyTheme ?? 'dark');
  } else {
    await shoot('app-dark', 'dark');
    await shoot('app-light', 'light');
  }

  server.close();
};

main().catch((err) => {
  console.error('[fatal]', err.message);
  server.close();
  process.exit(1);
});
