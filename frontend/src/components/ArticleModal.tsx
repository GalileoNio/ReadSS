import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BookmarkPlus,
  Calendar,
  Clock,
  MessageCircle,
  PenLine,
  Share2,
  Star,
  X,
} from 'lucide-react';
import * as api from '../lib/api';
import { openExternal } from '../lib/feedActions';
import { findFeedByUrl, followFeed, unfollowFeed } from '../lib/follow';
import { useApp } from '../store/app';
import { usePlayer } from '../store/player';
import { useUI, type DetailOrigin } from '../store/ui';
import { useViewport } from '../hooks/useViewport';
import { VIEWS, type EntryDetail, type Feed } from '../lib/types';
import { cn, formatClock, formatDate, hostOf } from '../lib/utils';
import { CommentsPane } from './CommentsPane';
import { PLAYER_DOCK_SPACE } from './PodcastPlayer';
import { Reader } from './Reader';
import { TranscriptPane } from './TranscriptPane';
import { CARD_IMAGE_RADIUS, CoverArt, coverTint, FeedIcon, proxiedImageURL, Spinner } from './primitives';

/** Images fly a little slower than the panel: the picture is the subject. */
const IMAGE_FLIGHT = 420;
/** The return flight, slightly quicker. */
const IMAGE_RETURN = 360;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a `object-contain` picture actually sits inside its box.
 *
 * The detail hero shows the whole picture, so the visible image is letterboxed;
 * the flying layer must land on that visible rectangle (where cover and contain
 * agree) rather than on the full-width box, otherwise the picture would jump
 * when the hero takes over.
 */
