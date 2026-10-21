import { useId, type ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * Animated glyphs for the two header filter groups.
 *
 * Each icon keeps the exact lucide silhouette at rest — motion-only marks are
 * transparent until the control is hovered, keyboard-focused or selected.
 * The selected item swaps to the solid variant: same silhouette, filled
 * counters, so state reads without relying on the label alone. Motion is
 * CSS-only, plays once and respects `prefers-reduced-motion`; the rules live
 * in `index.css` under "Smart-list icon motion" and "View-tab icon motion".
 * See DESIGN.md §7.5.
 */

type SmartIconProps = {
  /** Rendered edge length in px. Defaults to the list column's 15px. */
  size?: number;
  className?: string;
  /** Draw the solid silhouette used by the selected item. */
  filled?: boolean;
};

type GlyphProps = SmartIconProps & {
  icon: 'unread' | 'starred' | 'readLater' | 'today';
  children: ReactNode;
};

function SmartGlyph({ icon, size = 15, className, filled = false, children }: GlyphProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
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
export function SmartUnreadIcon({ filled, ...props }: SmartIconProps) {
  const maskId = useId().replace(/:/g, '');
  const tray =
    'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z';
  return (
    <SmartGlyph icon="unread" filled={filled} {...props}>
      {filled ? (
        <>
          <defs>
            <mask
              id={maskId}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="24"
              height="24"
            >
              <path d={tray} fill="#fff" />
              <polyline
                points="20.9 12 16 12 14 15 10 15 8 12 3.1 12"
                fill="none"
                stroke="#000"
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </mask>
          </defs>
          <path className="ai-inbox-tray" d={tray} mask={`url(#${maskId})`} />
          <circle
            className="ai-inbox-drop"
            cx="12"
            cy="2.4"
            r="1.45"
            fill="currentColor"
            stroke="none"
          />
        </>
      ) : (
        <>
          <g className="ai-inbox-tray">
            <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
            <path d={tray} />
          </g>
          <circle
            className="ai-inbox-drop"
            cx="12"
            cy="2.4"
            r="1.45"
            fill="currentColor"
            stroke="none"
          />
        </>
      )}
    </SmartGlyph>
  );
}

/** 星标 — Star: the star pops, flashes a light fill, and throws two sparks. */
export function SmartStarredIcon({ filled, ...props }: SmartIconProps) {
  const d =
    'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z';
  return (
    <SmartGlyph icon="starred" filled={filled} {...props}>
      {!filled && <path className="ai-star-fill" d={d} fill="currentColor" stroke="none" />}
      <path className="ai-star" d={d} />
      <g
        className="ai-spark ai-spark--a"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
      >
        <path d="M20.4 1.2v2.6" />
        <path d="M19.1 2.5h2.6" />
      </g>
      <g
        className="ai-spark ai-spark--b"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
      >
        <path d="M3.4 17.8v2.2" />
        <path d="M2.3 18.9h2.2" />
      </g>
    </SmartGlyph>
  );
}

/** 稍后读 — Bookmark: it drops into place and swings once before settling. */
export function SmartReadLaterIcon({ filled, ...props }: SmartIconProps) {
  return (
    <SmartGlyph icon="readLater" filled={filled} {...props}>
      <path
        className="ai-bookmark"
        d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"
      />
    </SmartGlyph>
  );
}

/** 今天 — CalendarDays: rings bob, date dots ripple, today's cell lights up. */
export function SmartTodayIcon({ filled, ...props }: SmartIconProps) {
  const maskId = useId().replace(/:/g, '');
  const dots = [
    [8, 14],
    [12, 14],
    [16, 14],
    [8, 18],
    [12, 18],
    [16, 18],
  ];
  return (
    <SmartGlyph icon="today" filled={filled} {...props}>
      {filled ? (
        <>
          <defs>
            <mask
              id={maskId}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="24"
              height="24"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" fill="#fff" />
              <rect x="2.5" y="9.05" width="19" height="1.9" fill="#000" />
              {dots.map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.15" fill="#000" />
              ))}
            </mask>
          </defs>
          <rect
            className="ai-cal-body"
            x="3"
            y="4"
            width="18"
            height="18"
            rx="2"
            mask={`url(#${maskId})`}
          />
          <g className="ai-cal-rings">
            <rect className="ai-ring" x="7.05" y="2" width="1.9" height="4.4" rx="0.95" />
            <rect className="ai-ring" x="15.05" y="2" width="1.9" height="4.4" rx="0.95" />
          </g>
        </>
      ) : (
        <>
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
        </>
      )}
    </SmartGlyph>
  );
}

/* --------------------------------------------------------------- view tabs */

type ViewIconProps = {
  /** Rendered edge length in px. Defaults to the header capsule's 12px. */
  size?: number;
  className?: string;
  /** Draw the solid silhouette used by the selected item. */
  filled?: boolean;
};

