// Generates the throwaway view-tab icon lab page served from frontend/dist.
//   node build/view-icon-lab.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'frontend', 'dist', '__view-icon-lab.html');

const svg = (inner, size, extra = '') =>
  `<svg class="view-icon" ${extra} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${size >= 40 ? 1.7 : 1.9}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const ICONS = {
  all: {
    label: '全部',
    base: 'LayoutGrid',
    note: '四格向中心收拢后弹开归位',
    color: '#FF5C00',
    inner: `
      <g class="vi-grid">
        <rect class="vi-grid-tile" width="7" height="7" x="3" y="3" rx="1"/>
        <rect class="vi-grid-tile" width="7" height="7" x="14" y="3" rx="1"/>
        <rect class="vi-grid-tile" width="7" height="7" x="14" y="14" rx="1"/>
        <rect class="vi-grid-tile" width="7" height="7" x="3" y="14" rx="1"/>
      </g>`,
  },
  articles: {
    label: '文章',
    base: 'AlignLeft',
    note: '三行文字依次展开',
    color: '#84CC16',
    inner: `
      <path class="vi-line" pathLength="1" d="M21 6H3"/>
      <path class="vi-line" pathLength="1" d="M15 12H3"/>
      <path class="vi-line" pathLength="1" d="M17 18H3"/>`,
  },
  social: {
    label: '社交',
    base: 'AtSign',
    note: '@ 核心弹一下，外面扩散一圈信号',
    color: '#0EA5E9',
    inner: `
      <circle class="vi-social-ping" cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.2"/>
      <circle class="vi-social-core" cx="12" cy="12" r="4"/>
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>`,
  },
  pictures: {
    label: '图片',
    base: 'Image',
    note: '太阳弹出，山线自左向右绘制',
    color: '#22C55E',
    inner: `
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
      <circle class="vi-photo-sun" cx="9" cy="9" r="2"/>
      <path class="vi-photo-hill" pathLength="1" d="M6 21 15.086 11.914a2 2 0 0 1 2.828 0L21 15"/>`,
  },
  videos: {
    label: '视频',
    base: 'Video',
    note: '镜头盖张开，录制点闪两下',
    color: '#EF4444',
    inner: `
      <rect x="2" y="6" width="14" height="12" rx="2"/>
      <path class="vi-video-lens" d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/>
      <circle class="vi-video-dot" cx="5.5" cy="9.2" r="1.05" fill="currentColor" stroke="none"/>`,
  },
};

const frames = [0, 100, 200, 300, 400, 500, 620];

const card = (key, { label, base, note, color, inner }) => `
  <section class="card">
    <h3 style="color:${color}">${label}</h3><div class="sem">${base} · ${note}</div>
    <div class="scales">
      <div class="big anim" style="--t:-220ms">${svg(inner, 68)}</div>
      <div class="tab anim" style="--t:-220ms;color:${color}">
        ${svg(inner, 19, 'data-icon="' + key + '"')}
        <span class="count">12</span>
        <span class="tablabel">${label}</span>
      </div>
    </div>
    <div class="frames">
      ${frames
        .map(
          (t) =>
            `<div class="frame anim" style="--t:-${t}ms">${svg(inner, 26)}<span>${t}</span></div>`,
        )
        .join('')}
    </div>
    <div class="microframes">
      ${frames
        .map(
          (t) =>
            `<div class="microrow"><span class="microicon anim" style="--t:-${t}ms">${svg(inner, 19)}</span><span>${t}</span></div>`,
        )
        .join('')}
    </div>
  </section>`;

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>View tab animated icons — lab</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 28px 40px; background: #161719; color: rgba(255,255,255,.85);
    font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
  h2 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
  p.note { margin: 0 0 18px; font-size: 11px; color: rgba(255,255,255,.4); }
  .board { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
  .card { width: 250px; border: 1px solid rgba(255,255,255,.1); border-radius: 12px; padding: 14px; background: #1e2023; }
  .card h3 { margin: 0; font-size: 13px; font-weight: 600; }
  .sem { font-size: 10px; color: rgba(255,255,255,.35); margin-top: 2px; }
  .scales { display: flex; align-items: center; gap: 14px; margin: 12px 0 6px; height: 76px; }
  .big { color: rgba(255,255,255,.82); }
  .tab { width: 54px; height: 48px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; border-radius: 6px; }
  .tab .count { font-size: 9px; line-height: 1; font-variant-numeric: tabular-nums; }
  .tab .tablabel { font-size: 9px; line-height: 1; color: rgba(255,255,255,.5); }
  .frames { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; margin-top: 10px; }
  .frame { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 5px 1px; border-radius: 6px; background: rgba(255,255,255,.03); }
  .frame span, .microrow span:last-child { font-size: 8px; color: rgba(255,255,255,.3); font-variant-numeric: tabular-nums; }
  .microframes { display: flex; justify-content: space-between; margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.06); }
  .microrow { display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .microicon { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; background: rgba(255,255,255,.05); }
  svg.view-icon { display: block; color: rgba(255,255,255,.5); overflow: visible; }

  /* Motion-only marks are hidden at rest. */
  .vi-social-ping, .vi-video-dot { opacity: 0; }
  .vi-photo-hill { stroke-dasharray: 1; stroke-dashoffset: 0; }

  @media (prefers-reduced-motion: no-preference) {
    .anim svg.view-icon { animation: view-icon-settle 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: var(--t,0ms); animation-play-state: paused; }
    .anim .vi-grid-tile { transform-box: fill-box; transform-origin: center; animation: view-grid-tile 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: calc(var(--t,0ms) + var(--d,0ms)); animation-play-state: paused; }
    .anim .vi-line { transform-box: fill-box; transform-origin: 0% 50%; animation: view-article-write 460ms cubic-bezier(.16,1,.3,1) both; animation-delay: calc(var(--t,0ms) + var(--d,0ms)); animation-play-state: paused; }
    .anim .vi-social-ping { transform-box: fill-box; transform-origin: center; animation: view-social-ping 620ms ease-out both; animation-delay: var(--t,0ms); animation-play-state: paused; }
    .anim .vi-social-core { transform-box: fill-box; transform-origin: center; animation: view-social-core 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: calc(var(--t,0ms) + 20ms); animation-play-state: paused; }
    .anim .vi-photo-sun { transform-box: fill-box; transform-origin: center; animation: view-photo-sun 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: calc(var(--t,0ms) + 40ms); animation-play-state: paused; }
    .anim .vi-photo-hill { animation: view-photo-hill 460ms cubic-bezier(.16,1,.3,1) both; animation-delay: calc(var(--t,0ms) + 120ms); animation-play-state: paused; }
    .anim .vi-video-lens { transform-box: fill-box; transform-origin: 0% 50%; animation: view-video-lens 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: var(--t,0ms); animation-play-state: paused; }
    .anim .vi-video-dot { transform-box: fill-box; transform-origin: center; animation: view-video-dot 620ms ease-out both; animation-delay: calc(var(--t,0ms) + 60ms); animation-play-state: paused; }
  }

  .vi-grid-tile:nth-of-type(1) { --d: 0ms; --dx: .8px; --dy: .8px; }
  .vi-grid-tile:nth-of-type(2) { --d: 40ms; --dx: -.8px; --dy: .8px; }
  .vi-grid-tile:nth-of-type(3) { --d: 80ms; --dx: -.8px; --dy: -.8px; }
  .vi-grid-tile:nth-of-type(4) { --d: 120ms; --dx: .8px; --dy: -.8px; }
  .vi-line:nth-child(1) { --d: 0ms; }
  .vi-line:nth-child(2) { --d: 70ms; }
  .vi-line:nth-child(3) { --d: 140ms; }

  @keyframes view-icon-settle { 0% { transform: scale(1); } 30% { transform: scale(.93); } 62% { transform: scale(1.05); } 100% { transform: scale(1); } }
  @keyframes view-grid-tile {
    0% { opacity: 1; transform: translate(var(--dx,0), var(--dy,0)) scale(.62); }
    45% { opacity: 1; transform: translate(0,0) scale(1.13); }
    70% { opacity: 1; transform: translate(0,0) scale(.97); }
    100% { opacity: 1; transform: translate(0,0) scale(1); }
  }
  @keyframes view-article-write { 0% { opacity: .45; transform: scaleX(.15); } 55% { opacity: 1; transform: scaleX(1.06); } 100% { opacity: 1; transform: scaleX(1); } }
  @keyframes view-social-ping {
    0% { opacity: 0; transform: scale(.5); }
    24% { opacity: .55; }
    100% { opacity: 0; transform: scale(1.12); }
  }
  @keyframes view-social-core {
    0% { transform: scale(.8); }
    45% { transform: scale(1.16); }
    100% { transform: scale(1); }
  }
  @keyframes view-photo-sun {
    0% { opacity: .3; transform: scale(.3); }
    45% { opacity: 1; transform: scale(1.22); }
    100% { opacity: 1; transform: scale(1); }
  }
  @keyframes view-photo-hill { 0% { stroke-dashoffset: 1; } 100% { stroke-dashoffset: 0; } }
  @keyframes view-video-lens {
    0% { transform: scaleX(1); }
    35% { transform: scaleX(1.2); }
    65% { transform: scaleX(.98); }
    100% { transform: scaleX(1); }
  }
  @keyframes view-video-dot {
    0% { opacity: 0; transform: scale(.6); }
    18% { opacity: 1; transform: scale(1); }
    42% { opacity: .2; }
    62% { opacity: 1; }
    100% { opacity: 0; transform: scale(1); }
  }
</style>
</head>
<body>
  <h2>视图页签 · 动态图标</h2>
  <p class="note">静止基形与 lucide LayoutGrid / AlignLeft / AtSign / Image / Video 一致；动效只在 hover / focus / 选中时发生。大图 68px，右上 19px（页签真实尺寸），下方为 26px 与 19px 的冻结帧。</p>
  <div class="board">${Object.entries(ICONS).map(([k, v]) => card(k, v)).join('')}</div>
</body>
</html>`;

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log(`[lab] ${OUT}`);
