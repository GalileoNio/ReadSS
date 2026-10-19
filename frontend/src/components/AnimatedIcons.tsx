import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * Animated glyphs for the two header filter groups.
 *
 * Each icon keeps the exact lucide silhouette at rest — motion-only marks are
 * transparent until the control is hovered, keyboard-focused or selected.
 * Motion is CSS-only, plays once and respects `prefers-reduced-motion`; the
 * rules live in `index.css` under "Smart-list icon motion" and
 * "View-tab icon motion". See DESIGN.md §7.5.
 */

type SmartIconProps = {
  /** Rendered edge length in px. Defaults to the list column's 15px. */
  size?: number;
  className?: string;
};

type GlyphProps = SmartIconProps & {
  icon: 'unread' | 'starred' | 'readLater' | 'today';
  children: ReactNode;
};

function SmartGlyph({ icon, size = 15, className, children }: GlyphProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('smart-icon shrink-0', className)}
      data-icon={icon}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** 未读 — Inbox: a new item drops into the tray and the tray catches it. */
export function SmartUnreadIcon(props: SmartIconProps) {
  return (
    <SmartGlyph icon="unread" {...props}>
      <g className="ai-inbox-tray">
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </g>
      <circle className="ai-inbox-drop" cx="12" cy="2.4" r="1.45" fill="currentColor" stroke="none" />
    </SmartGlyph>
  );
}

/** 星标 — Star: the star pops, flashes a light fill, and throws two sparks. */
export function SmartStarredIcon(props: SmartIconProps) {
  const d =
    'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z';
  return (
    <SmartGlyph icon="starred" {...props}>
      <path className="ai-star-fill" d={d} fill="currentColor" stroke="none" />
      <path className="ai-star" d={d} />
      <g className="ai-spark ai-spark--a">
        <path d="M20.4 1.2v2.6" />
        <path d="M19.1 2.5h2.6" />
      </g>
      <g className="ai-spark ai-spark--b">
        <path d="M3.4 17.8v2.2" />
        <path d="M2.3 18.9h2.2" />
      </g>
    </SmartGlyph>
  );
}

/** 稍后读 — Bookmark: it drops into place and swings once before settling. */
export function SmartReadLaterIcon(props: SmartIconProps) {
  return (
    <SmartGlyph icon="readLater" {...props}>
      <g className="ai-bookmark">
        <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
      </g>
    </SmartGlyph>
  );
}

/** 今天 — CalendarDays: rings bob, date dots ripple, today's cell lights up. */
export function SmartTodayIcon(props: SmartIconProps) {
  return (
    <SmartGlyph icon="today" {...props}>
      <g className="ai-cal-body">
        <rect width="18" height="18" x="3" y="4" rx="2" />
        <path d="M3 10h18" />
        <circle className="ai-day" cx="8" cy="14" r="0.95" fill="currentColor" stroke="none" />
        <circle className="ai-day" cx="12" cy="14" r="0.95" fill="currentColor" stroke="none" />
        <circle className="ai-day" cx="16" cy="14" r="0.95" fill="currentColor" stroke="none" />
        <circle className="ai-day" cx="8" cy="18" r="0.95" fill="currentColor" stroke="none" />
        <circle className="ai-day" cx="12" cy="18" r="0.95" fill="currentColor" stroke="none" />
        <circle className="ai-day" cx="16" cy="18" r="0.95" fill="currentColor" stroke="none" />
        <rect
          className="ai-today-ring"
          x="9.9"
          y="15.9"
          width="4.2"
          height="4.2"
          rx="1.1"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.1}
        />
      </g>
      <g className="ai-cal-rings">
        <path className="ai-ring" d="M8 2v4" />
        <path className="ai-ring" d="M16 2v4" />
      </g>
    </SmartGlyph>
  );
}

/* --------------------------------------------------------------- view tabs */

type ViewIconProps = {
  /** Rendered edge length in px. Defaults to the header capsule's 12px. */
  size?: number;
  className?: string;
};

type ViewGlyphProps = ViewIconProps & {
  icon: 'home' | 'articles' | 'social' | 'pictures' | 'videos';
  children: ReactNode;
};

function AnimatedViewGlyph({ icon, size = 12, className, children }: ViewGlyphProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('view-icon shrink-0', className)}
      data-icon={icon}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** 首页 — House with a face: it bounces with weight, blinks on landing, and smiles. */
export function AnimatedHomeIcon(props: ViewIconProps) {
  return (
    <AnimatedViewGlyph icon="home" {...props}>
      <g className="vi-home">
        <path
          className="vi-home-house"
          d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
        />
        <g className="vi-home-face">
          <g className="vi-home-eyes">
            <circle cx="9.2" cy="14" r="1.15" fill="currentColor" stroke="none" />
            <circle cx="14.8" cy="14" r="1.15" fill="currentColor" stroke="none" />
          </g>
          <path
            className="vi-home-smile"
            d="M8.7 17c.9 1.3 2.1 1.9 3.3 1.9s2.4-.6 3.3-1.9"
            strokeWidth={1.8}
          />
        </g>
      </g>
    </AnimatedViewGlyph>
  );
}

/** 文章 — AlignLeft: the three lines extend from the left margin one by one. */
export function AnimatedArticlesIcon(props: ViewIconProps) {
  return (
    <AnimatedViewGlyph icon="articles" {...props}>
      <path className="vi-line" d="M21 6H3" />
      <path className="vi-line" d="M15 12H3" />
      <path className="vi-line" d="M17 18H3" />
    </AnimatedViewGlyph>
  );
}

/** 社交 — AtSign: the core pops and one signal ring expands outwards. */
export function AnimatedSocialIcon(props: ViewIconProps) {
  return (
    <AnimatedViewGlyph icon="social" {...props}>
      <circle
        className="vi-social-ping"
        cx="12"
        cy="12"
        r="8.4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
      />
      <circle className="vi-social-core" cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </AnimatedViewGlyph>
  );
}

/** 图片 — Image: the sun pops and the mountain line draws in from the left. */
export function AnimatedPicturesIcon(props: ViewIconProps) {
  return (
    <AnimatedViewGlyph icon="pictures" {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle className="vi-photo-sun" cx="9" cy="9" r="2" />
      <path
        className="vi-photo-hill"
        pathLength={1}
        d="M6 21 15.086 11.914a2 2 0 0 1 2.828 0L21 15"
      />
    </AnimatedViewGlyph>
  );
}

/** 视频 — Video: the lens opens slightly while a recording dot blinks. */
export function AnimatedVideosIcon(props: ViewIconProps) {
  return (
    <AnimatedViewGlyph icon="videos" {...props}>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path
        className="vi-video-lens"
        d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"
      />
      <circle
        className="vi-video-dot"
        cx="5.5"
        cy="9.2"
        r="1.25"
        fill="currentColor"
        stroke="none"
      />
    </AnimatedViewGlyph>
  );
}
