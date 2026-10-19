import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Calendar,
  ChevronRight,
  Clock,
  MessageSquare,
  Rss,
  X,
} from 'lucide-react';
import { useApp } from '../store/app';
import { useUI, type DetailOrigin } from '../store/ui';
import { useViewport } from '../hooks/useViewport';
import { VIEWS } from '../lib/types';
import { cn, formatDate, hostOf } from '../lib/utils';
import { CommentsPane } from './CommentsPane';
import { Reader } from './Reader';
import { CoverArt, coverTint, FeedIcon, proxiedImageURL } from './primitives';

/** Images fly a little slower than the panel: the picture is the subject. */
const IMAGE_FLIGHT = 420;
/** The return flight, slightly quicker. */
const IMAGE_RETURN = 360;

/**
 * Article detail dialog, following Xiaohongshu's note modal: the article is the
 * large left pane and a narrow right rail holds the author and the comment
 * thread. On narrow windows the rail becomes a second tab instead of being
 * squeezed beside the article.
 *
 * The transition is a shared-element one (DESIGN.md §7.11): the card's picture
 * is shown at the card's rectangle in a fixed overlay and flies to the detail
 * hero's rectangle, because that hero is the very same picture. The panel fades
 * and grows around it, so the dialog reads as the card opening up rather than
 * as a separate window appearing.
 */
