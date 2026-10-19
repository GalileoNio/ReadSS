import clsx, { type ClassValue } from 'clsx';

/** Tailwind-friendly conditional class names. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/** Hostname without the www. prefix, for display. */
export function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Relative time in the compact form Folo uses in the entry list. */
export function relativeTime(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;

  if (diff < 0) return formatDate(ms);
  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return formatDate(ms);
}

/** Absolute date, e.g. 2024年1月2日. */
export function formatDate(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return sameYear ? md : `${d.getFullYear()}年${md}`;
}

/** Date used for the sticky group headers in the entry list. */
export function groupLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(d, today)) return '今天';
  if (sameDay(d, yesterday)) return '昨天';
  return formatDate(ms);
}

/**
 * Deterministic gradient for a feed avatar fallback, derived from its title so
 * the same feed always gets the same colour.
 */
export function avatarGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue} 62% 52%), hsl(${(hue + 38) % 360} 58% 42%))`;
}

/** First character used by the avatar fallback. */
export function initialOf(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return '?';
  return Array.from(trimmed)[0].toUpperCase();
}

/** Truncate for tooltips and compact labels. */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max).join('')}…`;
}

/** True when the platform shortcut modifier is pressed. */
export function isMod(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

/** Strip tags for plain-text previews. */
export function stripHtml(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * Convert `#RRGGBB` to the `H S% L%` triplet the CSS variables use, so the
 * accent colour stays compatible with Tailwind's `<alpha-value>` support.
 */
export function hexToHslTriplet(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }

  return `${(h * 360).toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%`;
}
