import { readFile, writeFile } from 'node:fs/promises';
const p = 'build/home-icon-lab.mjs';
let s = await readFile(p, 'utf8');
s = s.replace(/<circle className="vi-home-eye vi-home-eye--l"[\s\S]*?<circle className="vi-home-eye" cx="14.8" cy="14" r="1.05" fill="currentColor" stroke="none"\/>/, '');
s = s.replace(/<g className="vi-home-face">[\s\S]*?<\/g>\n  <\/g>/, `<g class="vi-home-face">
      <g class="vi-home-eyes">
        <circle cx="9.2" cy="14" r="1.15" fill="currentColor" stroke="none"/>
        <circle cx="14.8" cy="14" r="1.15" fill="currentColor" stroke="none"/>
      </g>
      <path class="vi-home-smile" d="M8.7 17c.9 1.3 2.1 1.9 3.3 1.9s2.4-.6 3.3-1.9" stroke-width="1.8"/>
    </g>
  </g>`);
s = s.replace(/\.anim \.vi-home-eye--l \{[^}]*\}/, '.anim .vi-home-eyes { transform-box: fill-box; transform-origin: center; animation: home-blink 620ms cubic-bezier(.16,1,.3,1) both; animation-delay: calc(var(--t,0ms) + 160ms); animation-play-state: paused; }');
s = s.replace(/@keyframes home-hop \{[\s\S]*?\n  \}/, `@keyframes home-hop {
    0% { transform: translateY(0) scale(1, 1) rotate(0); }
    12% { transform: translateY(.6px) scale(1.06, .88) rotate(0); }
    30% { transform: translateY(-2.6px) scale(.96, 1.08) rotate(-2.5deg); }
    48% { transform: translateY(-3px) scale(1, 1.02) rotate(-1deg); }
    64% { transform: translateY(0) scale(1.08, .9) rotate(1.5deg); }
    80% { transform: translateY(-.7px) scale(.98, 1.02) rotate(-.5deg); }
    100% { transform: translateY(0) scale(1, 1) rotate(0); }
  }`);
s = s.replace(/@keyframes home-wink \{[\s\S]*?\n  \}/, `@keyframes home-blink {
    0%, 20% { transform: scaleY(1); }
    38% { transform: scaleY(.18); }
    52% { transform: scaleY(1.12); }
    66%, 100% { transform: scaleY(1); }
  }`);
s = s.replace(/@keyframes home-smile \{[\s\S]*?\n  \}/, `@keyframes home-smile {
    0%, 15% { transform: scaleX(1); }
    35% { transform: scaleX(1.25); }
    55% { transform: scaleX(1.3); }
    72%, 100% { transform: scaleX(1); }
  }`);
await writeFile(p, s);
console.log('patched');