type ViewGlyphProps = ViewIconProps & {
  icon: 'home' | 'articles' | 'social' | 'pictures' | 'videos' | 'audio';
  children: ReactNode;
};

function AnimatedViewGlyph({ icon, size = 12, className, filled = false, children }: ViewGlyphProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
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
export function AnimatedHomeIcon({ filled, ...props }: ViewIconProps) {
  const maskId = useId().replace(/:/g, '');
  const house =
    'M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z';
  return (
    <AnimatedViewGlyph icon="home" filled={filled} {...props}>
      {filled ? (
        <>
          <defs>
            <mask
              id={maskId}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="24"
              height="24"
            >
              <path d={house} fill="#fff" />
              <circle cx="9.2" cy="14" r="1.15" fill="#000" />
              <circle cx="14.8" cy="14" r="1.15" fill="#000" />
              <path
                d="M8.7 17c.9 1.3 2.1 1.9 3.3 1.9s2.4-.6 3.3-1.9"
                fill="none"
                stroke="#000"
                strokeWidth={1.8}
                strokeLinecap="round"
              />
            </mask>
          </defs>
          <path className="vi-home" d={house} mask={`url(#${maskId})`} />
        </>
      ) : (
        <g className="vi-home">
          <path className="vi-home-house" d={house} />
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
      )}
    </AnimatedViewGlyph>
  );
}

/** 文章 — AlignLeft: the three lines extend from the left margin one by one. */
export function AnimatedArticlesIcon({ filled, ...props }: ViewIconProps) {
  return (
    <AnimatedViewGlyph icon="articles" filled={filled} {...props}>
      {filled ? (
        <>
          <rect className="vi-line" x="3" y="5.05" width="18" height="1.9" rx="0.95" />
          <rect className="vi-line" x="3" y="11.05" width="12" height="1.9" rx="0.95" />
          <rect className="vi-line" x="3" y="17.05" width="14" height="1.9" rx="0.95" />
        </>
      ) : (
        <>
          <path className="vi-line" d="M21 6H3" />
          <path className="vi-line" d="M15 12H3" />
          <path className="vi-line" d="M17 18H3" />
        </>
      )}
    </AnimatedViewGlyph>
  );
}

/** 社交 — AtSign: the core pops and one signal ring expands outwards. */
export function AnimatedSocialIcon({ filled, ...props }: ViewIconProps) {
  return (
    <AnimatedViewGlyph icon="social" filled={filled} {...props}>
      {filled ? (
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
          <circle className="vi-social-core" cx="12" cy="12" r="4" />
        </g>
      ) : (
        <>
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
        </>
      )}
    </AnimatedViewGlyph>
  );
}

/** 图片 — Image: the sun pops and the mountain line draws in from the left. */
export function AnimatedPicturesIcon({ filled, ...props }: ViewIconProps) {
  return (
    <AnimatedViewGlyph icon="pictures" filled={filled} {...props}>
      {filled ? (
        <path
          fillRule="evenodd"
          d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-.9L16.2 14.1l-2.4 2.7-3.5-4.4L6.8 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3.5 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"
        />
      ) : (
        <>
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
          <circle className="vi-photo-sun" cx="9" cy="9" r="2" />
          <path
            className="vi-photo-hill"
            pathLength={1}
            d="M6 21 15.086 11.914a2 2 0 0 1 2.828 0L21 15"
          />
        </>
      )}
    </AnimatedViewGlyph>
  );
}

/** 视频 — Video: the lens opens slightly while a recording dot blinks. */
export function AnimatedVideosIcon({ filled, ...props }: ViewIconProps) {
  return (
    <AnimatedViewGlyph icon="videos" filled={filled} {...props}>
      {filled ? (
        <>
          <rect x="2" y="6" width="14" height="12" rx="2" />
          <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5Z" />
        </>
      ) : (
        <>
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
        </>
      )}
    </AnimatedViewGlyph>
  );
}

/** 音频 — Podcast: a level meter whose three bars rise one after another. */
export function AnimatedAudioIcon({ filled, ...props }: ViewIconProps) {
  return (
    <AnimatedViewGlyph icon="audio" filled={filled} {...props}>
      {filled ? (
        <>
          <rect className="vi-audio-bar" x="4.9" y="10.5" width="2.2" height="3" rx="1.1" />
          <rect className="vi-audio-bar" x="10.9" y="7.5" width="2.2" height="9" rx="1.1" />
          <rect className="vi-audio-bar" x="16.9" y="9.5" width="2.2" height="5" rx="1.1" />
        </>
      ) : (
        <>
          <path className="vi-audio-bar" d="M6 10.5v3" />
          <path className="vi-audio-bar" d="M12 7.5v9" />
          <path className="vi-audio-bar" d="M18 9.5v5" />
        </>
      )}
    </AnimatedViewGlyph>
  );
}
