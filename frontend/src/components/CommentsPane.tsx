import { useEffect, useState } from 'react';
import { MessageSquare, RefreshCw } from 'lucide-react';
import { useApp } from '../store/app';
import { useUI } from '../store/ui';
import { handleContentLinkClick, proxyRemoteImages } from '../lib/remoteImages';
import { IconButton, Spinner } from './primitives';

/** The comment thread inside the note rail: DESIGN.md §4. */
export function CommentsPane() {
  const { entry, settings, loadingComments, commentsError, loadComments, imageProxy } = useApp();
  const pushToast = useUI((s) => s.pushToast);

  // Shown where the thread should be, so a missing thread explains itself in place.
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    setNotice(null);
    setFailure(null);
  }, [entry?.id]);

  const refresh = async () => {
    setNotice(null);
    setFailure(null);
    const result = await loadComments();
    if (result.ok) {
      setNotice(result.count ? null : (result.message ?? '暂无评论'));
    } else {
      setFailure(result.error ?? '');
      pushToast({ message: '评论没有获取到', tone: 'error' });
    }
  };

  if (!entry) {
    return (
      <div className="space-y-4 px-6 py-4">
        <div className="skeleton h-3 w-24 rounded" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i}>
            <div className="skeleton h-3 w-16 rounded" />
            <div className="skeleton mt-2 h-3 w-full rounded" />
            <div className="skeleton mt-1.5 h-3 w-3/4 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const error = failure ?? commentsError;

  return (
    <section>
      <header className="flex items-center gap-2 px-6 pt-4">
        <h2 className="text-callout text-fg/50">
          {entry.commentsCount > 0 ? (
            <>
              共 <span className="tabular-nums">{entry.commentsCount}</span> 条评论
            </>
          ) : (
            '评论'
          )}
        </h2>
        <div className="flex-1" />
        {entry.comments && (
          <IconButton title="刷新评论" disabled={loadingComments || !entry.url} onClick={() => void refresh()}>
            {loadingComments ? <Spinner size={14} /> : <RefreshCw size={14} />}
          </IconButton>
        )}
      </header>

      <div className="px-6 pb-6 pt-2">
        {loadingComments && !entry.comments && (
          <div className="flex items-center justify-center gap-2 py-6 text-callout text-fg/50">
            <Spinner size={14} />
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
            <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
              <MessageSquare size={20} className="text-fg/25" />
              <p className="text-callout text-fg/50" title={error || undefined}>
                {error != null ? '评论没有获取到' : (notice ?? '暂无评论')}
              </p>
              <button
                type="button"
                className="btn btn-accent mt-1"
                disabled={loadingComments || !entry.url}
                onClick={() => void refresh()}
              >
                <MessageSquare size={14} />
                {error != null ? '重试' : '获取评论'}
              </button>
            </div>
          )
        )}
      </div>
    </section>
  );
}
