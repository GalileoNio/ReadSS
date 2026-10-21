import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Compass, Plus, RefreshCw, X } from 'lucide-react';
import * as api from '../lib/api';
import { findFeedByUrl, followFeed, unfollowFeed } from '../lib/follow';
import type { Entry, Feed, FeedSuggestion, PodcastSuggestion, ViewKey } from '../lib/types';
import { useApp } from '../store/app';
import { useUI } from '../store/ui';
import { cardRatio, cn, detailOriginOf, relativeTime } from '../lib/utils';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { CardImage, FeedIcon, IconButton, proxiedImageURL, Spinner } from './primitives';

/**
 * Discover pane: what the reader may want to read next, and which feeds and
 * podcasts they may want to follow.
 *
 * All lists come from the Go service: articles are ranked by the terms the
 * reader starred and read, subscription cards come from a curated catalogue
 * ranked the same way, and podcasts come from the live Apple Podcasts charts
 * and search, matched against the same interests. Following subscribes and
 * unfollowing unsubscribes for real, so the card state is read from `feeds`.
 */
export function DiscoverPane({ mobileFullWidth = false }: { mobileFullWidth?: boolean }) {
  const { feeds, imageProxy, openEntry } = useApp();

  const { setDiscoverOpen, pushToast, setDetailOrigin } = useUI();

  const [articles, setArticles] = useState<Entry[]>([]);
  const [suggestions, setSuggestions] = useState<FeedSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  // Follow requests in flight, by suggested URL.
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // Suggested URL -> the feed it became. The backend may store a different URL
  // than the suggested one (redirects, discovery), so URL matching alone could
  // lose track of a feed followed from here.
  const [followedIds, setFollowedIds] = useState<Record<string, number>>({});
  // The card currently open as the article modal, if any.
  const openedId = useApp((s) => s.selectedEntryId);

  const [podcasts, setPodcasts] = useState<PodcastSuggestion[]>([]);
  const [podcastLoading, setPodcastLoading] = useState(true);
  const [podcastError, setPodcastError] = useState('');
  // Each refresh asks for the next round, which rotates the charts and search
  // keywords, and excludes what was already shown so a refresh brings new shows.
  const podcastRound = useRef(-1);
  const podcastShown = useRef<string[]>([]);
  const podcastSeq = useRef(0);

  const loadPodcasts = useCallback(async () => {
    const seq = ++podcastSeq.current;
    const round = ++podcastRound.current;
    setPodcastLoading(true);
    setPodcastError('');
    try {
      const next = (await api.recommendPodcasts(8, round, podcastShown.current.slice(-120))) ?? [];
      if (seq !== podcastSeq.current) return;
      setPodcasts(next);
      podcastShown.current.push(...next.map((p) => p.url));
    } catch (err) {
      if (seq !== podcastSeq.current) return;
      setPodcastError((err as Error).message);
    } finally {
      if (seq === podcastSeq.current) setPodcastLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    // The podcast directory is a remote service; it must not hold up the
    // articles or the pull-to-refresh indicator.
    void loadPodcasts();
    try {
      const [nextArticles, nextFeeds] = await Promise.all([
        api.recommendEntries(24),
        api.recommendFeeds(12),
      ]);
      setArticles(nextArticles ?? []);
      setSuggestions(nextFeeds ?? []);
    } catch (err) {
      pushToast({ message: `推荐加载失败：${(err as Error).message}`, tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [pushToast, loadPodcasts]);

  useEffect(() => {
    void load();
  }, [load]);

  const pull = usePullToRefresh(load);

  const followedFeed = (url: string): Feed | undefined =>
    findFeedByUrl(feeds, url) ?? feeds.find((f) => f.id === followedIds[url]);

  // Unfollowing deletes a feed's entries; drop their cards instead of leaving
  // dead ones behind. The open card keeps its slot for the modal to close into.
  const visibleArticles = articles.filter(
    (a) => a.id === openedId || feeds.some((f) => f.id === a.feedId),
  );

  /** Follows or unfollows a suggestion. `view` '' lets the backend classify
   *  the feed (audio/video/social/…). */
  const toggleFollow = async (url: string, title: string, view: ViewKey | '') => {
    if (busy[url]) return;
    setBusy((m) => ({ ...m, [url]: true }));
    try {
      const current = followedFeed(url);
      if (current) {
        await unfollowFeed(current, (next) => setFollowedIds((m) => ({ ...m, [url]: next.id })));
      } else {
        const next = await followFeed({ url, title, view });
        if (next) setFollowedIds((m) => ({ ...m, [url]: next.id }));
      }
    } finally {
      setBusy((m) => {
        const next = { ...m };
        delete next[url];
        return next;
      });
    }
  };

  /** Open an article as the detail modal, growing out of the card that was
   *  clicked (DESIGN.md §7.11). */
  const openCard = (entry: Entry, el: HTMLElement) => {
    setDetailOrigin(detailOriginOf(el, entry, feeds.find((f) => f.id === entry.feedId)?.color));
    void openEntry(entry.id);
    // The pane stays behind the modal: the article shrinks back into the card
    // it came from when it closes.
  };

  return (
    <section
      className={cn(
        'relative flex min-w-0 flex-1 flex-col bg-background',
        mobileFullWidth && 'w-full',
      )}
    >
      <header className="flex h-[53px] shrink-0 items-center gap-2 border-b border-border px-4 pt-2">
        <h2 className="flex min-w-0 flex-1 items-center gap-1.5 text-lg font-bold leading-tight text-fg">
          <Compass size={18} className="shrink-0 text-accent" />
          发现
        </h2>
        <IconButton title="刷新推荐" disabled={loading} onClick={() => void load()}>
          {loading ? <Spinner size={14} /> : <RefreshCw size={15} />}
        </IconButton>
        <IconButton title="返回文章列表" onClick={() => setDiscoverOpen(false)}>
          <X size={15} />
        </IconButton>
      </header>

      <div
        ref={pull.ref}
        onClickCapture={pull.guardClick}
        className="scrollbar-thin touch-pan-y min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-16 pt-2"
      >
        {/* Pull indicator ------------------------------------------------- */}
        <div
          className="pointer-events-none -mb-2 flex items-center justify-center overflow-hidden text-callout text-fg/50"
          style={{ height: Math.round(pull.pull), opacity: pull.pull > 4 || pull.refreshing ? 1 : 0 }}
        >
          {pull.refreshing ? (
            <>
              <Spinner size={13} className="mr-2" />
              正在刷新推荐…
            </>
          ) : pull.pull >= pull.threshold ? (
            '松开刷新'
          ) : (
            '下拉刷新'
          )}
        </div>

        {/* Feeds to follow ------------------------------------------------ */}
        {suggestions.length > 0 && (
          <>
            <h3 className="mt-1 mb-2 text-footnote font-bold uppercase tracking-wide text-fg/25">
              值得订阅
            </h3>
            <div className="mb-4 grid grid-cols-2 gap-2 min-[900px]:grid-cols-3 min-[1200px]:grid-cols-4">
              {suggestions.map((s) => (
                <div
                  key={s.url}
                  className="flex min-w-0 flex-col rounded-lg border border-border bg-fill/20 p-2.5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FeedIcon title={s.title} iconUrl="" size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-headline font-semibold text-fg">{s.title}</p>
                      <p className="truncate text-footnote text-fg/50">
                        {s.tags.slice(0, 2).join(' · ')}
                      </p>
                    </div>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-callout text-fg/50">{s.description}</p>
                  <FollowButton
                    className="mt-2"
                    busy={!!busy[s.url]}
                    following={!!followedFeed(s.url)}
                    onClick={() => void toggleFollow(s.url, s.title, '')}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {/* Podcasts ------------------------------------------------------ */}
        <div className="mb-2 flex items-center gap-2">
          <h3 className="flex-1 text-footnote font-bold uppercase tracking-wide text-fg/25">
            播客推荐
          </h3>
          <button
            type="button"
            disabled={podcastLoading}
            onClick={() => void loadPodcasts()}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-footnote text-fg/50 transition-colors hover:bg-fill hover:text-fg disabled:opacity-50"
          >
            {podcastLoading ? <Spinner size={11} /> : <RefreshCw size={11} />}
            换一批
          </button>
        </div>
        {podcastLoading && podcasts.length === 0 ? (
          <div className="mb-4 grid grid-cols-1 gap-2 min-[640px]:grid-cols-2 min-[1200px]:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-2.5 rounded-lg border border-border p-2.5">
                <div className="skeleton h-16 w-16 shrink-0 rounded-md" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="skeleton h-3 w-3/4 rounded" />
                  <div className="skeleton h-2.5 w-1/2 rounded" />
                  <div className="skeleton h-2.5 w-2/3 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : podcastError && podcasts.length === 0 ? (
          <p className="mb-4 py-4 text-center text-callout text-fg/50">{podcastError}</p>
        ) : podcasts.length === 0 ? (
          <p className="mb-4 py-4 text-center text-callout text-fg/50">暂时没有新的播客可推荐</p>
        ) : (
          <div
            className={cn(
              'mb-4 grid grid-cols-1 gap-2 transition-opacity min-[640px]:grid-cols-2 min-[1200px]:grid-cols-3',
              podcastLoading && 'opacity-60',
            )}
          >
            {podcasts.map((p) => (
              <div
                key={p.url}
                className="flex min-w-0 gap-2.5 rounded-lg border border-border bg-fill/20 p-2.5"
              >
                {p.artworkUrl ? (
                  <img
                    src={proxiedImageURL(p.artworkUrl, imageProxy)}
                    alt=""
                    loading="lazy"
                    className="h-16 w-16 shrink-0 rounded-md bg-fill object-cover"
                  />
                ) : (
                  <FeedIcon title={p.title} iconUrl="" size={64} className="shrink-0" />
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-headline font-semibold text-fg" title={p.title}>
                    {p.title}
                  </p>
                  <p className="truncate text-footnote text-fg/50">
                    {[
                      p.author,
                      p.genre,
                      p.episodeCount > 0 && `${p.episodeCount} 集`,
                      p.lastEpisodeAt > 0 && `${relativeTime(p.lastEpisodeAt)}更新`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {p.reason && (
                    <p className="mt-0.5 truncate text-footnote text-accent">{p.reason}</p>
                  )}
                  {p.description && (
                    <p className="mt-1 line-clamp-2 text-callout text-fg/50">{p.description}</p>
                  )}
                  <FollowButton
                    className="mt-2 self-start"
                    busy={!!busy[p.url]}
                    following={!!followedFeed(p.url)}
                    onClick={() => void toggleFollow(p.url, p.title, 'audio')}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Articles ------------------------------------------------------ */}
        <h3 className="mb-2 text-footnote font-bold uppercase tracking-wide text-fg/25">
          为你推荐
        </h3>
        {loading && visibleArticles.length === 0 ? (
          <div className="columns-2 gap-3 min-[640px]:columns-3 min-[900px]:columns-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="mb-3 break-inside-avoid">
                <div className="skeleton h-40 rounded-lg" />
                <div className="skeleton mt-2 h-3 w-4/5 rounded" />
              </div>
            ))}
          </div>
        ) : visibleArticles.length === 0 ? (
          <p className="py-10 text-center text-callout text-fg/50">暂时没有可推荐的文章</p>
        ) : (
          <div className="columns-2 gap-3 [column-fill:balance] min-[640px]:columns-3 min-[900px]:columns-4">
            {visibleArticles.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  'mb-3 break-inside-avoid',
                  // The card becomes the modal while it is open: blank slot,
                  // no reflow (DESIGN.md §7.11).
                  entry.id === openedId && 'invisible',
                )}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => openCard(entry, e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') openCard(entry, e.currentTarget);
                  }}
                  className={cn(
                    'group block w-full cursor-default overflow-hidden rounded-lg border border-border',
                    'bg-fill/20 text-left transition-colors hover:bg-item-hover',
                  )}
                >
                  <CardImage
                    src={entry.imageUrl}
                    proxy={imageProxy}
                    referer={entry.url}
                    seed={entry.feedTitle || entry.title}
                    ratio={cardRatio(entry.id)}
                    color={feeds.find((f) => f.id === entry.feedId)?.color}
                    title={entry.title}
                    fallback={
                      <FeedIcon title={entry.feedTitle} iconUrl={entry.feedIcon} size={22} />
                    }
                  />
                  <div className="p-2">
                    {entry.imageUrl && (
                      <h4 className="line-clamp-3 break-words text-headline font-medium leading-snug text-fg">
                        {entry.title}
                      </h4>
                    )}
                    <div
                      className={cn(
                        'flex min-w-0 items-center gap-1 text-[10px] font-bold text-fg/50',
                        entry.imageUrl ? 'mt-1.5' : 'mt-0.5',
                      )}
                    >
                      <FeedIcon title={entry.feedTitle} iconUrl={entry.feedIcon} size={12} />
                      <span className="truncate">{entry.feedTitle}</span>
                      <span aria-hidden>·</span>
                      <span className="shrink-0 tabular-nums">
                        {relativeTime(entry.publishedAt)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** 订阅 / 已订阅 toggle; a followed card offers 取消订阅 on hover. */
function FollowButton({
  busy,
  following,
  onClick,
  className,
}: {
  busy: boolean;
  following: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={following}
      title={following ? '取消订阅' : undefined}
      onClick={onClick}
      className={cn(
        'group/follow inline-flex h-7 min-w-[72px] items-center justify-center gap-1 rounded-full px-3',
        'text-callout font-medium transition-colors disabled:opacity-60',
        following
          ? 'bg-fill text-fg/50 hover:bg-item-hover hover:text-fg/70'
          : 'bg-accent text-white hover:bg-accent/90',
        className,
      )}
    >
      {busy ? (
        <Spinner size={12} />
      ) : following ? (
        <>
          <span className="inline-flex items-center gap-1 group-hover/follow:hidden">
            <Check size={13} />
            已订阅
          </span>
          <span className="hidden group-hover/follow:inline">取消订阅</span>
        </>
      ) : (
        <>
          <Plus size={13} />
          订阅
        </>
      )}
    </button>
  );
}
