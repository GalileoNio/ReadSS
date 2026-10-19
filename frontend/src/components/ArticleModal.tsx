import { useEffect, useRef, useState } from 'react';
import {
  Calendar,
  ChevronRight,
  Clock,
  MessageSquare,
  Rss,
  X,
} from 'lucide-react';
import { useApp } from '../store/app';
import { useViewport } from '../hooks/useViewport';
import { VIEWS } from '../lib/types';
import { cn, formatDate, hostOf } from '../lib/utils';
import { CommentsPane } from './CommentsPane';
import { Reader } from './Reader';
import { FeedIcon } from './primitives';

/**
 * Article detail dialog, following Xiaohongshu's note modal: the article is the
 * large left pane and a narrow right rail holds the author and the comment
 * thread. On narrow windows the rail becomes a second tab instead of being
 * squeezed beside the article.
 */
export function ArticleModal() {
  const selectedEntryId = useApp((s) => s.selectedEntryId);
  const openEntry = useApp((s) => s.openEntry);
  const { isCompact } = useViewport();
  const [tab, setTab] = useState<'article' | 'comments'>('article');
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTab('article');
  }, [selectedEntryId]);

  useEffect(() => {
    if (!selectedEntryId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        void openEntry(null);
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

  if (!selectedEntryId) return null;

  const close = () => void openEntry(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-0 lg:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="文章详情"
    >
      <div
        className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm"
        onClick={close}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        className={cn(
          'relative z-10 flex h-[min(92vh,920px)] w-[min(1200px,94vw)] flex-col overflow-hidden',
          'rounded-xl border border-border bg-background shadow-modal animate-scale-in',
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
