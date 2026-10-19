import { useEffect, useRef, useState } from 'react';
import { ChevronRight, MessageSquare, RefreshCw, X } from 'lucide-react';
import { useApp } from '../store/app';
import { useUI } from '../store/ui';
import { cn } from '../lib/utils';
import { handleContentLinkClick, proxyRemoteImages } from '../lib/remoteImages';
import { IconButton, Spinner } from './primitives';

/**
 * The comments column: DESIGN.md §4.
 *
 * It is a column of its own to the right of the reader (not a region docked
 * under the article), so the thread stays on screen while reading. On narrower
 * windows the same component renders as a sheet that slides over the reader;
 * the caller decides via `overlay`.
 */
export function CommentsPane({
  overlay = false,
  embedded = false,
}: {
  overlay?: boolean;
  embedded?: boolean;
}) {
  const {
    entry,
    settings,
    loadingComments,
    commentsError,
    loadComments,
    updateSettings,
    imageProxy,
  } = useApp();
  const { pushToast, setCommentsVisible } = useUI();

  // Shown inside the pane, so the reason a thread is missing is where the
  // thread should be rather than only in a toast.
  const [notice, setNotice] = useState<string | null>(null);
  const [width, setWidth] = useState(settings.commentPaneWidth || 380);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  /* Follow the stored width, e.g. when it changes while the pane is open. */
  useEffect(() => {
    setWidth(settings.commentPaneWidth || 380);
  }, [settings.commentPaneWidth]);

  /* A different article is a different thread. */
  useEffect(() => {
    setNotice(null);
  }, [entry?.id]);

  const refresh = async () => {
    setNotice(null);
    const result = await loadComments();
    if (result.ok) {
      setNotice(result.count ? null : (result.message ?? '暂无评论'));
    } else {
      setNotice(result.error ?? '获取评论失败，请稍后重试。');
      pushToast({ message: result.error ?? '获取评论失败', tone: 'error' });
    }
  };

  /** Drag the left edge to resize; the width persists on release. */
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { startX: e.clientX, startWidth: width };
    const onMove = (ev: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const next = d.startWidth - (ev.clientX - d.startX);
      setWidth(Math.min(Math.max(next, 320), Math.max(360, window.innerWidth - 720)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.removeProperty('cursor');
      drag.current = null;
      setWidth((w) => {
        void updateSettings({ commentPaneWidth: Math.round(w) });
        return w;
      });
    };
    document.body.style.setProperty('cursor', 'col-resize');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  if (!entry) {
    /* Keep the column's footprint while the article loads: unmounting here
       would make the reader widen and snap back on every article open. */
    return (
      <aside
        style={overlay || embedded ? undefined : { width }}
        className={cn(
          'flex min-h-0 flex-col bg-background',
          embedded
            ? 'min-h-0 flex-1'
            : overlay
              ? 'fixed inset-y-0 right-0 z-40 w-full border-l border-border shadow-modal sm:w-[min(92vw,400px)]'
              : 'relative z-10 shrink-0 border-l border-border',
        )}
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
          <h2 className="flex items-center gap-1.5 text-headline font-semibold text-fg">
            <MessageSquare size={15} className="shrink-0 text-fg/50" />
            评论
          </h2>
        </header>
        <div className="space-y-4 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <div className="skeleton h-3 w-16 rounded" />
              <div className="skeleton mt-2 h-3 w-full rounded" />
              <div className="skeleton mt-1.5 h-3 w-3/4 rounded" />
            </div>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <>
      {overlay && (
        <div
          className="fixed inset-0 z-30 bg-black/40 animate-fade-in"
          onClick={() => setCommentsVisible(false)}
          aria-hidden="true"
        />
      )}
      <aside
        style={overlay || embedded ? undefined : { width }}
        className={cn(
          'flex min-h-0 flex-col bg-background',
          embedded
            ? 'min-h-0 flex-1'
            : overlay
              ? 'fixed inset-y-0 right-0 z-40 w-full border-l border-border shadow-modal sm:w-[min(92vw,400px)]'
              : 'relative z-10 shrink-0 border-l border-border',
        )}
      >
        {/* Resize handle: a 1px rule that turns accent on hover. */}
        {!overlay && !embedded && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整评论栏宽度"
            onMouseDown={startResize}
            className="group absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize"
          >
            <span className="absolute inset-y-0 left-0 w-px bg-border transition-colors group-hover:bg-accent/70" />
          </div>
        )}

        {/* Header — DESIGN.md §4.3 */}
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
          <h2 className="flex min-w-0 items-center gap-1.5 text-headline font-semibold text-fg">
            <MessageSquare size={15} className="shrink-0 text-fg/50" />
            评论
            {entry.commentsCount > 0 && (
              <span className="rounded-full bg-fill px-1.5 py-0.5 text-footnote font-medium tabular-nums text-fg/50">
                {entry.commentsCount}
              </span>
            )}
          </h2>
          <div className="flex-1" />
          {entry.comments && (
            <IconButton
              title="刷新评论"
              disabled={loadingComments || !entry.url}
              onClick={() => void refresh()}
            >
              {loadingComments ? <Spinner size={14} /> : <RefreshCw size={15} />}
            </IconButton>
          )}
          {!embedded && (
            <IconButton title="收起评论区" onClick={() => setCommentsVisible(false)}>
              {overlay ? <X size={15} /> : <ChevronRight size={15} />}
            </IconButton>
          )}
        </header>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto px-4 py-3 [scrollbar-gutter:stable]">
          {loadingComments && !entry.comments && (
            <div className="flex items-center justify-center gap-2 py-6 text-callout text-fg/50">
              <Spinner size={13} />
              正在获取评论…
            </div>
          )}

          {entry.comments ? (
            <div
              className="article-content comments mx-auto w-full"
              style={{ fontSize: settings.contentFontSize - 1 }}
              onClick={handleContentLinkClick}
              dangerouslySetInnerHTML={{
                __html: proxyRemoteImages(entry.comments, imageProxy, entry.url),
              }}
            />
          ) : (
            !loadingComments && (
              /* Empty / failed state — DESIGN.md §3.5 */
              <div className="mx-auto flex w-full max-w-[46ch] flex-col items-center gap-2 px-2 py-8 text-center">
                <MessageSquare size={26} className="text-fg/25" />
                <p className="text-callout text-fg/50">{notice ?? commentsError ?? '暂无评论'}</p>
                <button
                  type="button"
                  className="btn btn-accent mt-1"
                  disabled={loadingComments || !entry.url}
                  onClick={() => void refresh()}
                >
                  <MessageSquare size={13} />
                  获取评论
                </button>
              </div>
            )
          )}
        </div>
      </aside>
    </>
  );
}
