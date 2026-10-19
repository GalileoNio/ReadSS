// Fails the build when icon usage drifts from DESIGN.md §7.
//
// The audit that produced §7 found real defects: the view-tab glyph function had
// no case for one of the VIEWS keys (so "视频" silently rendered the Inbox
// icon), and several icons carried two or three different meanings at once.
// Both are invisible in review and in type-checking, so they are checked here.
//
//   node scripts/check-icons.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TYPES = path.join(ROOT, 'frontend', 'src', 'lib', 'types.ts');
const ENTRY_LIST = path.join(ROOT, 'frontend', 'src', 'components', 'EntryList.tsx');
const ANIMATED = path.join(ROOT, 'frontend', 'src', 'components', 'AnimatedIcons.tsx');

/** The single source of truth from DESIGN.md §7.1, for the parts that are data. */
const VIEW_ICONS = {
  all: 'AnimatedHomeIcon',
  articles: 'AnimatedArticlesIcon',
  social: 'AnimatedSocialIcon',
  pictures: 'AnimatedPicturesIcon',
  videos: 'AnimatedVideosIcon',
};
/** Smart lists use motion variants of the canonical lucide glyph (DESIGN.md §7.5). */
const SMART_LIST_ICONS = {
  unread: 'SmartUnreadIcon',
  starred: 'SmartStarredIcon',
  readLater: 'SmartReadLaterIcon',
  today: 'SmartTodayIcon',
};
/** Icons retired by the audit: seeing one again means a regression. */
const RETIRED = ['Layers', 'CalendarPlus'];

const [typesSource, entryListSource, animatedSource] = await Promise.all([
  readFile(TYPES, 'utf8'),
  readFile(ENTRY_LIST, 'utf8'),
  readFile(ANIMATED, 'utf8'),
]);

const problems = [];

/* 1. Every VIEWS key must have an explicit glyph case. */
const viewsBlock = typesSource.match(/export const VIEWS[^=]*=\s*\[([\s\S]*?)\];/);
if (!viewsBlock) {
  problems.push('could not find the VIEWS table in frontend/src/lib/types.ts');
}
const viewKeys = viewsBlock
  ? [...viewsBlock[1].matchAll(/key:\s*'([a-zA-Z]+)'/g)].map((m) => m[1])
  : [];

const glyphBlock = entryListSource.match(/function ViewGlyph[\s\S]*?\n}/);
if (!glyphBlock) {
  problems.push('could not find ViewGlyph in EntryList.tsx');
}
const glyphCases = new Map();
if (glyphBlock) {
  for (const m of glyphBlock[0].matchAll(/case\s*'([a-zA-Z]+)':\s*\n?\s*return\s*<(\w+)/g)) {
    glyphCases.set(m[1], m[2]);
  }
}


for (const key of viewKeys) {
  const actual = glyphCases.get(key);
  if (!actual) {
    problems.push(
      `ViewGlyph has no explicit case for VIEWS key '${key}' — it would silently fall back to the default icon`,
    );
    continue;
  }
  const want = VIEW_ICONS[key];
  if (want && actual !== want) {
    problems.push(`view '${key}' uses ${actual}, DESIGN.md §7.1 says ${want}`);
  }
}

/* 2. No two view tabs may share a glyph, and each animated glyph must come
   from the shared module rather than being re-created inline. */
const seenGlyph = new Map();
for (const [key, icon] of glyphCases) {
  if (seenGlyph.has(icon)) {
    problems.push(`views '${seenGlyph.get(icon)}' and '${key}' share the icon ${icon}`);
  }
  seenGlyph.set(icon, key);
}
const viewImported = entryListSource.match(
  /import\s*\{([\s\S]*?)\}\s*from\s*'\.\/AnimatedIcons'/,
);
for (const [key, icon] of Object.entries(VIEW_ICONS)) {
  if (!viewImported) {
    problems.push('EntryList.tsx does not import the animated view icons');
    break;
  }
  if (!new RegExp(`\\b${icon}\\b`).test(viewImported[1])) {
    problems.push(`view '${key}' must import ${icon} from ./AnimatedIcons`);
  }
  if (!new RegExp(`export function ${icon}\\b`).test(animatedSource)) {
    problems.push(`AnimatedIcons.tsx does not export ${icon}`);
  }
}

/* 3. Smart lists must match the canonical mapping, and the animated variants
   must actually be imported from their own module (not re-created inline).
   They live in the list header's circular filter group (EntryList.tsx). */
const listsBlock = entryListSource.match(/const SMART_FILTERS[^=]*=\s*\[([\s\S]*?)\];/);
if (!listsBlock) {
  problems.push('could not find SMART_FILTERS in EntryList.tsx');
} else {
  const entries = [...listsBlock[1].matchAll(/scope:\s*'([a-zA-Z]+)'[\s\S]*?Icon:\s*(\w+)/g)];
  for (const [, scope, icon] of entries) {
    const want = SMART_LIST_ICONS[scope];
    if (want && icon !== want) {
      problems.push(`smart list '${scope}' uses ${icon}, DESIGN.md §7.5 says ${want}`);
    }
  }
  for (const scope of Object.keys(SMART_LIST_ICONS)) {
    if (!entries.some(([, s]) => s === scope)) {
      problems.push(`smart list '${scope}' is missing from the filter group`);
    }
  }

  const imported = entryListSource.match(
    /import\s*\{([\s\S]*?)\}\s*from\s*'\.\/AnimatedIcons'/,
  );
  for (const [scope, icon] of Object.entries(SMART_LIST_ICONS)) {
    if (!imported) {
      problems.push('EntryList.tsx does not import the animated smart-list icons');
      break;
    }
    if (!new RegExp(`\\b${icon}\\b`).test(imported[1])) {
      problems.push(`smart list '${scope}' must import ${icon} from ./AnimatedIcons`);
    }
    if (!new RegExp(`export function ${icon}\\b`).test(animatedSource)) {
      problems.push(`AnimatedIcons.tsx does not export ${icon}`);
    }
  }

}

/* 4. Retired icons must not come back anywhere in the frontend. */
const files = ['components/Sidebar.tsx', 'components/Reader.tsx', 'components/EntryList.tsx',
  'components/dialogs.tsx', 'components/CommandPalette.tsx', 'components/overlays.tsx',
  'components/primitives.tsx', 'App.tsx'];
for (const rel of files) {
  let source;
  try {
    source = await readFile(path.join(ROOT, 'frontend', 'src', rel), 'utf8');
  } catch {
    continue;
  }
  for (const icon of RETIRED) {
    // Only flag actual JSX usage, not a comment explaining the retirement.
    const used = new RegExp(`<${icon}[\\s/>]`).test(source);
    if (used) problems.push(`${rel} still uses the retired icon ${icon}`);
  }
}

console.log(
  `[icons] ${viewKeys.length} animated view tabs, ${glyphCases.size} glyph cases, ` +
    `${Object.keys(SMART_LIST_ICONS).length} animated smart lists, ${RETIRED.length} retired names`,
);

if (problems.length > 0) {
  console.error('\n[icons] FAILED:');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nSee DESIGN.md §7 for the canonical mapping.\n');
  process.exit(1);
}
console.log('[icons] OK');
