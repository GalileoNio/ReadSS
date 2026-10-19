// Bootstraps a local Go toolchain without relying on Windows schannel TLS.
// Node's own TLS stack works inside the sandbox, so we download with fetch().
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat, readdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const GO_VERSION = process.env.GO_VERSION || 'go1.26.8';
const ROOT = path.resolve(import.meta.dirname, '..');
const TOOLCHAIN = path.join(ROOT, '.toolchain');
const ZIP = path.join(TOOLCHAIN, `${GO_VERSION}.windows-amd64.zip`);
const DEST = path.join(TOOLCHAIN, 'go');
const GO_EXE = path.join(DEST, 'bin', 'go.exe');

const MIRRORS = [
  `https://go.dev/dl/${GO_VERSION}.windows-amd64.zip`,
  `https://dl.google.com/go/${GO_VERSION}.windows-amd64.zip`,
  `https://mirrors.aliyun.com/golang/${GO_VERSION}.windows-amd64.zip`,
];

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function download(url, out) {
  console.log(`[download] ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get('content-length') || 0);
  let seen = 0;
  let lastLog = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    seen += chunk.length;
    const now = Date.now();
    if (now - lastLog > 3000) {
      lastLog = now;
      const pct = total ? ((seen / total) * 100).toFixed(1) + '%' : '?';
      console.log(`[download] ${(seen / 1048576).toFixed(1)} MiB ${pct}`);
    }
  });
  await pipeline(body, createWriteStream(out));
  const size = (await stat(out)).size;
  if (size < 50 * 1024 * 1024) throw new Error(`suspiciously small archive: ${size} bytes`);
  console.log(`[download] done ${(size / 1048576).toFixed(1)} MiB`);
}

function extract(zipPath, destDir) {
  console.log(`[extract] ${zipPath} -> ${destDir}`);
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`,
  ], { stdio: 'inherit' });
}

async function main() {
  await mkdir(TOOLCHAIN, { recursive: true });
  if (await exists(GO_EXE)) {
    console.log('[skip] go.exe already present');
  } else {
    if (!(await exists(ZIP))) {
      let err;
      for (const url of MIRRORS) {
        try { await download(url, ZIP); err = null; break; } catch (e) { err = e; console.log(`[warn] ${e.message}`); }
      }
      if (err) throw err;
    } else {
      console.log('[skip] archive already present');
    }
    await rm(DEST, { recursive: true, force: true });
    extract(ZIP, TOOLCHAIN);
  }
  const version = execFileSync(GO_EXE, ['version'], { encoding: 'utf8' }).trim();
  console.log(`[ok] ${version}`);
  console.log(`[ok] GOROOT=${DEST}`);
  const env = execFileSync(GO_EXE, ['env', 'GOROOT', 'GOPATH'], { encoding: 'utf8' }).trim();
  console.log(env.split('\n').map((l) => `[env] ${l}`).join('\n'));
  console.log(`[entries] ${(await readdir(DEST)).join(', ')}`);
}

main().catch((e) => { console.error('[fatal]', e); process.exit(1); });
