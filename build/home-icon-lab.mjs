// Generates a throwaway lab page for the smiley-house view icon.
//   node build/home-icon-lab.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'frontend', 'dist', '__home-icon-lab.html');

const inner = `
  <g class="vi-home">
    <path class="vi-home-house" d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <g class="vi-home-face">
      <g class="vi-home-eyes">
        <circle cx="9.2" cy="14" r="1.15" fill="currentColor" stroke="none"/>
        <circle cx="14.8" cy="14" r="1.15" fill="currentColor" stroke="none"/>
      </g>
      <path class="vi-home-smile" d="M8.7 17c.9 1.3 2.1 1.9 3.3 1.9s2.4-.6 3.3-1.9" stroke-width="1.8"/>
    </g>
  </g>`;

const svg = (size, extra = '') =>
  `<svg class="view-icon" ${extra} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const frames = [0, 80, 160, 240, 320, 420, 520, 620];

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Home icon lab</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 28px; background: #161719; color: rgba(255,255,255,.85);
    font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
  h2 { margin: 0 0 6px; font-size: 15px; }
  p { margin: 0 0 18px; font-size: 11px; color: rgba(255,255,255,.4); }
  .row { display: flex; gap: 22px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 22px; }
  .item { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .label { font-size: 9px; color: rgba(255,255,255,.35); }
  .big { color: rgba(255,255,255,.85); }
  .orange { color: #FF5C00; }
  .capsule { display: flex; align-items: center; gap: 4px; height: 28px; padding: 0 6px; border-radius: 999px;
    border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); color: #FF5C00; }
  .capsule .name { font-size: 10.4px; color: rgba(255,255,255,.9); }
  .capsule .count { font-size: 9.6px; color: rgba(255,255,255,.5); }
  .frames { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; width: min(760px, 100%); }
  .frame { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 8px 2px; border-radius: 8px; background: rgba(255,255,255,.04); }
  .frame .label { font-variant-numeric: tabular-nums; }
  .micro { display: flex; gap: 10px; margin-top: 14px; }
  .micro .frame { width: 34px; }
  svg.view-icon { display: block; color: rgba(255,255,255,.6); overflow: visible; }

  @media (prefers-reduced-motion: no-preference) {
    .anim svg.view-icon { animation: icon-settle 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: var(--t,0ms); animation-play-state: paused; }
    .anim .vi-home { transform-box: fill-box; transform-origin: 50% 100%; animation: home-hop 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: var(--t,0ms); animation-play-state: paused; }
    .anim .vi-home-eyes { transform-box: fill-box; transform-origin: center; animation: home-blink 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: calc(var(--t,0ms) + 160ms); animation-play-state: paused; }
    .anim .vi-home-smile { transform-box: fill-box; transform-origin: center; animation: home-smile 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: calc(var(--t,0ms) + 60ms); animation-play-state: paused; }
  }
  @keyframes icon-settle { 0% { transform: scale(1); } 30% { transform: scale(.93); } 62% { transform: scale(1.05); } 100% { transform: scale(1); } }
  @keyframes home-hop {
    0% { transform: translateY(0) scale(1, 1) rotate(0); }
    12% { transform: translateY(.6px) scale(1.06, .88) rotate(0); }
    30% { transform: translateY(-2.6px) scale(.96, 1.08) rotate(-2.5deg); }
    48% { transform: translateY(-3px) scale(1, 1.02) rotate(-1deg); }
    64% { transform: translateY(0) scale(1.08, .9) rotate(1.5deg); }
    80% { transform: translateY(-.7px) scale(.98, 1.02) rotate(-.5deg); }
    100% { transform: translateY(0) scale(1, 1) rotate(0); }
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
<body>
  <h2>首页 · 带笑脸的房子</h2>
  <p>静止基形 = lucide House 外轮廓 + 两眼一嘴。动效：房子有重量地弹跳、落地眨眼、笑弧展开。</p>
  <div class="row">
    <div class="item"><span class="label">68px</span><div class="big anim" style="--t:-220ms">${svg(68)}</div></div>
    <div class="item"><span class="label">26px</span><div class="anim" style="--t:-220ms">${svg(26)}</div></div>
    <div class="item"><span class="label">19px</span><div class="anim" style="--t:-220ms">${svg(19)}</div></div>
    <div class="item"><span class="label">12px 静止</span>${svg(12)}</div>
    <div class="item"><span class="label">12px 选中</span><div class="capsule">${svg(12, 'style="color:#FF5C00"')}<span class="name">首页</span><span class="count">7</span></div></div>
    <div class="item"><span class="label">头部胶囊（真实尺寸）</span><div class="capsule">${svg(12)}<span class="name">首页</span><span class="count">7</span></div></div>
  </div>
  <div class="frames">
    ${frames.map((t) => `<div class="frame anim" style="--t:-${t}ms">${svg(26)}<span class="label">${t}</span></div>`).join('')}
  </div>
  <div class="micro">
    ${frames.map((t) => `<div class="frame anim" style="--t:-${t}ms">${svg(12)}<span class="label">${t}</span></div>`).join('')}
  </div>
</body></html>`;

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log(`[lab] ${OUT}`);
