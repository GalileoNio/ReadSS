// Generates the throwaway icon-motion lab page served from frontend/dist.
//   node build/icon-lab.mjs
// The page mirrors the app CSS and freezes animation frames with negative
// delays, so shapes and intermediate poses can be checked at real size.
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'frontend', 'dist', '__icon-lab.html');

const svg = (inner, size, extra = '') =>
  `<svg class="smart-icon" ${extra} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${size >= 40 ? 1.7 : 1.9}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const ICONS = {
  unread: {
    label: '未读',
    base: 'Inbox',
    note: '新条目落入收件盒',
    inner: `
      <g class="ai-inbox-tray">
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
      </g>
      <circle class="ai-inbox-drop" cx="12" cy="2.4" r="1.45" fill="currentColor" stroke="none"/>`,
  },
  starred: {
    label: '星标',
    base: 'Star',
    note: '弹一下并闪过星芒',
    inner: `
      <path class="ai-star-fill" d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>
      <path class="ai-star" d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>
      <g class="ai-spark" style="--d:60ms"><path d="M20.4 1.2v2.6"/><path d="M19.1 2.5h2.6"/></g>
      <g class="ai-spark" style="--d:150ms"><path d="M3.4 17.8v2.2"/><path d="M2.3 18.9h2.2"/></g>`,
  },
  readLater: {
    label: '稍后读',
    base: 'Bookmark',
    note: '落位后像书签一样摆一下',
    inner: `
      <g class="ai-bookmark">
        <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
      </g>`,
  },
  today: {
    label: '今天',
    base: 'CalendarDays',
    note: '日期点波、今日格亮起',
    inner: `
      <g class="ai-cal-body">
        <rect width="18" height="18" x="3" y="4" rx="2"/>
        <path d="M3 10h18"/>
        <circle class="ai-day" style="--d:0ms" cx="8" cy="14" r=".95" fill="currentColor" stroke="none"/>
        <circle class="ai-day" style="--d:25ms" cx="12" cy="14" r=".95" fill="currentColor" stroke="none"/>
        <circle class="ai-day" style="--d:50ms" cx="16" cy="14" r=".95" fill="currentColor" stroke="none"/>
        <circle class="ai-day" style="--d:75ms" cx="8" cy="18" r=".95" fill="currentColor" stroke="none"/>
        <circle class="ai-day" style="--d:100ms" cx="12" cy="18" r=".95" fill="currentColor" stroke="none"/>
        <circle class="ai-day" style="--d:125ms" cx="16" cy="18" r=".95" fill="currentColor" stroke="none"/>
        <rect class="ai-today-ring" x="9.9" y="15.9" width="4.2" height="4.2" rx="1.1" fill="none" stroke="currentColor" stroke-width="1.1"/>
      </g>
      <g class="ai-cal-rings">
        <path class="ai-ring" style="--d:0ms" d="M8 2v4"/>
        <path class="ai-ring" style="--d:60ms" d="M16 2v4"/>
      </g>`,
  },
};

const frames = [0, 100, 200, 300, 400, 500];

const card = (key, { label, base, note, inner }) => `
  <section class="card">
    <h3>${label}</h3><div class="sem">${base} · ${note}</div>
    <div class="scales">
      <div class="big anim" style="--t:-220ms">${svg(inner, 68)}</div>
      <div class="tinyrow">
        ${svg(inner, 15, 'data-icon="' + key + '"')}
        <span>${label}</span><span class="count">${key === 'unread' ? '99+' : key === 'today' ? '40' : '1'}</span>
      </div>
    </div>
    <div class="frames">
      ${frames
        .map(
          (t) =>
            `<div class="frame anim" style="--t:-${t}ms">${svg(inner, 26)}<span>${t}ms</span></div>`,
        )
        .join('')}
    </div>
    <div class="microframes">
      ${frames
        .map(
          (t) =>
            `<div class="microrow"><span class="microicon anim" style="--t:-${t}ms">${svg(inner, 15)}</span><span>${t}</span></div>`,
        )
        .join('')}
    </div>
  </section>`;

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Smart list animated icons — lab</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 28px 40px; background: #161719; color: rgba(255,255,255,.85);
    font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
  h2 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
  p.note { margin: 0 0 18px; font-size: 11px; color: rgba(255,255,255,.4); }
  .board { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
  .card { width: 300px; border: 1px solid rgba(255,255,255,.1); border-radius: 12px; padding: 14px; background: #1e2023; }
  .card h3 { margin: 0; font-size: 13px; font-weight: 600; color: rgba(255,255,255,.85); }
  .sem { font-size: 10px; color: rgba(255,255,255,.35); margin-top: 2px; }
  .scales { display: flex; align-items: center; gap: 14px; margin: 12px 0 6px; height: 76px; }
  .big { color: rgba(255,255,255,.82); }
  .tinyrow { display: flex; align-items: center; gap: 8px; font-size: 13px; color: rgba(255,255,255,.85);
    padding: 4px 6px; border-radius: 6px; width: 100%; }
  .tinyrow .count { margin-left: auto; font-size: 10px; color: rgba(255,255,255,.25); font-variant-numeric: tabular-nums; }
  .frames { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; margin-top: 10px; }
  .frame { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 2px; border-radius: 7px; background: rgba(255,255,255,.03); }
  .frame span, .microrow span:last-child { font-size: 8px; color: rgba(255,255,255,.3); font-variant-numeric: tabular-nums; }
  .microframes { display: flex; justify-content: space-between; margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.06); }
  .microrow { display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .microicon { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; background: rgba(255,255,255,.05); }
  svg.smart-icon { display: block; color: rgba(255,255,255,.5); overflow: visible; }

  /* Motion-only marks are hidden at rest. */
  .ai-inbox-drop, .ai-spark, .ai-today-ring { opacity: 0; }
  .ai-star-fill { fill-opacity: 0; }

  @media (prefers-reduced-motion: no-preference) {
    .anim svg.smart-icon { animation: icon-settle 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: var(--t,0ms); animation-play-state: paused; }
    .anim .ai-inbox-tray { animation: inbox-squash 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: var(--t,0ms); animation-play-state: paused; transform-box: fill-box; transform-origin: 50% 82%; }
    .anim .ai-inbox-drop { animation: inbox-drop 620ms cubic-bezier(.2,.8,.3,1) both; animation-delay: var(--t,0ms); animation-play-state: paused; transform-box: fill-box; transform-origin: center; }
    .anim .ai-star { transform-box: fill-box; transform-origin: center; animation: star-pop 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: var(--t,0ms); animation-play-state: paused; }
    .anim .ai-star-fill { animation: star-fill 620ms ease-out both; animation-delay: var(--t,0ms); animation-play-state: paused; }
    .anim .ai-spark { transform-box: fill-box; transform-origin: center; animation: sparkle-pop 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: calc(var(--t,0ms) + var(--d,0ms)); animation-play-state: paused; }
    .anim .ai-bookmark { transform-box: fill-box; transform-origin: 50% 4%; animation: bookmark-swing 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: var(--t,0ms); animation-play-state: paused; }
    .anim .ai-cal-body { transform-box: fill-box; transform-origin: center; animation: cal-bob 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: var(--t,0ms); animation-play-state: paused; }
    .anim .ai-ring { animation: ring-bob 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: calc(var(--t,0ms) + var(--d,0ms)); animation-play-state: paused; }
    .anim .ai-day { transform-box: fill-box; transform-origin: center; animation: day-pulse 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: calc(var(--t,0ms) + var(--d,0ms)); animation-play-state: paused; }
    .anim .ai-today-ring { transform-box: fill-box; transform-origin: center; animation: today-ring 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: var(--t,0ms); animation-play-state: paused; }
  }

  @keyframes icon-settle { 0% { transform: scale(1); } 30% { transform: scale(.9); } 62% { transform: scale(1.07); } 100% { transform: scale(1); } }
  @keyframes inbox-squash { 0%,18% { transform: translateY(0) scaleY(1); } 52% { transform: translateY(1.1px) scaleY(.92); } 76% { transform: translateY(-.4px) scaleY(1.02); } 100% { transform: translateY(0) scaleY(1); } }
  @keyframes inbox-drop { 0% { opacity: 0; transform: translateY(-3.6px) scale(.6); } 16% { opacity: 1; transform: translateY(-2.4px) scale(1); } 58% { opacity: 1; transform: translateY(6.2px) scale(1); } 74% { opacity: 0; transform: translateY(7.4px) scale(.7); } 100% { opacity: 0; transform: translateY(7.4px) scale(.7); } }
  @keyframes star-pop { 0% { transform: scale(1) rotate(0); } 28% { transform: scale(.82) rotate(-8deg); } 56% { transform: scale(1.14) rotate(3deg); } 78% { transform: scale(.98) rotate(-1deg); } 100% { transform: scale(1) rotate(0); } }
  @keyframes star-fill { 0%,34% { fill-opacity: 0; } 52% { fill-opacity: .18; } 100% { fill-opacity: 0; } }
  @keyframes sparkle-pop { 0% { opacity: 0; transform: scale(.2) rotate(-20deg); } 30% { opacity: 1; transform: scale(1.12) rotate(0); } 55% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(.5) rotate(12deg); } }
  @keyframes bookmark-swing { 0% { transform: rotate(-8deg) translateY(-2.8px); } 20% { transform: rotate(5deg) translateY(.3px); } 40% { transform: rotate(-3deg) translateY(0); } 58% { transform: rotate(2deg) translateY(0); } 76% { transform: rotate(-.8deg) translateY(0); } 100% { transform: rotate(0) translateY(0); } }
  @keyframes cal-bob { 0% { transform: translateY(0) scale(1); } 30% { transform: translateY(-1.2px) scale(.96); } 62% { transform: translateY(0) scale(1.03); } 100% { transform: translateY(0) scale(1); } }
  @keyframes ring-bob { 0%,100% { transform: translateY(0); } 34% { transform: translateY(-1.8px); } 62% { transform: translateY(.3px); } }
  @keyframes day-pulse { 0%,100% { transform: scale(1); opacity: 1; } 36% { transform: scale(.4); opacity: .5; } 64% { transform: scale(1.35); opacity: 1; } }
  @keyframes today-ring { 0% { opacity: 0; transform: scale(.4); } 44% { opacity: .85; transform: scale(1.08); } 68% { opacity: .85; transform: scale(1); } 100% { opacity: 0; transform: scale(1); } }
</style>
</head>
<body>
  <h2>智能列表 · 动态图标</h2>
  <p class="note">静态基形与 lucide Inbox / Star / Bookmark / CalendarDays 一致；动效只在 hover / focus / 选中时发生。左大图 68px，右上为侧栏真实尺寸 15px，下方两行是 26px 与 15px 的冻结帧。</p>
  <div class="board">${Object.entries(ICONS).map(([k, v]) => card(k, v)).join('')}</div>
</body>
</html>`;

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log(`[lab] ${OUT}`);
