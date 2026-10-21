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
import { CardImage, FeedIcon, IconButton, RemoteImage, Spinner } from './primitives';

/** Inline glyphs for the five views, sized for the header capsule group. */
type ViewGlyphProps = { viewKey: string; size?: number; filled?: boolean };
function ViewGlyph({ viewKey, size = 12, filled = false }: ViewGlyphProps) {
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
  /** Loopback image proxy origin, or '' to load images directly. */
  imageProxy: string;
  /** The clicked element is where the detail modal grows out of (DESIGN.md §7.11). */
  onSelect: (entry: Entry, el: HTMLElement) => void;
  onContextMenu: (e: React.MouseEvent, entry: Entry) => void;
}

/**
 * Timeline row. The unread indicator is an accent dot drawn 12px to the left
 * of the row, exactly as Folo does it — which is why the list needs horizontal
 * padding of at least 12px.
 */
function EntryRow({ entry, selected, dimRead, edgeToEdge, blank, imageProxy, onSelect, onContextMenu }: RowProps) {
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
        edgeToEdge ? 'rounded-none' : 'rounded-md',
        blank && 'invisible',
      )}
    >
      {/* Unread dot */}
      {!entry.read && (
        <span
          aria-label="未读"
          className="absolute -left-3 top-5 h-2 w-2 rounded-full bg-accent"
        />
      )}

      <div className="relative flex px-3 py-3.5">
        <FeedIcon
          title={entry.feedTitle}
          iconUrl={entry.feedIcon}
          size={24}
          className="mt-0.5 mr-2"
        />

        <div className="-mt-0.5 ml-1 min-w-0 flex-1 text-sm leading-tight">
          {/* Meta: feed name · relative time */}
          <div
            className={cn(
              'flex min-w-0 items-center gap-1 text-[10px] font-bold',
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
                    isCurrent ? 'text-accent' : 'text-fg/50',
                  )}
                >
                  <AudioLines size={10} />
                  {total > 0
                    ? formatClock(isCurrent && livePosition > 0 ? livePosition : total)
                    : '播客'}
                </span>
              </>
            )}
            {entry.starred && <Star size={10} className="shrink-0 fill-amber-400 text-amber-400" />}
          </div>

          <h3
            className={cn(
              'my-0.5 line-clamp-2 break-words font-medium',
              dimmed ? 'text-fg/50' : 'text-fg',
            )}
          >
            {entry.title}
          </h3>

          {entry.summary && (
            <p className="line-clamp-2 text-[13px] leading-snug text-fg/50">{entry.summary}</p>
          )}
        </div>

        {entry.audioUrl ? (
          <div className="relative ml-2 h-20 w-20 shrink-0 overflow-hidden rounded bg-gradient-to-br from-[#A855F7]/35 to-[#0EA5E9]/20">
            <span className="absolute inset-0 flex items-center justify-center text-fg/50">
              <AudioLines size={26} />
            </span>
            {entry.imageUrl && (
              <RemoteImage
                src={entry.imageUrl}
                proxy={imageProxy}
                referer={entry.url}
                className="relative h-full w-full"
              />
            )}
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
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/90 text-fg shadow-pop">
                {isCurrent && playing ? (
                  <Pause size={14} fill="currentColor" />
                ) : (
                  <Play size={14} fill="currentColor" className="ml-0.5" />
                )}
              </span>
            </button>
            {percent > 0 && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-black/35">
                <span className="block h-full bg-accent" style={{ width: `${percent}%` }} />
              </span>
            )}
          </div>
        ) : entry.imageUrl ? (
          <RemoteImage
            src={entry.imageUrl}
            proxy={imageProxy}
            referer={entry.url}
            className="ml-2 h-20 w-20 shrink-0 rounded"
          />
        ) : null}
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
          <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white backdrop-blur">
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
              dimmed ? 'text-fg/50' : 'text-fg',
            )}
          >
            {entry.title}
          </h3>
        )}
        <div
          className={cn(
            'flex min-w-0 items-center gap-1 text-[10px] font-bold',
            entry.imageUrl ? 'mt-1.5' : 'mt-0.5',
            dimmed ? 'text-fg/25' : 'text-fg/50',
          )}
        >
          <FeedIcon title={entry.feedTitle} iconUrl={entry.feedIcon} size={12} />
          <span className="truncate">{entry.feedTitle}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0 tabular-nums">{relativeTime(entry.publishedAt)}</span>
          {entry.starred && <Star size={10} className="shrink-0 fill-amber-400 text-amber-400" />}
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
  // The podcast dock floats above the bottom bars; keep the last row reachable.
  const playerActive = usePlayer((s) => Boolean(s.entry));

  /* Pull down from the top of the list to refresh. Stable identity so the
     gesture listeners are not re-bound on every render. */
  const onPullRefresh = useCallback(async () => {
    const { selection: current } = useApp.getState();
    await refresh(current.scope === 'feed' && current.feedId ? [current.feedId] : undefined);
  }, [refresh]);
  const pull = usePullToRefresh(onPullRefresh, scrollRef);

  /* Floating feed switcher at the bottom of the column. */
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

  /* Waterfall tracks: 2 on a phone, up to 5 on a wide page. */
  const [columns, setColumns] = useState(2);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      setColumns(width >= 1200 ? 5 : width >= 900 ? 4 : width >= 640 ? 3 : 2);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
    const iconSize = compact ? 17 : 13;
    const idleSize = compact ? 'w-9' : 'w-5';
    // Only padding/gap: the height comes from the shared line below.
    const activeSize = compact ? 'gap-1 px-2.5' : 'gap-1 px-1.5';
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
          compact ? 'h-9' : 'h-5',
          active ? cn(activeSize, 'bg-background text-fg shadow-sm') : idleSize,
        )}
      >
        {icon}
        {active && (
          <span
            className={cn('font-medium leading-none', compact ? 'text-caption' : 'text-[0.65rem]')}
          >
            {label}
          </span>
        )}
        {active && settings.sidebarShowUnreadCount && count > 0 && (
          <span
            className={cn(
              'leading-none tabular-nums text-fg/50',
              compact ? 'text-[0.7rem]' : 'text-[0.6rem]',
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
            : 'gap-0.5 rounded-full border border-border/70 bg-fill/50 p-0.5',
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
      {/* Header ------------------------------------------------------- */}
      <header
        className={cn(
          'flex h-[53px] w-full shrink-0 items-center gap-2 border-b border-border pt-2',
          mobileFullWidth ? 'px-2' : 'px-4',
        )}
      >


        {/* Filter groups: views (left) and smart lists (right). Each is one
            circular capsule; only the active item expands to show its name.
            The cluster scrolls rather than pushing the actions off a narrow
            column. DESIGN.md §7.5. */}
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {/* Feed / category name is the only title left: view and smart-list
              scopes state their own name inside the groups. */}
          {heading.icon || selection.scope === 'feed' || selection.scope === 'category' ? (
            <>
              {heading.icon ? (
                <FeedIcon
                  title={heading.title}
                  iconUrl={heading.icon}
                  size={20}
                  className="shrink-0"
                />
              ) : null}
              <h2 className="max-w-[8rem] min-w-0 shrink truncate text-lg font-bold leading-tight text-fg">
                {heading.title}
              </h2>
            </>
          ) : null}

          {/* Views */}
          <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-border/70 bg-fill/50 p-0.5">
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
                    'view-tab flex h-5 items-center justify-center rounded-full',
                    'transition-colors duration-150',
                    active
                      ? 'gap-1 bg-background px-1.5 text-fg shadow-sm'
                      : 'w-5 text-fg/50 hover:bg-item-hover hover:text-fg/85',
                  )}
                >
                  <span style={active ? { color: view.color } : undefined}>
                    <ViewGlyph viewKey={view.key} filled={active} />
                  </span>
                  {active && (
                    <span className="text-[0.65rem] font-medium leading-none">{view.label}</span>
                  )}
                  {active && settings.sidebarShowUnreadCount && count > 0 && (
                    <span className="text-[0.6rem] leading-none tabular-nums text-fg/50">
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

        <div className="flex shrink-0 items-center gap-0.5 text-fg/50">
          <IconButton
            title="刷新 (R)"
            disabled={refreshing}
            onClick={() => void refresh(selection.scope === 'feed' ? [selection.feedId] : undefined)}
          >
            {refreshing ? <Spinner size={14} /> : <RefreshCw size={15} />}
          </IconButton>
          <IconButton
            title={unreadOnly ? '显示全部 (U)' : '仅显示未读 (U)'}
            active={unreadOnly}
            onClick={() => setUnreadOnly(!unreadOnly)}
          >
            {unreadOnly ? <CircleDot size={15} /> : <Circle size={15} />}
          </IconButton>
          <IconButton
            title={settings.timelineSortAsc ? '按最新在前' : '按最早在前'}
            onClick={() => void updateSettings({ timelineSortAsc: !settings.timelineSortAsc })}
          >
            <ArrowDownUp size={15} />
          </IconButton>
          <IconButton title="全部标记为已读 (Shift+Ctrl+A)" onClick={handleMarkAll}>
            <CheckCircle2 size={15} />
          </IconButton>
        </div>
      </header>

      {/* Search ------------------------------------------------------- */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <Search size={14} className="shrink-0 text-fg/25" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索文章…"
          className="min-w-0 flex-1 bg-transparent text-headline text-fg placeholder:text-fg/25 focus:outline-none"
        />
        {search && (
          <button
            type="button"
            className="shrink-0 text-footnote text-fg/50 hover:text-fg"
            onClick={() => setSearch('')}
          >
            清除
          </button>
        )}
        {/* Layout switch: rows ⇄ waterfall (DESIGN.md §7.7). Sits here so the
            header keeps its filter capsules uncrowded. */}
        <IconButton
          title={masonry ? '列表模式' : '瀑布流模式'}
          active={masonry}
          onClick={() => void updateSettings({ entryLayout: masonry ? 'list' : 'masonry' })}
        >
          {masonry ? <LayoutList size={15} /> : <LayoutGrid size={15} />}
        </IconButton>
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
          'scrollbar-thin touch-pan-y relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2',
          // Phones stack two floating bars at the bottom (smart filters + feed
          // switcher), so the last cards need more clearance. The podcast dock
          // adds one more layer when an episode is loaded.
          isCompact
            ? playerActive
              ? 'pb-64'
              : 'pb-32'
            : playerActive
              ? 'pb-44'
              : 'pb-16',
        )}
      >
        {/* Pull-to-refresh indicator: revealed by dragging down at the top. */}
        <div
          className="pointer-events-none -mb-1 flex items-center justify-center overflow-hidden text-callout text-fg/50"
          style={{ height: Math.round(pull.pull), opacity: pull.pull > 4 || pull.refreshing ? 1 : 0 }}
        >
          {pull.refreshing ? (
            <>
              <Spinner size={12} className="mr-1.5" />
              正在刷新…
            </>
          ) : pull.pull >= pull.threshold ? (
            '松开刷新'
          ) : (
            '下拉刷新'
          )}
        </div>
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
          /* Waterfall built from real columns rather than CSS multi-column:
             a multi-column flow re-balances whenever anything is appended, so
             loading the next page moved every card already on screen. With one
             flex column per track, new entries can only grow a column downward
             and every existing card keeps its position (DESIGN.md §7.7). */
          entries.length > 0 && (
            <div data-wall="masonry" className="flex items-start gap-3">
              {Array.from({ length: columns }, (_, col) => (
                <div key={col} data-column={col} className="flex min-w-0 flex-1 flex-col gap-3">
                  {entries
                    .filter((_, index) => index % columns === col)
                    .map((entry) => (
                      <div
                        key={entry.id}
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
                    ))}
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="mx-auto w-full max-w-[900px]">
            {groupByDate(entries, settings.groupByDate).map((group) => (
              <div key={group.key}>
                {group.label && (
                  <div className="sticky top-0 z-[1] -mx-4 bg-background/95 px-4 py-1.5 text-footnote font-bold text-fg/50 backdrop-blur">
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
            <Spinner size={12} className="mr-2" />
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

      {/* Feed switcher: a floating bar at the bottom of the column. The panel
          with groups and feeds opens upward, over the list (DESIGN.md §7.6). */}
      {switcherOpen && (
        <div
          className="absolute inset-0 z-20"
          onClick={() => setSwitcherOpen(false)}
          aria-hidden="true"
        />
      )}
      {/* Phones: 首页/未读/星标/稍后读/今天 become the floating bottom bar, and
          the feed switcher sits above it (DESIGN.md §7.5). */}
      {isCompact && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto w-full max-w-md rounded-full border border-border bg-background/70 p-1 shadow-pop backdrop-blur-xl">
            {renderSmartGroup(true)}
          </div>
        </div>
      )}

      <div
        className={cn(
          'pointer-events-none absolute inset-x-2 z-30 flex flex-col gap-1.5',
          isCompact ? 'bottom-20' : 'bottom-2',
        )}
      >
        {switcherOpen && (
          <div className="pointer-events-auto flex max-h-[min(60vh,26rem)] flex-col overflow-hidden rounded-xl border border-border bg-background/75 shadow-modal backdrop-blur-xl">
            <FeedSwitcher onNavigate={() => setSwitcherOpen(false)} />
          </div>
        )}
        {/* The bar replaces what the sidebar used to hold: current context,
            search, settings and the feed switcher toggle (DESIGN.md §7.6). */}
        <div className="pointer-events-auto flex h-9 items-center rounded-full border border-border bg-background/70 pl-1 pr-1 shadow-pop backdrop-blur-xl">
          <button
            type="button"
            aria-expanded={switcherOpen}
            data-switcher="toggle"
            onClick={() => setSwitcherOpen((v) => !v)}
            className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-full px-2 text-left transition-colors hover:bg-item-hover"
          >
            {refreshing && progress ? (
              <>
                <Spinner size={13} className="shrink-0" />
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
                  <Folder size={15} className="shrink-0 text-fg/50" />
                ) : (
                  <Rss size={15} className="shrink-0 text-fg/50" />
                )}
                <span className="min-w-0 flex-1 truncate text-headline font-medium text-fg/85">
                  {switcherLabel}
                </span>
              </>
            )}
            {switcherOpen ? (
              <ChevronDown size={15} className="shrink-0 text-fg/50" />
            ) : (
              <ChevronUp size={15} className="shrink-0 text-fg/50" />
            )}
          </button>
          <IconButton title="发现" onClick={() => setDiscoverOpen(true)}>
            <Compass size={15} />
          </IconButton>
          <IconButton title="搜索 (Ctrl+K)" onClick={() => setPaletteOpen(true)}>
            <Search size={15} />
          </IconButton>
          <IconButton title="设置" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon size={15} />
          </IconButton>
        </div>
      </div>
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
