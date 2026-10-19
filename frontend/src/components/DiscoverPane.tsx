import { useCallback, useEffect, useState } from 'react';
import { Compass, Plus, RefreshCw, X } from 'lucide-react';
import * as api from '../lib/api';
import type { Entry, FeedSuggestion } from '../lib/types';
import { useApp } from '../store/app';
import { useUI } from '../store/ui';
import { cardRatio, cn, detailOriginOf, relativeTime } from '../lib/utils';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { CardImage, FeedIcon, IconButton, Spinner } from './primitives';

/**
 * Discover pane: what the reader may want to read next, and which feeds they
 * may want to follow.
 *
 * Both lists come from the Go service: articles are ranked by the terms the
 * reader starred and read, subscription cards come from a curated catalogue
 * ranked the same way. Following a card subscribes through the normal
 * AddFeedByUrl path, so nothing is special-cased.
 */
export function DiscoverPane({ mobileFullWidth = false }: { mobileFullWidth?: boolean }) {
  const { imageProxy, openEntry, reloadSubscriptions } = useApp();
  const { setDiscoverOpen, pushToast, setDetailOrigin } = useUI();

  const [articles, setArticles] = useState<Entry[]>([]);
  const [suggestions, setSuggestions] = useState<FeedSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<Record<string, 'busy' | 'done'>>({});

  const load = useCallback(async () => {
    setLoading(true);
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
  }, [pushToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const pull = usePullToRefresh(load);

  const follow = async (s: FeedSuggestion) => {
    if (state[s.url]) return;
    setState((m) => ({ ...m, [s.url]: 'busy' }));
    try {
      await api.addFeedByUrl(s.url, 0, 'articles');
      await reloadSubscriptions();
      setState((m) => ({ ...m, [s.url]: 'done' }));
      pushToast({ message: `已订阅 ${s.title}`, tone: 'success' });
    } catch (err) {
      setState((m) => {
        const next = { ...m };
        delete next[s.url];
        return next;
      });
      pushToast({ message: (err as Error).message, tone: 'error' });
    }
  };

  /** Open an article as the detail modal, growing out of the card that was
   *  clicked (DESIGN.md §7.11). */
  const openCard = (entry: Entry, el: HTMLElement) => {
    setDetailOrigin(detailOriginOf(el, entry.imageUrl, entry.url));
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
              {suggestions.map((s) => {
                const st = state[s.url];
                return (
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
                    <button
                      type="button"
                      disabled={st === 'busy' || st === 'done'}
                      onClick={() => void follow(s)}
                      className={cn(
                        'mt-2 inline-flex h-7 items-center justify-center gap-1 rounded-full px-3',
                        'text-callout font-medium transition-colors',
                        st === 'done'
                          ? 'bg-fill text-fg/50'
                          : 'bg-accent text-white hover:bg-accent/90',
                      )}
                    >
                      {st === 'busy' ? (
                        <Spinner size={12} />
                      ) : st === 'done' ? (
                        '已订阅'
                      ) : (
                        <>
                          <Plus size={13} />
                          订阅
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Articles ------------------------------------------------------ */}
        <h3 className="mb-2 text-footnote font-bold uppercase tracking-wide text-fg/25">
          为你推荐
        </h3>
        {loading && articles.length === 0 ? (
          <div className="columns-2 gap-3 min-[640px]:columns-3 min-[900px]:columns-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="mb-3 break-inside-avoid">
                <div className="skeleton h-40 rounded-lg" />
                <div className="skeleton mt-2 h-3 w-4/5 rounded" />
              </div>
            ))}
          </div>
        ) : articles.length === 0 ? (
          <p className="py-10 text-center text-callout text-fg/50">暂时没有可推荐的文章</p>
        ) : (
          <div className="columns-2 gap-3 [column-fill:balance] min-[640px]:columns-3 min-[900px]:columns-4">
            {articles.map((entry) => (
              <div key={entry.id} className="mb-3 break-inside-avoid">
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
