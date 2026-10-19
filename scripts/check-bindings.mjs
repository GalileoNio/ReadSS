// Fails the build when the frontend calls a Wails binding that does not exist.
//
// Wails v3 keys bindings by the exact Go method name
// (`reads/internal/service.Service.<Method>`), and the lookup is
// case-sensitive. A typo such as `AddFeedByUrl` for `AddFeedByURL` therefore
// compiles, type-checks and ships, then fails at runtime with
// "unknown bound method name" — invisible to any test that calls the Go method
// directly, and invisible to a case-insensitive search.
//
//   node scripts/check-bindings.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SERVICE_GO = path.join(ROOT, 'internal', 'service', 'service.go');
const API_TS = path.join(ROOT, 'frontend', 'src', 'lib', 'api.ts');

/** Exported methods on *Service, matched case-sensitively. */
function goMethods(source) {
  const names = new Set();
  const re = /^func \(s \*Service\) ([A-Z][A-Za-z0-9_]*)\(/gm;
  for (const m of source.matchAll(re)) names.add(m[1]);
  return names;
}

/** Method names passed to call(...) / call<T>(...) in the frontend. */
function jsCalls(source) {
  const names = new Set();
  const re = /\bcall(?:<[^>]*>)?\(\s*'([A-Za-z0-9_]+)'/g;
  for (const m of source.matchAll(re)) names.add(m[1]);
  return names;
}

const [goSource, tsSource] = await Promise.all([
  readFile(SERVICE_GO, 'utf8'),
  readFile(API_TS, 'utf8'),
]);

const go = goMethods(goSource);
const js = jsCalls(tsSource);

const missing = [...js].filter((name) => !go.has(name)).sort();
const unused = [...go].filter((name) => !js.has(name)).sort();

console.log(`[bindings] ${js.size} frontend calls, ${go.size} exported service methods`);

if (missing.length > 0) {
  console.error('\n[bindings] FAILED: the frontend calls methods that do not exist.');
  for (const name of missing) {
    // Case-insensitive closest match is the usual cause and the usual fix.
    const near = [...go].filter((g) => g.toLowerCase() === name.toLowerCase());
    console.error(near.length ? `  ${name}  ->  did you mean ${near.join(', ')}?` : `  ${name}`);
  }
  console.error('');
  process.exit(1);
}

if (unused.length > 0) {
  // Informational: some methods are internal entry points (ServiceStartup,
  // ServiceShutdown) or called through other bindings.
  console.log(`[bindings] not called from the frontend: ${unused.join(', ')}`);
}
console.log('[bindings] OK');
