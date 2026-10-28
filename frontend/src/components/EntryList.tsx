import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownUp,
  AudioLines,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleDot,
  Compass,
  Folder,
  LayoutGrid,
  LayoutList,
  Pause,
  Play,
  RefreshCw,
  Rss,
  Search,
  Settings as SettingsIcon,
  Star,
} from 'lucide-react';
import { useApp } from '../store/app';
import { usePlayer } from '../store/player';
import { useUI } from '../store/ui';
import { useCountdownToast } from './overlays';
import { VIEWS, HOME_VIEW, type Entry, type Scope } from '../lib/types';
import { cardRatio, cn, detailOriginOf, formatClock, groupLabel, relativeTime } from '../lib/utils';
import {
  AnimatedArticlesIcon,
  AnimatedAudioIcon,
  AnimatedHomeIcon,
  AnimatedPicturesIcon,
  AnimatedSocialIcon,
  AnimatedVideosIcon,
  SmartReadLaterIcon,
  SmartStarredIcon,
  SmartTodayIcon,
  SmartUnreadIcon,
} from './AnimatedIcons';
import { FeedSwitcher } from './FeedSwitcher';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { useViewport } from '../hooks/useViewport';
import { CardImage, CoverArt, coverTint, FeedIcon, IconButton, MasonryGrid, RemoteImage, Spinner } from './primitives';

/** Inline glyphs for the five views, sized for the header capsule group. */
type ViewGlyphProps = { viewKey: string; size?: number; filled?: boolean };
function ViewGlyph({ viewKey, size = 14, filled = false }: ViewGlyphProps) {
  switch (viewKey) {
    case 'all':
      return <AnimatedHomeIcon size={size} filled={filled} />;
    case 'articles':
      return <AnimatedArticlesIcon size={size} filled={filled} />;
    case 'social':
      return <AnimatedSocialIcon size={size} filled={filled} />;
    case 'pictures':
      return <AnimatedPicturesIcon size={size} filled={filled} />;
    case 'videos':
      return <AnimatedVideosIcon size={size} filled={filled} />;
    case 'audio':
      return <AnimatedAudioIcon size={size} filled={filled} />;
    default:
      return <AnimatedHomeIcon size={size} filled={filled} />;
  }
}

/** The four smart lists, as one compact filter group in the list header.
 *
 * Only the selected one expands to show its name; the rest stay icon-only, so
 * the group reads as a single circular control rather than four labels
 * (DESIGN.md §7.5). */
const SMART_FILTERS: { scope: Extract<Scope, 'unread' | 'starred' | 'readLater' | 'today'>; label: string; Icon: typeof SmartUnreadIcon }[] = [
  { scope: 'unread', label: '未读', Icon: SmartUnreadIcon },
  { scope: 'starred', label: '星标', Icon: SmartStarredIcon },
  { scope: 'readLater', label: '稍后读', Icon: SmartReadLaterIcon },
  { scope: 'today', label: '今天', Icon: SmartTodayIcon },
];


/* --------------------------------------------------------------- one row */

interface RowProps {
  entry: Entry;
  selected: boolean;
  dimRead: boolean;
  edgeToEdge: boolean;
  /** This row has become the open article modal: keep the slot, draw nothing. */
  blank: boolean;
  /** The feed icon's dominant colour, the tint of the drawn cover. */
  feedColor?: string;
  /** Loopback image proxy origin, or '' to load images directly. */
  imageProxy: string;
  /** The clicked element is where the detail modal grows out of (DESIGN.md §7.11). */
  onSelect: (entry: Entry, el: HTMLElement) => void;
  onContextMenu: (e: React.MouseEvent, entry: Entry) => void;
}

/**
 * Timeline row. The unread dot sits inside the row's left padding, right
 * against the feed icon, so it never hangs outside the reading column.
 */