function containedBox(box: Box, img: HTMLImageElement | null): Box {
  if (!img || !img.naturalWidth || !img.naturalHeight) return box;
  const natural = img.naturalWidth / img.naturalHeight;
  const boxRatio = box.width / box.height;
  let width = box.width;
  let height = box.height;
  if (natural > boxRatio) {
    height = width / natural;
  } else {
    width = height * natural;
  }
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/** The hero's own picture (the contain layer), not its blurred backdrop. */
function heroPicture(hero: HTMLElement | null): HTMLImageElement | null {
  return hero?.querySelector<HTMLImageElement>('img:not([aria-hidden])') ?? null;
}

/**
 * Article detail dialog, following Xiaohongshu's note modal: the article is the
 * large left pane and a narrow right rail holds the author and the comment
 * thread. On narrow windows the rail becomes a second tab instead of being
 * squeezed beside the article.
 *
 * The transition is a shared-element one (DESIGN.md §7.11): the card's picture
 * is shown at the card's rectangle in a fixed overlay and flies to the visible
 * rectangle of the detail hero, because that hero is the very same picture. The
 * panel fades and grows around it, so the dialog reads as the card opening up
 * rather than as a separate window appearing.
 */
export function ArticleModal() {
  const selectedEntryId = useApp((s) => s.selectedEntryId);
  const openEntry = useApp((s) => s.openEntry);
  const entry = useApp((s) => s.entry);
  const imageProxy = useApp((s) => s.imageProxy);
  const detailOrigin = useUI((s) => s.detailOrigin);
  const setDetailOrigin = useUI((s) => s.setDetailOrigin);
  const { isCompact } = useViewport();
  const [tab, setTab] = useState<'article' | 'comments' | 'transcript'>('article');
  const [railTab, setRailTab] = useState<'comments' | 'transcript'>('comments');
  const playerActive = usePlayer((s) => s.entry !== null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const commentsRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    setRailTab(entry?.audioUrl ? 'transcript' : 'comments');
  }, [entry?.id, entry?.audioUrl]);

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

    const ease = 'cubic-bezier(0.22, 0.8, 0.24, 1)';

    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;

      // The ghost has landed exactly on the picture that the hero shows, so the
      // hero can fade in underneath it: the picture itself does not move or
      // change, only the blurred bands around it appear.
      const commit = () => {
        if (closingRef.current) return;
        hero.style.transition = 'opacity 140ms ease-out';
        hero.style.opacity = '1';
        window.setTimeout(() => {
          if (closingRef.current) return;
          const ghost = ghostRef.current;
          if (!ghost) return;
          ghost.style.transition = 'none';
          ghost.style.opacity = '0';
          // Keep the element mounted but hidden: the return flight needs it.
          ghost.style.display = 'none';
        }, 150);
      };

      const img = heroPicture(hero);
      if (!img) {
        commit();
        return;
      }
      const decoded = img.decode ? img.decode().catch(() => undefined) : Promise.resolve();
      if (img.complete) {
        void decoded.then(commit);
        return;
      }
      img.addEventListener('load', () => void decoded.then(commit), { once: true });
      // If the image never reports load, still hand off rather than leaving a
      // ghost floating over the article.
      window.setTimeout(commit, 400);
    };

    let started = false;
    const start = () => {
      if (started) return;
      started = true;

      // The hero shows the whole picture (`object-contain`), so the flight must
      // land on that visible rectangle, not on the full-width box: there cover
      // and contain agree and the hand-off cannot jump.
      const target = containedBox(to, heroPicture(hero));

      ghostEl.style.transition = 'none';
      ghostEl.style.left = `${from.x}px`;
      ghostEl.style.top = `${from.y}px`;
      ghostEl.style.width = `${from.width}px`;
      ghostEl.style.height = `${from.height}px`;
      ghostEl.style.borderRadius = `${CARD_IMAGE_RADIUS}px`;
      ghostEl.style.opacity = '1';
      void ghostEl.offsetWidth;

      // The box itself is animated rather than scaled: the picture is `cover`ed,
      // so it re-crops as it grows instead of stretching on the way.
      ghostEl.style.transition = [
        `left ${IMAGE_FLIGHT}ms ${ease}`,
        `top ${IMAGE_FLIGHT}ms ${ease}`,
        `width ${IMAGE_FLIGHT}ms ${ease}`,
        `height ${IMAGE_FLIGHT}ms ${ease}`,
        `border-radius ${IMAGE_FLIGHT}ms ease`,
      ].join(', ');
      ghostEl.style.left = `${target.x}px`;
      ghostEl.style.top = `${target.y}px`;
      ghostEl.style.width = `${target.width}px`;
      ghostEl.style.height = `${target.height}px`;
      ghostEl.style.borderRadius = `${CARD_IMAGE_RADIUS}px`;

      ghostEl.addEventListener('transitionend', land, { once: true });
      // A transition that never finishes (tab hidden, image swap) must land.
      window.setTimeout(land, IMAGE_FLIGHT + 120);
    };

    const picture = heroPicture(hero);
    if (picture && !picture.complete) {
      // The letterboxing is only known once the picture's intrinsic size is.
      picture.addEventListener('load', start, { once: true });
      window.setTimeout(start, 400);
    } else {
      start();
    }
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
    // On desktop the close button sits outside the panel, over the backdrop.
    const closeBtn = closeRef.current;
    if (closeBtn && !reducedMotion) {
      closeBtn.style.transition = 'opacity 200ms ease-in';
      closeBtn.style.opacity = '0';
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
      // Start from the picture the hero actually shows (letterboxed inside its
      // box), so the first frame of the return matches it exactly.
      const from = containedBox(heroRect, heroPicture(hero));
      const to = origin.image;

      ghostEl.style.transition = 'none';
      ghostEl.style.display = 'block';
      ghostEl.style.left = `${from.x}px`;
      ghostEl.style.top = `${from.y}px`;
      ghostEl.style.width = `${from.width}px`;
      ghostEl.style.height = `${from.height}px`;
      ghostEl.style.borderRadius = `${CARD_IMAGE_RADIUS}px`;
      ghostEl.style.opacity = '1';
      // Fade the hero out instead of hiding it in one frame: its blurred bands
      // would otherwise disappear abruptly at the very start of the exit.
      hero.style.transition = 'opacity 160ms ease-in';
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
      ghostEl.style.borderRadius = `${CARD_IMAGE_RADIUS}px`;
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
      const root = rootRef.current;
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
      ref={rootRef}
      className={cn(
        'fixed inset-0 z-50 flex justify-center',
        playerActive
          ? isCompact
            ? 'items-start p-0'
            : 'items-end px-5 pt-5'
          : 'items-center p-0 lg:p-5',
      )}
      style={
        playerActive && !isCompact
          ? { paddingBottom: PLAYER_DOCK_SPACE.desktop }
          : undefined
      }
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

      {/* Xiaohongshu puts the note's close button in the page corner, outside
          the card, so the card itself stays free of chrome. */}
      {!isCompact && (
        <button
          ref={closeRef}
          type="button"
          title="关闭 (Esc)"
          aria-label="关闭"
          className={cn(
            'absolute left-6 top-6 z-20 flex h-10 w-10 animate-fade-in items-center justify-center rounded-full',
            'bg-background/90 text-fg/85 shadow-pop backdrop-blur transition-colors hover:bg-background',
          )}
          onClick={close}
        >
          <X size={20} />
        </button>
      )}

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
            borderRadius: CARD_IMAGE_RADIUS,
            ...(ghost.kind === 'image'
              ? {
                  backgroundImage: `url("${ghost.url}")`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }
              : {
                  // The drawn cover's tint is translucent, but the flying layer
                  // must look exactly like the card/hero it comes from: paint
                  // it over the theme surface so it is opaque. A translucent
                  // ghost pops when the hero's opaque cover replaces it.
                  background: `linear-gradient(${coverTint(ghost.seed, ghost.color)}, ${coverTint(ghost.seed, ghost.color)}), hsl(var(--fo-background))`,
                }),
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
        style={{
          borderRadius: playerActive
            ? `${CARD_IMAGE_RADIUS}px ${CARD_IMAGE_RADIUS}px 0 0`
            : CARD_IMAGE_RADIUS,
          height: playerActive
            ? isCompact
              ? `calc(100vh - ${PLAYER_DOCK_SPACE.compact})`
              : `min(calc(100vh - ${PLAYER_DOCK_SPACE.desktop} - 1.25rem), 862px)`
            : undefined,
        }}
        className={cn(
          'relative z-10 flex h-[min(92vh,920px)] w-[min(1200px,calc(100vw-144px))] flex-col overflow-hidden',
          'bg-background shadow-modal dark:border dark:border-border',
          plainOpen.current ? 'animate-scale-in' : '',
          isCompact && 'h-full w-full dark:border-0',
        )}
      >
        {isCompact && (
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
            {entry?.audioUrl && (
              <button
                type="button"
                aria-pressed={tab === 'transcript'}
                onClick={() => {
                  setRailTab('transcript');
                  setTab('transcript');
                }}
                className={cn(
                  'rounded-md px-2.5 py-1 text-headline font-medium transition-colors',
                  tab === 'transcript' ? 'bg-item-active text-fg' : 'text-fg/50 hover:text-fg/85',
                )}
              >
                字幕
              </button>
            )}
            <button
              type="button"
              aria-pressed={tab === 'comments'}
              onClick={() => {
                setRailTab('comments');
                setTab('comments');
              }}
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

          {/* Right rail, Xiaohongshu's note layout: the author bar pinned on
              top, the note's tags/meta and the comment thread scrolling
              together, and the interaction bar pinned at the bottom. */}
          <aside
            className={cn(
              'flex min-h-0 flex-col bg-background',
              isCompact
                ? 'w-full min-w-0 flex-1'
                : 'w-rail shrink-0 border-l border-border',
              isCompact && tab === 'article' && 'hidden',
            )}
          >
            <AuthorBar />
            {entry?.audioUrl && !isCompact && (
              <div className="flex h-11 shrink-0 items-center gap-5 border-b border-border px-6">
                <button
                  type="button"
                  onClick={() => setRailTab('transcript')}
                  className={cn(
                    'relative h-full text-callout font-medium transition-colors',
                    railTab === 'transcript' ? 'text-fg/85' : 'text-fg/50 hover:text-fg/85',
                  )}
                >
                  字幕
                  {railTab === 'transcript' && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-accent" />}
                </button>
                <button
                  type="button"
                  onClick={() => setRailTab('comments')}
                  className={cn(
                    'relative h-full text-callout font-medium transition-colors',
                    railTab === 'comments' ? 'text-fg/85' : 'text-fg/50 hover:text-fg/85',
                  )}
                >
                  讨论{entry.commentsCount > 0 ? ` ${entry.commentsCount}` : ''}
                  {railTab === 'comments' && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-accent" />}
                </button>
              </div>
            )}
            <div className="scrollbar-thin min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
              {entry?.audioUrl && railTab === 'transcript' ? (
                <TranscriptPane entry={entry} />
              ) : (
                <>
                  <NoteMeta />
                  <div ref={commentsRef} className="scroll-mt-2">
                    <CommentsPane />
                  </div>
                </>
              )}
            </div>
            {railTab === 'comments' && (
              <EngageBar
                onComment={() =>
                  commentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              />
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

/** Xiaohongshu's pinned author bar: round avatar, name and the follow pill. */
function AuthorBar() {
  const entry = useApp((s) => s.entry);

  if (!entry) {
    return (
      <div className="flex h-[72px] shrink-0 items-center gap-3 border-b border-border px-6">
        <div className="skeleton h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-3 w-1/2 rounded" />
          <div className="skeleton h-2.5 w-1/3 rounded" />
        </div>
        <div className="skeleton h-9 w-[84px] rounded-full" />
      </div>
    );
  }

  return <AuthorBarLoaded entry={entry} />;
}

function AuthorBarLoaded({ entry }: { entry: EntryDetail }) {
  const feeds = useApp((s) => s.feeds);
  const selectFeed = useApp((s) => s.selectFeed);
  const openEntry = useApp((s) => s.openEntry);
  const [busy, setBusy] = useState(false);

  // The feed is the author. After unfollowing, the open note outlives its feed,
  // so the last seen feed is remembered to follow it again from here.
  const feed = feeds.find((f) => f.id === entry.feedId);
  const lastFeed = useRef<Feed | null>(null);
  if (feed) lastFeed.current = feed;
  const remembered = lastFeed.current?.id === entry.feedId ? lastFeed.current : null;
  const following = feed ?? (remembered ? findFeedByUrl(feeds, remembered.url) : undefined);

  // Re-subscribing creates a new feed with new entries; move the modal onto
  // this note's twin so starring and comments keep working.
  const reopenIn = async (next: Feed) => {
    try {
      const page = await api.listEntries({ scope: 'feed', feedId: next.id, limit: 200, offset: 0 });
      const twin = page.entries.find(
        (e) => (entry.url && e.url === entry.url) || e.title === entry.title,
      );
      if (twin && useApp.getState().selectedEntryId === entry.id) void openEntry(twin.id);
    } catch {
      // The note stays open as it is; the feed is followed either way.
    }
  };

  const toggleFollow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (following) {
        await unfollowFeed(following, (next) => void reopenIn(next));
      } else if (remembered) {
        const next = await followFeed({
          url: remembered.url,
          title: remembered.title,
          categoryId: remembered.categoryId,
          view: remembered.view,
        });
        if (next) await reopenIn(next);
      }
    } finally {
      setBusy(false);
    }
  };

  const target = following ?? feed;

  return (
    <div className="flex h-[72px] w-full shrink-0 items-center gap-3 border-b border-border px-6">
      <button
        type="button"
        title={target ? '查看订阅源' : undefined}
        disabled={!target}
        onClick={() => {
          if (!target) return;
          void selectFeed(target.id);
          void openEntry(null);
        }}
        className="group flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
      >
        <FeedIcon
          title={entry.feedTitle}
          iconUrl={entry.feedIcon}
          size={40}
          className="!rounded-full ring-1 ring-border"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-headline font-medium text-fg/85 transition-colors group-hover:text-fg">
            {entry.feedTitle}
          </span>
          <span className="mt-0.5 block truncate text-footnote text-fg/50">
            {entry.author || hostOf(entry.url) || '订阅源'}
          </span>
        </span>
      </button>
      {(following || remembered) && (
        <button
          type="button"
          disabled={busy}
          aria-pressed={!!following}
          title={following ? '取消关注' : '关注这个订阅源'}
          onClick={() => void toggleFollow()}
          className={cn(
            'group/follow flex h-9 min-w-[84px] shrink-0 items-center justify-center rounded-full px-5 text-callout font-medium transition-colors disabled:opacity-60',
            following
              ? 'bg-fill text-fg/50 hover:bg-item-hover hover:text-fg/85'
              : 'bg-accent text-white hover:opacity-90',
          )}
        >
          {busy ? (
            <Spinner size={14} />
          ) : following ? (
            <>
              <span className="group-hover/follow:hidden">已关注</span>
              <span className="hidden group-hover/follow:inline">取消关注</span>
            </>
          ) : (
            '关注'
          )}
        </button>
      )}
    </div>
  );
}

/** The note's topic tags and its date line, above the comment thread. */
function NoteMeta() {
  const entry = useApp((s) => s.entry);
  if (!entry) return null;

  const tags = [
    VIEWS.find((v) => v.key === entry.feedView)?.label ?? '文章',
    entry.feedTitle,
  ].filter(Boolean);

  return (
    <div className="px-6 pt-4">
      <p className="flex flex-wrap gap-x-2 gap-y-1 text-callout leading-relaxed text-fg/50">
        {tags.map((tag, i) => (
          <span key={i}>#{tag}</span>
        ))}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-fill/60 px-2 py-1 text-footnote text-fg/50">
          <Calendar size={12} />
          {formatDate(entry.publishedAt)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-fill/60 px-2 py-1 text-footnote text-fg/50">
          <Clock size={12} />
          {entry.audioUrl
            ? entry.audioDuration > 0
              ? `单集 ${formatClock(entry.audioDuration)}`
              : '播客'
            : `约 ${entry.readingMinutes} 分钟`}
        </span>
      </div>

      <div className="mt-4 h-px bg-border" />
    </div>
  );
}

/**
 * Xiaohongshu's bottom interaction bar. The "说点什么…" field becomes a way to
 * join the discussion on the source page, since comments live there.
 */
function EngageBar({ onComment }: { onComment: () => void }) {
  const entry = useApp((s) => s.entry);
  const toggleStar = useApp((s) => s.toggleStar);
  const toggleReadLater = useApp((s) => s.toggleReadLater);
  const pushToast = useUI((s) => s.pushToast);
  // An unfollowed feed's entries are gone from the database; the open note is
  // only a snapshot until it is followed again.
  const orphaned = useApp((s) => !!s.entry && !s.feeds.some((f) => f.id === s.entry!.feedId));

  if (!entry) {
    return <div className="h-[65px] shrink-0 border-t border-border" />;
  }

  const action =
    'flex h-10 shrink-0 items-center gap-1 rounded-full px-2 text-callout text-fg/50 transition-colors hover:bg-fill hover:text-fg/85 disabled:opacity-40';

  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-border px-4 py-3">
      <button
        type="button"
        disabled={!entry.url}
        onClick={() => openExternal(entry.url)}
        className="mr-1 flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-fill px-4 text-left text-callout text-fg/50 transition-colors hover:text-fg/85 disabled:opacity-50"
      >
        <PenLine size={14} className="shrink-0" />
        <span className="truncate">去原文说点什么…</span>
      </button>
      <button
        type="button"
        title={orphaned ? '关注后可收藏' : entry.starred ? '取消收藏 (S)' : '收藏 (S)'}
        aria-pressed={entry.starred}
        disabled={orphaned}
        onClick={() => void toggleStar(entry.id)}
        className={action}
      >
        <Star
          size={20}
          className={entry.starred ? 'fill-amber-400 text-amber-400' : undefined}
        />
        收藏
      </button>
      <button type="button" title="评论" onClick={onComment} className={action}>
        <MessageCircle size={20} />
        <span className="tabular-nums">
          {entry.commentsCount > 0 ? entry.commentsCount : '评论'}
        </span>
      </button>
      <button
        type="button"
        title={orphaned ? '关注后可加入稍后读' : entry.readLater ? '移出稍后读' : '加入稍后读'}
        aria-pressed={entry.readLater}
        disabled={orphaned}
        onClick={() => void toggleReadLater(entry.id)}
        className={cn(action, entry.readLater && 'text-accent hover:text-accent')}
      >
        <BookmarkPlus size={20} />
      </button>
      <button
        type="button"
        title="分享（复制链接）"
        disabled={!entry.url}
        onClick={() => {
          void navigator.clipboard?.writeText(entry.url);
          pushToast({ message: '已复制链接', tone: 'success' });
        }}
        className={action}
      >
        <Share2 size={20} />
      </button>
    </div>
  );
}
