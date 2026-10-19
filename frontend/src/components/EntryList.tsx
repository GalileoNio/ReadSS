import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
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
  RefreshCw,
  Rss,
  Search,
  Settings as SettingsIcon,
  Star,
} from 'lucide-react';
import { useApp } from '../store/app';
import { useUI } from '../store/ui';
import { useCountdownToast } from './overlays';
import { VIEWS, type Entry, type Scope } from '../lib/types';
import { cardRatio, cn, detailOriginOf, groupLabel, relativeTime } from '../lib/utils';
import {
  AnimatedArticlesIcon,
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
import { CardImage, FeedIcon, IconButton, RemoteImage, Spinner } from './primitives';

/** Inline glyphs for the five views, sized for the header capsule group. */
function ViewGlyph({ viewKey, size = 12 }: { viewKey: string; size?: number }) {
  switch (viewKey) {
    case 'all':
      return <AnimatedHomeIcon size={size} />;
    case 'articles':
      return <AnimatedArticlesIcon size={size} />;
    case 'social':
      return <AnimatedSocialIcon size={size} />;
    case 'pictures':
      return <AnimatedPicturesIcon size={size} />;
    case 'videos':
      return <AnimatedVideosIcon size={size} />;
    default:
      return <AnimatedHomeIcon size={size} />;
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

        {entry.imageUrl && (
          <RemoteImage
            src={entry.imageUrl}
            proxy={imageProxy}
            referer={entry.url}
            className="ml-2 h-20 w-20 shrink-0 rounded"
          />
        )}
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
            : view === 'articles'
              ? '文章'
              : view === 'social'
                ? '社交'
                : view === 'pictures'
                  ? '图片'
                  : '视频';
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
    openContextMenu(e.clientX, e.clientY, [
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
                    <ViewGlyph viewKey={view.key} />
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

          {/* Smart lists */}
          <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-border/70 bg-fill/50 p-0.5">
            {SMART_FILTERS.map(({ scope, label, Icon }) => {
              const active = selection.scope === scope;
              const count = counts[scope];
              return (
                <button
                  key={scope}
                  type="button"
                  title={active ? undefined : label}
                  aria-pressed={active}
                  data-active={active}
                  data-smart={scope}
                  onClick={() => void selectSmart(scope)}
                  className={cn(
                    'smart-row flex h-5 items-center justify-center rounded-full',
                    'transition-colors duration-150',
                    active
                      ? 'gap-1 bg-background px-1.5 text-fg shadow-sm'
                      : 'w-5 text-fg/50 hover:bg-item-hover hover:text-fg/85',
                  )}
                >
                  <Icon size={13} />
                  {active && (
                    <span className="text-[0.65rem] font-medium leading-none">{label}</span>
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
        className="scrollbar-thin touch-pan-y relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-16 pt-2"
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
          /* Waterfall: 2 columns on a phone, up to 5 on a wide page. Each card
             keeps its own height, so the columns interlock. Date group headers
             are omitted here because a sticky header cannot span a multi-column
             flow. */
          entries.length > 0 && (
            <div className="columns-2 gap-3 [column-fill:balance] min-[640px]:columns-3 min-[900px]:columns-4 min-[1200px]:columns-5">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className={cn(
                    'mb-3 break-inside-avoid',
                    // The card IS the article modal while it is open: keep the
                    // slot in the wall (no reflow) but leave it empty. It comes
                    // back once the modal has shrunk into it (DESIGN.md §7.11).
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
                      setDetailOrigin(detailOriginOf(el, e.imageUrl, e.url));
                      void openEntry(e.id);
                    }}
                    onContextMenu={entryMenu}
                  />
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
                      setDetailOrigin(detailOriginOf(el, e.imageUrl, e.url));
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
      <div className="pointer-events-none absolute inset-x-2 bottom-2 z-30 flex flex-col gap-1.5">
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