function EntryRow({ entry, selected, dimRead, edgeToEdge, blank, feedColor, imageProxy, onSelect, onContextMenu }: RowProps) {
  const dimmed = dimRead && entry.read;
  const isCurrent = usePlayer((s) => s.entry?.id === entry.id);
  const playing = usePlayer((s) => s.playing);
  const livePosition = usePlayer((s) => (s.entry?.id === entry.id ? s.position : 0));
  const playEntry = usePlayer((s) => s.playEntry);
  const toggle = usePlayer((s) => s.toggle);
  const total = entry.audioDuration;
  const percent = isCurrent && total > 0 ? Math.min(100, (livePosition / total) * 100) : 0;

  const play = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCurrent) void toggle();
    else void playEntry(entry);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-active={selected}
      onClick={(e) => onSelect(entry, e.currentTarget)}
      onContextMenu={(e) => onContextMenu(e, entry)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect(entry, e.currentTarget);
      }}
      className={cn(
        'group relative block w-full cursor-default text-left transition-colors duration-200',
        'hover:bg-item-hover',
        selected && 'bg-item-active',
        edgeToEdge ? 'rounded-none' : 'rounded-card',
        blank && 'invisible',
      )}
    >
      {!entry.read && (
        <span
          aria-label="未读"
          className="absolute left-[3px] top-[25px] h-1.5 w-1.5 rounded-full bg-accent"
        />
      )}

      <div className="relative flex px-3 py-3.5">
        <FeedIcon
          title={entry.feedTitle}
          iconUrl={entry.feedIcon}
          size={24}
          className="mt-0.5 mr-2"
        />

        <div className="-mt-0.5 ml-1 min-w-0 flex-1 text-headline leading-tight">
          {/* Meta: feed name · relative time */}
          <div
            className={cn(
              'flex min-w-0 items-center gap-1 text-footnote',
              dimmed ? 'text-fg/25' : 'text-fg/50',
            )}
          >
            <span className="truncate">{entry.feedTitle}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0 tabular-nums">{relativeTime(entry.publishedAt)}</span>
            {entry.audioUrl && (
              <>
                <span aria-hidden>·</span>
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-0.5 tabular-nums',
                    isCurrent && 'text-accent',
                  )}
                >
                  <AudioLines size={12} />
                  {total > 0
                    ? formatClock(isCurrent && livePosition > 0 ? livePosition : total)
                    : '播客'}
                </span>
              </>
            )}
            {entry.starred && <Star size={12} className="shrink-0 fill-amber-400 text-amber-400" />}
          </div>

          <h3
            className={cn(
              'my-1 line-clamp-2 break-words font-medium',
              dimmed ? 'text-fg/50' : 'text-fg/85',
            )}
          >
            {entry.title}
          </h3>

          {entry.summary && (
            <p className="line-clamp-2 text-callout text-fg/50">{entry.summary}</p>
          )}
        </div>

        <div
          className="relative ml-3 h-20 w-20 shrink-0 overflow-hidden rounded"
          style={entry.imageUrl ? undefined : { background: coverTint(entry.feedTitle || entry.title, feedColor) }}
        >
          {entry.imageUrl ? (
            <RemoteImage
              src={entry.imageUrl}
              proxy={imageProxy}
              referer={entry.url}
              className="h-full w-full"
            />
          ) : (
            <CoverArt thumb title={entry.title} seed={entry.feedTitle || entry.title} color={feedColor} />
          )}
          {entry.audioUrl && (
            <button
              type="button"
              title={isCurrent && playing ? '暂停' : '播放这一期'}
              aria-label={isCurrent && playing ? '暂停' : '播放这一期'}
              onClick={play}
              onKeyDown={(e) => e.stopPropagation()}
              className={cn(
                'absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity',
                isCurrent
                  ? 'opacity-100'
                  : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100',
              )}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/90 text-fg/85 shadow-pop">
                {isCurrent && playing ? (
                  <Pause size={14} fill="currentColor" />
                ) : (
                  <Play size={14} fill="currentColor" className="ml-0.5" />
                )}
              </span>
            </button>
          )}
          {percent > 0 && (
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-black/35">
              <span className="block h-full bg-accent" style={{ width: `${percent}%` }} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ one card */

interface CardProps {
  entry: Entry;
  selected: boolean;
  dimRead: boolean;
  /** The feed icon's dominant colour, used as the feed's theme tint. */
  feedColor?: string;
  /** Loopback image proxy origin, or '' to load images directly. */
  imageProxy: string;
  /** The clicked element is where the detail modal grows out of (DESIGN.md §7.11). */
  onSelect: (entry: Entry, el: HTMLElement) => void;
  onContextMenu: (e: React.MouseEvent, entry: Entry) => void;
}

/**
 * Waterfall card, for the masonry layout (DESIGN.md §7.7).
 *
 * Unlike the row this is image-first: the picture keeps its own aspect ratio,
 * so cards end up with different heights and the two columns interlock like a
 * waterfall. The row's summary is dropped — the card is about the picture and
 * the title.
 */
function EntryCard({ entry, selected, dimRead, feedColor, imageProxy, onSelect, onContextMenu }: CardProps) {
  const dimmed = dimRead && entry.read;
  const isCurrent = usePlayer((s) => s.entry?.id === entry.id);
  const playing = usePlayer((s) => s.playing);
  const playEntry = usePlayer((s) => s.playEntry);
  const toggle = usePlayer((s) => s.toggle);

  return (
    <div
      role="button"
      tabIndex={0}
      data-active={selected}
      onClick={(e) => onSelect(entry, e.currentTarget)}
      onContextMenu={(e) => onContextMenu(e, entry)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect(entry, e.currentTarget);
      }}
      className={cn(
        'group relative block w-full cursor-default overflow-hidden rounded-lg border border-border',
        'bg-fill/20 text-left transition-colors duration-200 hover:bg-item-hover',
        selected && 'border-accent/60 ring-1 ring-accent/40',
      )}
    >
      <div className="relative">
        <CardImage
          src={entry.imageUrl}
          proxy={imageProxy}
          referer={entry.url}
          seed={entry.feedTitle || entry.title}
          ratio={cardRatio(entry.id)}
          color={feedColor}
          title={entry.title}
          fallback={<FeedIcon title={entry.feedTitle} iconUrl={entry.feedIcon} size={22} />}
        />
        {entry.audioUrl && (
          <button
            type="button"
            title={isCurrent && playing ? '暂停' : '播放这一期'}
            aria-label={isCurrent && playing ? '暂停' : '播放这一期'}
            onClick={(e) => {
              e.stopPropagation();
              if (isCurrent) void toggle();
              else void playEntry(entry);
            }}
            className={cn(
              'absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full',
              'bg-background/90 text-fg shadow-pop backdrop-blur transition-transform active:scale-95',
            )}
          >
            {isCurrent && playing ? (
              <Pause size={14} fill="currentColor" />
            ) : (
              <Play size={14} fill="currentColor" className="ml-0.5" />
            )}
          </button>
        )}
        {entry.audioUrl && entry.audioDuration > 0 && (
          <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-1.5 py-0.5 text-footnote font-medium tabular-nums text-white backdrop-blur">
            {formatClock(entry.audioDuration)}
          </span>
        )}
      </div>

      <div className="p-2">
        {/* Without a picture the title already lives on the cover; repeating it
            underneath would show the same sentence twice in one card. */}
        {entry.imageUrl && (
          <h3
            className={cn(
              'line-clamp-3 break-words text-headline font-medium leading-snug',
              dimmed ? 'text-fg/50' : 'text-fg/85',
            )}
          >
            {entry.title}
          </h3>
        )}
        <div
          className={cn(
            'flex min-w-0 items-center gap-1 text-footnote',
            entry.imageUrl ? 'mt-1.5' : 'mt-0.5',
            dimmed ? 'text-fg/25' : 'text-fg/50',
          )}
        >
          <FeedIcon title={entry.feedTitle} iconUrl={entry.feedIcon} size={16} />
          <span className="truncate">{entry.feedTitle}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0 tabular-nums">{relativeTime(entry.publishedAt)}</span>
          {entry.starred && <Star size={12} className="shrink-0 fill-amber-400 text-amber-400" />}
        </div>
      </div>

      {!entry.read && (
        <span
          aria-label="未读"
          className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent ring-2 ring-background"
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ entry list */

interface EntryListProps {
  /** Phone layout: the list owns the whole screen. */
  mobileFullWidth?: boolean;
}

export function EntryList({ mobileFullWidth = false }: EntryListProps) {
  const {
    entries,
    total,
    hasMore,
    loadingEntries,
    loadingEntry,
    selection,
    feeds,
    categories,
    settings,
    counts,
    unreadOnly,
    search,
    selectedEntryId,
    loadMore,
    openEntry,
    selectSmart,
    selectView,
    setSearch,
    setUnreadOnly,
    markRead,
    toggleStar,
    refresh,
    refreshing,
    progress,
    updateSettings,
    imageProxy,
  } = useApp();

  const {
    openContextMenu,
    pushToast,
    setPaletteOpen,
    setSettingsOpen,
    setDiscoverOpen,
    setDetailOrigin,
  } = useUI();
  const countdownToast = useCountdownToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  // Phones turn the smart-filter group into a floating bottom bar (§7.5).
  const { isCompact } = useViewport();
  // The podcast dock floats at the bottom; keep the last row reachable.
  const playerActive = usePlayer((s) => Boolean(s.entry));

  /* Pull down from the top of the list to refresh. Stable identity so the
     gesture listeners are not re-bound on every render. */
  const onPullRefresh = useCallback(async () => {
    const { selection: current } = useApp.getState();
    await refresh(current.scope === 'feed' && current.feedId ? [current.feedId] : undefined);
  }, [refresh]);
  const pull = usePullToRefresh(onPullRefresh, scrollRef);

  /* Feed switcher row under the header; its panel drops down over the list. */
  const [switcherOpen, setSwitcherOpen] = useState(false);
  useEffect(() => {
    if (!switcherOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSwitcherOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [switcherOpen]);

  /* Infinite scroll: fetch the next page a screen before the end. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) void loadMore();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [loadMore]);

  /* Reset scroll when the selection changes. */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [selection.scope, selection.feedId, selection.categoryId, selection.view, search, unreadOnly]);

  const heading = useMemo(() => {
    if (selection.scope === 'feed') {
      const feed = feeds.find((f) => f.id === selection.feedId);
      return { title: feed?.title ?? '订阅源', icon: feed?.iconUrl ?? '' };
    }
    if (selection.scope === 'category') {
      const cat = categories.find((c) => c.id === selection.categoryId);
      return { title: cat?.name ?? '分组', icon: '' };
    }
    switch (selection.scope) {
      case 'starred':
        return { title: '星标', icon: '' };
      case 'readLater':
        return { title: '稍后读', icon: '' };
      case 'today':
        return { title: '今天', icon: '' };
      case 'unread':
        return { title: '未读', icon: '' };
      default: {
        const view = selection.view;
        const label =
          view === 'all'
            ? '首页'
            : (VIEWS.find((v) => v.key === view)?.label ?? '文章');
        return { title: label, icon: '' };
      }
    }
  }, [selection, feeds, categories]);

  /* What the floating switcher bar reports as the current feed context. */
  const activeFeed =
    selection.scope === 'feed' ? feeds.find((f) => f.id === selection.feedId) : undefined;
  const activeCategory =
    selection.scope === 'category'
      ? categories.find((c) => c.id === selection.categoryId)
      : undefined;
  const switcherLabel = activeFeed?.title ?? activeCategory?.name ?? '所有订阅源';

  /** Edge-to-edge rows, as in Folo's "All" timeline. */
  const edgeToEdge = selection.scope === 'all' && selection.view === 'all';

  /** Waterfall card layout instead of timeline rows (DESIGN.md §7.7). */
  const masonry = settings.entryLayout === 'masonry';

  /** Feed icon colours, so cards use the source's own theme tint. */
  const feedColors = useMemo(
    () => new Map(feeds.map((f) => [f.id, f.color] as const)),
    [feeds],
  );

  const handleMarkAll = () => {
    if (total === 0) {
      pushToast({ message: '当前列表没有文章', tone: 'info' });
      return;
    }
    // Folo confirms this with a countdown toast that can still be undone.
    countdownToast(3, () => {
      void (async () => {
        const n = await useApp.getState().markAllRead();
        pushToast({ message: `已将 ${n} 篇文章标记为已读`, tone: 'success' });
      })();
    });
  };

  const entryMenu = (e: React.MouseEvent, entry: Entry) => {
    e.preventDefault();
    const player = usePlayer.getState();
    const current = player.entry?.id === entry.id;
    openContextMenu(e.clientX, e.clientY, [
      ...(entry.audioUrl
        ? [
            {
              label: current && player.playing ? '暂停播客' : '播放这一期',
              onSelect: () => {
                if (current) void player.toggle();
                else void player.playEntry(entry);
              },
            },
          ]
        : []),
      {
        label: entry.read ? '标记为未读 (M)' : '标记为已读 (M)',
        onSelect: () => void markRead([entry.id], !entry.read),
      },
      {
        label: entry.starred ? '取消星标 (S)' : '加星标 (S)',
        onSelect: () => void toggleStar(entry.id),
      },
      {
        label: '在浏览器中打开 (B)',
        separatorBefore: true,
        disabled: !entry.url,
        onSelect: () => openUrl(entry.url),
      },
      {
        label: '复制链接',
        disabled: !entry.url,
        onSelect: () => {
          void navigator.clipboard?.writeText(entry.url);
          pushToast({ message: '已复制链接', tone: 'success' });
        },
      },
    ]);
  };

  /* 首页 + the four smart lists, as one capsule group: in the header on wide
     windows, as the floating bottom bar on phones (DESIGN.md §7.5). */
  const renderSmartGroup = (compact: boolean) => {
    const iconSize = compact ? 16 : 14;
    const idleSize = compact ? 'w-9' : 'w-6';
    // Only padding/gap: the height comes from the shared line below.
    const activeSize = compact ? 'gap-1 px-2.5' : 'gap-1 px-2';
    const homeActive = selection.scope === 'all' && selection.view === 'all';
    const item = (
      key: string,
      active: boolean,
      label: string,
      icon: ReactNode,
      count: number,
      onSelect: () => void,
      // CSS mount point for the icon's motion: index.css only animates
      // `.smart-row ... .smart-icon` and `.view-tab ... .view-icon`. Dropping
      // these classes silently turns the animated glyphs static.
      mount: 'smart-row' | 'view-tab',
    ) => (
      <button
        key={key}
        type="button"
        title={active ? undefined : label}
        aria-pressed={active}
        data-active={active}
        data-smart={key}
        onClick={onSelect}
        className={cn(
          mount,
          'flex items-center justify-center rounded-full text-fg/50 transition-colors duration-150',
          'hover:bg-item-hover hover:text-fg/85',
          compact ? 'h-9' : 'h-6',
          active ? cn(activeSize, 'bg-background text-fg/85 shadow-sm') : idleSize,
        )}
      >
        {icon}
        {active && (
          <span
            className={cn('font-medium leading-none', compact ? 'text-callout' : 'text-footnote')}
          >
            {label}
          </span>
        )}
        {active && settings.sidebarShowUnreadCount && count > 0 && (
          <span
            className={cn(
              'leading-none tabular-nums text-fg/50',
              compact ? 'text-subheadline' : 'text-footnote',
            )}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
    );

    return (
      <div
        className={cn(
          'flex shrink-0 items-center',
          compact
            ? 'w-full justify-between gap-1'
            : 'pointer-events-auto gap-0.5 rounded-full border border-border/70 bg-background/85 p-0.5 shadow-pop backdrop-blur-xl',
        )}
      >
        {/* 首页 draws the animated house, so it needs the view-tab mount point. */}
        {item(
          'home',
          homeActive,
          HOME_VIEW.label,
          <AnimatedHomeIcon size={iconSize} filled={homeActive} />,
          counts.all,
          () => void selectView('all'),
          'view-tab',
        )}
        {SMART_FILTERS.map((filter) =>
          item(
            filter.scope,
            selection.scope === filter.scope,
            filter.label,
            <filter.Icon size={iconSize} filled={selection.scope === filter.scope} />,
            counts[filter.scope],
            () => void selectSmart(filter.scope),
            'smart-row',
          ),
        )}
      </div>
    );
  };

  return (
    <section
      // The list is the page now; article details open in a modal. The
      // waterfall uses the full width, while the row layout centres itself at
      // a readable measure inside the scroll area.
      className={cn(
        'relative flex min-w-0 flex-1 flex-col bg-background',
        mobileFullWidth && 'w-full',
      )}
    >
      {/* Progressive blur beneath the floating bars, in the pills' material.
          The fade begins above the feed-switcher pill and is clear by the
          first row, so content softens into the bars without a hard strip. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[var(--h-float-top)] blur-top-progressive"
      />

      {/* Header ------------------------------------------------------- */}
      {/* The bars float over the list, so articles scroll underneath them
          instead of stopping at an opaque strip. Only the pills themselves
          take pointer events. */}
      <header
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 z-30 h-header w-full pt-2',
          mobileFullWidth ? 'px-2' : 'px-4',
        )}
      >
        {/* In list mode the header shares the reading column's edges, so the
            screen has a single alignment line (DESIGN-REVIEW §4.1). */}
        <div className={cn('flex h-full w-full items-center gap-2', !masonry && 'mx-auto max-w-col')}>
        {/* Filter groups: views (left) and smart lists (right). Each is one
            circular capsule; only the active item expands to show its name.
            The cluster scrolls rather than pushing the actions off a narrow
            column. DESIGN.md §7.5. */}
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-3 overflow-x-auto">
          {/* Feed / category name is the only title left: view and smart-list
              scopes state their own name inside the groups. */}
          {heading.icon || selection.scope === 'feed' || selection.scope === 'category' ? (
            <div className="flex min-w-0 shrink items-center gap-2">
              {heading.icon ? (
                <FeedIcon
                  title={heading.title}
                  iconUrl={heading.icon}
                  size={20}
                  className="shrink-0"
                />
              ) : null}
              <h2 className="max-w-[8rem] min-w-0 shrink truncate text-title2 font-bold text-fg/85">
                {heading.title}
              </h2>
            </div>
          ) : null}

          {/* Views */}
          <div className="pointer-events-auto flex shrink-0 items-center gap-0.5 rounded-full border border-border/70 bg-background/85 p-0.5 shadow-pop backdrop-blur-xl">
            {VIEWS.map((view, index) => {
              const active = selection.scope === 'all' && selection.view === view.key;
              const count =
                view.key === 'all'
                  ? counts.unread
                  : feeds.filter((f) => f.view === view.key).reduce((sum, f) => sum + f.unread, 0);
              return (
                <button
                  key={view.key}
                  type="button"
                  title={`${view.label} (${index + 1})`}
                  aria-pressed={active}
                  data-active={active}
                  data-view={view.key}
                  onClick={() => void selectView(view.key)}
                  className={cn(
                    'view-tab flex h-6 items-center justify-center rounded-full',
                    'transition-colors duration-150',
                    active
                      ? 'gap-1 bg-background px-2 text-fg/85 shadow-sm'
                      : 'w-6 text-fg/50 hover:bg-item-hover hover:text-fg/85',
                  )}
                >
                  <span style={active ? { color: view.color } : undefined}>
                    <ViewGlyph viewKey={view.key} filled={active} />
                  </span>
                  {active && (
                    <span className="text-footnote font-medium leading-none">{view.label}</span>
                  )}
                  {active && settings.sidebarShowUnreadCount && count > 0 && (
                    <span className="text-footnote leading-none tabular-nums text-fg/50">
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Smart lists (plus 首页). Phones move this group to the bottom bar. */}
          {!isCompact && renderSmartGroup(false)}
        </div>

        <div className="pointer-events-auto flex h-8 shrink-0 items-center gap-0.5 rounded-full border border-border/70 bg-background/85 px-1 shadow-pop backdrop-blur-xl">
          <IconButton
            title="刷新 (R)"
            disabled={refreshing}
            onClick={() => void refresh(selection.scope === 'feed' ? [selection.feedId] : undefined)}
          >
            {refreshing ? <Spinner size={14} /> : <RefreshCw size={14} />}
          </IconButton>
          <IconButton
            title={unreadOnly ? '显示全部 (U)' : '仅显示未读 (U)'}
            active={unreadOnly}
            onClick={() => setUnreadOnly(!unreadOnly)}
          >
            {unreadOnly ? <CircleDot size={16} /> : <Circle size={16} />}
          </IconButton>
          <IconButton
            title={settings.timelineSortAsc ? '按最新在前' : '按最早在前'}
            onClick={() => void updateSettings({ timelineSortAsc: !settings.timelineSortAsc })}
          >
            <ArrowDownUp size={16} />
          </IconButton>
          <IconButton title="全部标记为已读 (Shift+Ctrl+A)" onClick={handleMarkAll}>
            <CheckCircle2 size={16} />
          </IconButton>
        </div>
        </div>
      </header>

      {/* Feed switcher ------------------------------------------------ */}
      {/* A floating bar under the header holding what the sidebar used to:
          current context, discover, search, settings and the feed panel,
          which drops down over the list (DESIGN.md §7.6). */}
      {switcherOpen && (
        <div
          className="absolute inset-0 z-20"
          onClick={() => setSwitcherOpen(false)}
          aria-hidden="true"
        />
      )}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-[var(--h-header)] z-30 pb-1 pt-1',
          mobileFullWidth ? 'px-2' : 'px-4',
        )}
      >
        <div className={cn('relative w-full', !masonry && 'mx-auto max-w-col')}>
        <div className="pointer-events-auto flex h-9 w-full items-center rounded-full border border-border/70 bg-background/85 px-1 shadow-pop backdrop-blur-xl">
          <button
            type="button"
            aria-expanded={switcherOpen}
            data-switcher="toggle"
            onClick={() => setSwitcherOpen((v) => !v)}
            className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-full px-2 text-left transition-colors hover:bg-item-hover"
          >
            {refreshing && progress ? (
              <>
                <Spinner size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-headline font-medium text-fg/85">
                  正在刷新 {progress.done}/{progress.total}
                </span>
              </>
            ) : (
              <>
                {activeFeed ? (
                  <FeedIcon
                    title={activeFeed.title}
                    iconUrl={activeFeed.iconUrl}
                    size={16}
                    className="shrink-0"
                  />
                ) : activeCategory ? (
                  <Folder size={16} className="shrink-0 text-fg/50" />
                ) : (
                  <Rss size={16} className="shrink-0 text-fg/50" />
                )}
                <span className="min-w-0 flex-1 truncate text-headline font-medium text-fg/85">
                  {switcherLabel}
                </span>
              </>
            )}
            {switcherOpen ? (
              <ChevronUp size={14} className="shrink-0 text-fg/50" />
            ) : (
              <ChevronDown size={14} className="shrink-0 text-fg/50" />
            )}
          </button>
          <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
          <IconButton title="发现" onClick={() => setDiscoverOpen(true)}>
            <Compass size={16} />
          </IconButton>
          <IconButton title="搜索 (Ctrl+K)" onClick={() => setPaletteOpen(true)}>
            <Search size={16} />
          </IconButton>
          <IconButton
            title={masonry ? '列表模式' : '瀑布流模式'}
            active={masonry}
            onClick={() => void updateSettings({ entryLayout: masonry ? 'list' : 'masonry' })}
          >
            {masonry ? <LayoutList size={16} /> : <LayoutGrid size={16} />}
          </IconButton>
          <IconButton title="设置" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon size={16} />
          </IconButton>
        </div>

        {/* A sibling of the bar, not a child: a backdrop-filter nested inside
            another one only blurs its parent, so the panel would look clear. */}
        {switcherOpen && (
          <div className="absolute inset-x-0 top-full mt-1.5 flex max-h-[min(60vh,26rem)] flex-col overflow-hidden rounded-panel border border-border/70 bg-background/85 shadow-pop backdrop-blur-xl">
            <FeedSwitcher onNavigate={() => setSwitcherOpen(false)} />
          </div>
        )}
        </div>
      </div>

      {/* Rows --------------------------------------------------------- */}
      {/*
        The unread dot is drawn 12px to the left of each row, so the container
        needs at least that much horizontal padding for it to stay visible.
      */}
      <div
        ref={scrollRef}
        onClickCapture={pull.guardClick}
        className={cn(
          // Starts below the floating bars so the first row is not hidden, and
          // scrolls beneath them from there on.
          'scrollbar-thin touch-pan-y relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-[calc(var(--h-float-top)+0.5rem)]',
          // Phones float the smart-filter bar at the bottom, so the last cards
          // need clearance. The podcast dock adds one more layer when an
          // episode is loaded.
          isCompact
            ? playerActive
              ? 'pb-44'
              : 'pb-24'
            : playerActive
              ? 'pb-24'
              : 'pb-4',
        )}
      >
        {/* Pull-to-refresh indicator: revealed by dragging down at the top. */}
        <div
          className="pointer-events-none -mb-1 flex items-center justify-center overflow-hidden text-callout text-fg/50"
          style={{ height: Math.round(pull.pull), opacity: pull.pull > 4 || pull.refreshing ? 1 : 0 }}
        >
          {pull.refreshing ? (
            <>
              <Spinner size={14} className="mr-1.5" />
              正在刷新…
            </>
          ) : pull.pull >= pull.threshold ? (
            '松开刷新'
          ) : (
            '下拉刷新'
          )}
        </div>
        {search && (
          <div className={cn('mb-1 flex items-center gap-2 text-callout text-fg/50', !masonry && 'mx-auto w-full max-w-col')}>
            <span className="min-w-0 truncate">
              筛选：<span className="text-fg/85">{search}</span>
            </span>
            <button
              type="button"
              className="shrink-0 text-footnote text-fg/50 hover:text-fg/85"
              onClick={() => setSearch('')}
            >
              清除
            </button>
          </div>
        )}
        {loadingEntries && entries.length === 0 && <SkeletonRows />}

        {!loadingEntries && entries.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Circle size={22} className="text-fg/25" />
            <p className="text-headline font-medium text-fg/50">
              {search ? '没有匹配的文章' : '这里还没有文章'}
            </p>
          </div>
        )}

        {masonry ? (
          entries.length > 0 && (
            <MasonryGrid
              items={entries}
              getKey={(entry) => entry.id}
              renderItem={(entry) => (
                <div
                  data-entry-id={entry.id}
                  className={cn(
                    // The card IS the article modal while it is open: keep
                    // the slot in the wall (no reflow) but leave it empty.
                    // It comes back once the modal has shrunk into it
                    // (DESIGN.md §7.11).
                    entry.id === selectedEntryId && 'invisible',
                  )}
                >
                  <EntryCard
                    entry={entry}
                    selected={entry.id === selectedEntryId}
                    dimRead={settings.dimRead}
                    feedColor={feedColors.get(entry.feedId)}
                    imageProxy={imageProxy}
                    onSelect={(e, el) => {
                      setDetailOrigin(detailOriginOf(el, e, feedColors.get(e.feedId)));
                      void openEntry(e.id);
                    }}
                    onContextMenu={entryMenu}
                  />
                </div>
              )}
            />
          )
        ) : (
          <div className="mx-auto w-full max-w-col">
            {groupByDate(entries, settings.groupByDate).map((group) => (
              <div key={group.key}>
                {group.label && (
                  <div className="sticky top-[var(--h-float-top)] z-[1] -mx-4 bg-background/85 px-4 py-1.5 text-footnote font-medium text-fg/50 backdrop-blur">
                    {group.label}
                  </div>
                )}
                {group.entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    selected={entry.id === selectedEntryId}
                    dimRead={settings.dimRead}
                    edgeToEdge={edgeToEdge}
                    blank={entry.id === selectedEntryId}
                    feedColor={feedColors.get(entry.feedId)}
                    imageProxy={imageProxy}
                    onSelect={(e, el) => {
                      setDetailOrigin(detailOriginOf(el, e, feedColors.get(e.feedId)));
                      void openEntry(e.id);
                    }}
                    onContextMenu={entryMenu}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {hasMore && (
          <div className="flex items-center justify-center py-3 text-callout text-fg/50">
            <Spinner size={14} className="mr-2" />
            加载更多…（共 {total} 篇）
          </div>
        )}
        {!hasMore && entries.length > 0 && (
          <div className="flex items-center justify-center gap-1.5 py-4 text-footnote text-fg/25">
            <Check size={12} />
            已加载全部 {total} 篇文章
          </div>
        )}

        {loadingEntry && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden">
            <div className="h-full w-1/3 animate-shimmer bg-accent/70" />
          </div>
        )}
      </div>

      {/* Phones: 首页/未读/星标/稍后读/今天 become the floating bottom bar
          (DESIGN.md §7.5). */}
      {isCompact && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto w-full max-w-md rounded-full border border-border/70 bg-background/85 p-1 shadow-pop backdrop-blur-xl">
            {renderSmartGroup(true)}
          </div>
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- helpers */

function SkeletonRows() {
  return (
    <div className="space-y-3 pt-2">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex gap-3 px-1">
          <div className="skeleton h-6 w-6 shrink-0 rounded-md" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-2.5 w-24 rounded" />
            <div className="skeleton h-3.5 w-full rounded" />
            <div className="skeleton h-3 w-4/5 rounded" />
          </div>
          {i % 3 === 0 && <div className="skeleton h-20 w-20 shrink-0 rounded" />}
        </div>
      ))}
    </div>
  );
}

/** Optionally splits the list into sticky date groups. */
function groupByDate(
  entries: Entry[],
  enabled: boolean,
): { key: string; label: string | null; entries: Entry[] }[] {
  if (!enabled) return [{ key: 'all', label: null, entries }];

  const groups: { key: string; label: string; entries: Entry[] }[] = [];
  for (const entry of entries) {
    const label = groupLabel(entry.publishedAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.entries.push(entry);
    } else {
      groups.push({ key: `${label}-${entry.id}`, label, entries: [entry] });
    }
  }
  return groups;
}

function openUrl(url: string) {
  if (!url) return;
  void import('@wailsio/runtime')
    .then(({ Browser }) => Browser.OpenURL(url))
    .catch(() => window.open(url, '_blank', 'noopener'));
}