export function ArticleModal() {
  const selectedEntryId = useApp((s) => s.selectedEntryId);
  const openEntry = useApp((s) => s.openEntry);
  const entry = useApp((s) => s.entry);
  const imageProxy = useApp((s) => s.imageProxy);
  const detailOrigin = useUI((s) => s.detailOrigin);
  const setDetailOrigin = useUI((s) => s.setDetailOrigin);
  const { isCompact } = useViewport();
  const [tab, setTab] = useState<'article' | 'comments'>('article');
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  // Where the dialog comes from. Captured once, on open, so closing can return
  // to the same place even after the store value is consumed.
  const originRef = useRef<DetailOrigin | null>(detailOrigin);
  const closingRef = useRef(false);
  const closeFn = useRef<() => void>(() => undefined);
  /** Still waiting for the card cover to fly into the detail hero. */
  const wantsImageFlight = useRef(Boolean(detailOrigin?.image));
  /** The panel's final rectangle, captured before the unfold transform. */
  const panelFinalRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  /** No card at all (palette, keyboard): let the CSS animation handle it. */
  const plainOpen = useRef(!detailOrigin);
  const reducedMotion = useRef(
    typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  ).current;

  // The flying cover, positioned at the card's cover box until it is given its
  // destination. It is the card's picture, or — for articles without a picture —
  // the drawn cover (title over the feed tint), which is treated exactly like a
  // picture (DESIGN.md §7.11). Kept mounted after landing so closing can reuse it.
  const [ghost, setGhost] = useState<{
    kind: 'image' | 'text';
    url: string;
    title: string;
    seed: string;
    color?: string;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(() => {
    const o = originRef.current;
    if (!o?.image) return null;
    return {
      kind: o.url ? 'image' : 'text',
      url: o.url ? proxiedImageURL(o.url, imageProxy, o.referer) : '',
      title: o.title,
      seed: o.seed,
      color: o.color,
      x: o.image.x,
      y: o.image.y,
      w: o.image.width,
      h: o.image.height,
    };
  });

  useEffect(() => {
    setTab('article');
  }, [selectedEntryId]);

  /* Opening motion. With a card picture the picture carries it (see the layout
     effect below) and the panel only fades in; without one the panel flies out
     of the card rectangle; with neither it keeps the CSS scale-in. */
  /* Opening motion: the panel unfolds out of the card's rectangle — its top-left
     stays anchored to the card while the right/bottom edges sweep out to the
     final frame — and the card's picture flies into the hero on top of that.
     Without a card (palette, keyboard) the CSS scale-in is used instead. */
  useEffect(() => {
    const panel = dialogRef.current;
    if (!panel) return;
    const origin = originRef.current;
    setDetailOrigin(null);

    const target = panel.getBoundingClientRect();
    panelFinalRef.current = { x: target.x, y: target.y, width: target.width, height: target.height };
    if (!origin || reducedMotion) return;
    if (target.width === 0 || target.height === 0) return;

    const scale = Math.max(0.05, Math.min(1, origin.card.width / target.width));
    const dx = origin.card.x - target.x;
    const dy = origin.card.y - target.y;

    // The drop shadow is animated explicitly: left to the CSS class it would
    // scale with the panel's transform and then vanish the instant the dialog
    // unmounts, which reads as a jump at the end of the exit.
    const targetShadow = getComputedStyle(panel).boxShadow;

    panel.style.transition = 'none';
    panel.style.transformOrigin = 'top left';
    panel.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    panel.style.opacity = '0';
    if (targetShadow && targetShadow !== 'none') {
      panel.style.boxShadow = '0 0 0 0 rgba(0, 0, 0, 0)';
    }

    // Force the start state through style/layout before flipping to the final
    // one; without this the browser has never painted the scaled state and the
    // transition is skipped, so the modal just appears.
    void panel.offsetWidth;

    panel.style.transition =
      'transform 420ms cubic-bezier(0.22, 0.8, 0.24, 1), opacity 200ms ease-out, box-shadow 420ms ease-out';
    panel.style.transform = 'translate(0px, 0px) scale(1)';
    panel.style.opacity = '1';
    if (targetShadow && targetShadow !== 'none') {
      panel.style.boxShadow = targetShadow;
    }
  }, [reducedMotion, setDetailOrigin]);

  /* Fly the card picture into the detail hero as soon as this article's hero
     has been laid out. Runs in a layout effect so the hero is hidden before the
     browser paints the first frame of the dialog. */
  useLayoutEffect(() => {
    if (!wantsImageFlight.current) return;
    if (!entry || entry.id !== selectedEntryId) return; // wait for this article

    const panel = dialogRef.current;
    const ghostEl = ghostRef.current;
    const origin = originRef.current;
    wantsImageFlight.current = false;

    if (!panel || !origin?.image) {
      setGhost(null);
      return;
    }

    const hero = panel.querySelector<HTMLElement>('[data-hero-image]');
    if (!hero) {
      setGhost(null);
      return;
    }

    // The hero is inside the panel, which is still unfolding: its on-screen
    // rectangle is scaled and moving. Convert it back into panel-local space
    // and offset it by the panel's final rectangle, without touching the
    // panel's transform (doing so would cancel the unfold transition).
    const panelRect = panel.getBoundingClientRect();
    const heroRect = hero.getBoundingClientRect();
    const matrix = new DOMMatrixReadOnly(getComputedStyle(panel).transform);
    const sx = matrix.a || 1;
    const sy = matrix.d || 1;
    const final = panelFinalRef.current ?? {
      x: panelRect.x,
      y: panelRect.y,
      width: panelRect.width,
      height: panelRect.height,
    };
    const to = {
      x: final.x + (heroRect.left - panelRect.left) / sx,
      y: final.y + (heroRect.top - panelRect.top) / sy,
      width: heroRect.width / sx,
      height: heroRect.height / sy,
    };

    const from = origin.image;
    if (!ghostEl || to.width === 0 || from.width === 0) {
      hero.style.opacity = '1';
      setGhost(null);
      return;
    }

    hero.style.opacity = '0';

    const radius = parseFloat(getComputedStyle(hero).borderTopLeftRadius) || 12;

    ghostEl.style.transition = 'none';
    ghostEl.style.left = `${from.x}px`;
    ghostEl.style.top = `${from.y}px`;
    ghostEl.style.width = `${from.width}px`;
    ghostEl.style.height = `${from.height}px`;
    ghostEl.style.borderRadius = '8px';
    ghostEl.style.opacity = '1';
    void ghostEl.offsetWidth;

    // The box itself is animated rather than scaled: the picture is `cover`ed,
    // so it re-crops as it grows instead of stretching on the way.
    const ease = 'cubic-bezier(0.22, 0.8, 0.24, 1)';
    ghostEl.style.transition = [
      `left ${IMAGE_FLIGHT}ms ${ease}`,
      `top ${IMAGE_FLIGHT}ms ${ease}`,
      `width ${IMAGE_FLIGHT}ms ${ease}`,
      `height ${IMAGE_FLIGHT}ms ${ease}`,
      `border-radius ${IMAGE_FLIGHT}ms ease`,
    ].join(', ');
    ghostEl.style.left = `${to.x}px`;
    ghostEl.style.top = `${to.y}px`;
    ghostEl.style.width = `${to.width}px`;
    ghostEl.style.height = `${to.height}px`;
    ghostEl.style.borderRadius = `${radius}px`;

    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;

      // Hand off in a single frame. The ghost already sits exactly on the hero
      // rectangle with the same picture, so an instant swap is invisible. A
      // cross-fade would flash instead: the hero's own image can still be
      // decoding (or mid blur-to-sharp), so one layer would show a placeholder.
      const commit = () => {
        if (closingRef.current) return;
        hero.style.transition = 'none';
        hero.style.opacity = '1';
        if (ghostRef.current) {
          ghostRef.current.style.transition = 'none';
          ghostRef.current.style.opacity = '0';
          // Keep the element mounted but hidden: the return flight needs it.
          ghostRef.current.style.display = 'none';
        }
      };

      const img = hero.querySelector('img');
      if (!img) {
        commit();
        return;
      }
      const decoded = img.decode
        ? img.decode().catch(() => undefined)
        : Promise.resolve();
      if (img.complete) {
        void decoded.then(commit);
        return;
      }
      img.addEventListener('load', () => void decoded.then(commit), { once: true });
      // If the image never reports load, still hand off rather than leaving a
      // ghost floating over the article.
      window.setTimeout(commit, 400);
    };
    ghostEl.addEventListener('transitionend', land, { once: true });
    // A transition that never finishes (tab hidden, image swap) must still land.
    window.setTimeout(land, IMAGE_FLIGHT + 120);
  }, [entry, selectedEntryId, reducedMotion]);

  /* Fold back into the card, then unmount. Every close path goes through this
     function so the exit animation cannot be skipped: the panel shrinks back
     into the card's rectangle and the picture flies home to the card's image
     box, both at the same pace as the opening. */
  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;

    const panel = dialogRef.current;
    const origin = originRef.current;
    const ghostEl = ghostRef.current;
    const hero = panel?.querySelector<HTMLElement>('[data-hero-image]');
    const heroRect = hero ? hero.getBoundingClientRect() : null;

    // The dimming behind the dialog has to leave with the dialog: it used to
    // stay fully opaque until the unmount frame, which is the hard "shadow
    // snaps off" that the exit was showing.
    let backdropMs = 0;
    const backdrop = backdropRef.current;
    if (backdrop && !reducedMotion) {
      backdrop.style.transition = 'opacity 260ms ease-in';
      backdrop.style.opacity = '0';
      backdropMs = 260;
    }

    let panelMs = 0;
    if (panel && origin && !reducedMotion) {
      const target = panel.getBoundingClientRect();
      const scale = Math.max(0.05, Math.min(1, origin.card.width / target.width));
      const dx = origin.card.x - target.x;
      const dy = origin.card.y - target.y;
      // Fade the shadow out with the panel; otherwise it pops away when the
      // dialog unmounts, right at the end of the exit.
      panel.style.transition = `transform ${IMAGE_RETURN}ms cubic-bezier(0.4, 0, 0.2, 1), opacity 240ms ease-in, box-shadow 300ms ease-in`;
      panel.style.transformOrigin = 'top left';
      panel.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
      panel.style.opacity = '0';
      panel.style.boxShadow = '0 0 0 0 rgba(0, 0, 0, 0)';
      panelMs = IMAGE_RETURN;
    } else if (panel) {
      panel.style.transition = 'opacity 200ms ease-in, box-shadow 300ms ease-in';
      panel.style.opacity = '0';
      panel.style.boxShadow = '0 0 0 0 rgba(0, 0, 0, 0)';
      panelMs = 200;
    }

    let imageMs = 0;
    if (panel && origin?.image && ghostEl && hero && heroRect && heroRect.width > 0 && !reducedMotion) {
      const from = heroRect;
      const to = origin.image;

      ghostEl.style.transition = 'none';
      ghostEl.style.display = 'block';
      ghostEl.style.left = `${from.x}px`;
      ghostEl.style.top = `${from.y}px`;
      ghostEl.style.width = `${from.width}px`;
      ghostEl.style.height = `${from.height}px`;
      ghostEl.style.borderRadius = '12px';
      ghostEl.style.opacity = '1';
      hero.style.opacity = '0';
      void ghostEl.offsetWidth;

      // Fly the picture home **without fading it**: the card only reappears
      // when the dialog unmounts, so a fading ghost would leave the slot empty
      // for a frame or two right before the card pops back — that is the flash.
      // Instead the ghost lands exactly on the card's picture box and is
      // swapped for the (identical) card picture in the same frame.
      const ease = 'cubic-bezier(0.4, 0, 0.2, 1)';
      ghostEl.style.transition = [
        `left ${IMAGE_RETURN}ms ${ease}`,
        `top ${IMAGE_RETURN}ms ${ease}`,
        `width ${IMAGE_RETURN}ms ${ease}`,
        `height ${IMAGE_RETURN}ms ${ease}`,
        `border-radius ${IMAGE_RETURN}ms ease`,
      ].join(', ');
      ghostEl.style.left = `${to.x}px`;
      ghostEl.style.top = `${to.y}px`;
      ghostEl.style.width = `${to.width}px`;
      ghostEl.style.height = `${to.height}px`;
      ghostEl.style.borderRadius = '8px';
      imageMs = IMAGE_RETURN;
    }

    // Unmount after the slowest exit animation (panel, picture, backdrop). The
    // unmount and the card's reappearance happen in the same commit, so the
    // picture never has a frame without an owner.
    window.setTimeout(
      () => void openEntry(null),
      Math.max(panelMs, imageMs, backdropMs),
    );
  };
  closeFn.current = close;

  useEffect(() => {
    if (!selectedEntryId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeFn.current();
        return;
      }
      if (e.key !== 'Tab') return;

      // Keep keyboard focus inside the dialog. The list behind is still in the
      // DOM, so without this Tab would walk into invisible background buttons.
      const root = dialogRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.getClientRects().length > 0);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!root.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const focus = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(focus);
    };
  }, [selectedEntryId, openEntry]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-0 lg:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="文章详情"
    >
      <div
        ref={backdropRef}
        className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm"
        onClick={close}
        aria-hidden="true"
      />

      {/* Flying cover: starts at the card's cover box and lands in the hero. It
          is the card's picture, or — for articles without a picture — the drawn
          cover, which is treated exactly like a picture (DESIGN.md §7.11). */}
      {ghost && (
        <div
          ref={ghostRef}
          aria-hidden="true"
          className="pointer-events-none fixed z-30 select-none overflow-hidden"
          style={{
            left: ghost.x,
            top: ghost.y,
            width: ghost.w,
            height: ghost.h,
            borderRadius: 8,
            ...(ghost.kind === 'image'
              ? {
                  backgroundImage: `url("${ghost.url}")`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }
              : { background: coverTint(ghost.seed, ghost.color) }),
          }}
        >
          {ghost.kind === 'text' && (
            <CoverArt title={ghost.title} seed={ghost.seed} color={ghost.color} />
          )}
        </div>
      )}

      <div
        ref={dialogRef}
        data-modal-panel=""
        className={cn(
          'relative z-10 flex h-[min(92vh,920px)] w-[min(1200px,94vw)] flex-col overflow-hidden',
          'rounded-xl border border-border bg-background shadow-modal',
          plainOpen.current ? 'animate-scale-in' : '',
          isCompact && 'h-full w-full rounded-none border-0',
        )}
      >
        {isCompact ? (
          <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
            <button
              type="button"
              aria-pressed={tab === 'article'}
              onClick={() => setTab('article')}
              className={cn(
                'rounded-md px-2.5 py-1 text-headline font-medium transition-colors',
                tab === 'article' ? 'bg-item-active text-fg' : 'text-fg/50 hover:text-fg/85',
              )}
            >
              文章
            </button>
            <button
              type="button"
              aria-pressed={tab === 'comments'}
              onClick={() => setTab('comments')}
              className={cn(
                'flex items-center gap-1 rounded-md px-2.5 py-1 text-headline font-medium transition-colors',
                tab === 'comments' ? 'bg-item-active text-fg' : 'text-fg/50 hover:text-fg/85',
              )}
            >
              评论
            </button>
            <span className="flex-1" />
            <button
              ref={closeRef}
              type="button"
              title="关闭"
              aria-label="关闭"
              className="icon-btn"
              onClick={close}
            >
              <X size={16} />
            </button>
          </header>
        ) : (
          <button
            ref={closeRef}
            type="button"
            title="关闭"
            aria-label="关闭"
            className="icon-btn absolute right-3 top-3 z-20 bg-background/80 backdrop-blur"
            onClick={close}
          >
            <X size={16} />
          </button>
        )}

        <div className="flex min-h-0 flex-1">
          <div
            className={cn(
              'flex min-h-0 min-w-0 flex-1 flex-col',
              isCompact && tab !== 'article' && 'hidden',
            )}
          >
            <Reader modal />
          </div>

          <aside
            className={cn(
              'flex min-h-0 flex-col bg-background',
              isCompact
                ? 'w-full min-w-0 flex-1'
                : 'w-[380px] shrink-0 border-l border-border',
              isCompact && tab !== 'comments' && 'hidden',
            )}
          >
            <AuthorCard />
            <CommentsPane embedded />
          </aside>
        </div>
      </div>
    </div>
  );
}

function AuthorCard() {
  const entry = useApp((s) => s.entry);
  const selectFeed = useApp((s) => s.selectFeed);
  const openEntry = useApp((s) => s.openEntry);

  if (!entry) {
    return (
      <div className="shrink-0 border-b border-border p-4 pr-12">
        <div className="flex items-center gap-3">
          <div className="skeleton h-11 w-11 rounded-md" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3 w-2/3 rounded" />
            <div className="skeleton h-2.5 w-1/3 rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-border p-4 pr-12">
      <div className="flex items-start gap-3">
        <FeedIcon title={entry.feedTitle} iconUrl={entry.feedIcon} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-title3 font-semibold text-fg">{entry.feedTitle}</p>
          <p className="mt-0.5 truncate text-callout text-fg/50">
            {entry.author || hostOf(entry.url) || '订阅源'}
          </p>
        </div>
        <span className="mt-1 shrink-0 rounded-full bg-fill px-2.5 py-1 text-footnote font-medium text-fg/50">
          已订阅
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center rounded-full bg-fill/60 px-2 py-1 text-footnote text-fg/50">
          {VIEWS.find((v) => v.key === entry.feedView)?.label ?? '文章'}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-fill/60 px-2 py-1 text-footnote text-fg/50">
          <Calendar size={12} />
          {formatDate(entry.publishedAt)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-fill/60 px-2 py-1 text-footnote text-fg/50">
          <Clock size={12} />约 {entry.readingMinutes} 分钟
        </span>
        {entry.commentsCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-fill/60 px-2 py-1 text-footnote text-fg/50">
            <MessageSquare size={12} />
            {entry.commentsCount}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          void selectFeed(entry.feedId);
          void openEntry(null);
        }}
        className="mt-3 inline-flex items-center gap-1 rounded-md text-footnote text-fg/50 transition-colors hover:text-fg/85"
      >
        <Rss size={12} />
        查看订阅源
        <ChevronRight size={12} />
      </button>
    </div>
  );
}
