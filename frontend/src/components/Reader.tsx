import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  BookmarkPlus,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  MessageSquare,
  RefreshCw,
  Star,
  UserRound,
} from 'lucide-react';
import { useApp } from '../store/app';
import { useUI } from '../store/ui';
import { cn, formatDate, hostOf } from '../lib/utils';
import { CardImage, FeedIcon, IconButton, Spinner } from './primitives';
import { openExternal } from '../lib/feedActions';
import { handleContentLinkClick, proxyRemoteImages } from '../lib/remoteImages';
import { useViewport } from '../hooks/useViewport';

/** Reader pane: Folo's article column. `modal` drops the column chrome when the
 * article is shown inside the detail dialog. */
export function Reader({ modal = false }: { modal?: boolean }) {
  const {
    entry,
    feeds,
    loadingEntry,
    settings,
    selectedEntryId,
    entries,
    markRead,
    toggleStar,
    toggleReadLater,
    step,
    contentMode,
    setContentMode,
    fetchingFullText,
    fetchFullText,
    revertFullText,
    openEntry,
    imageProxy,
  } = useApp();
  const { pushToast, commentsVisible, setCommentsVisible } = useUI();
  const { isMobile, isWide } = useViewport();
  const [hoverEdge, setHoverEdge] = useState<'left' | 'right' | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);

  /* Reset the reading position when a different article opens. Below the
     three-column breakpoint the comments column would cover the article, so it
     starts closed there. */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    if (!modal && !isWide) setCommentsVisible(false);
  }, [selectedEntryId, isWide, modal, setCommentsVisible]);

  const index = entries.findIndex((e) => e.id === selectedEntryId);
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < entries.length - 1;
  /** The modal has room for a wider measure than the old docked column. */
  const measure = modal ? 'max-w-[720px]' : 'max-w-[65ch]';

  /** The body to show, honouring the feed/full-text toggle. */
  const body =
    entry == null
      ? ''
      : contentMode === 'full' && entry.hasFullContent
        ? entry.fullContent
        : entry.feedContent || entry.content;

  const reExtract = async () => {
    const result = await fetchFullText();
    if (result.ok) {
      pushToast({ message: '已抓取全文', tone: 'success' });
    } else {
      pushToast({ message: `全文抓取失败：${result.error ?? '未知错误'}`, tone: 'error' });
    }
  };

  if (!entry && !loadingEntry) {
    return (
      <div
        className={cn(
          'flex flex-1 flex-col items-center justify-center gap-3 bg-background px-6 text-center',
          modal ? 'h-full w-full' : 'min-w-[320px]',
        )}
      >
        <BookOpen size={30} className="text-fg/25" />
        <p className="text-headline text-fg/50">选择文章开始阅读</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative flex flex-1 flex-col overflow-hidden bg-background',
        // The desktop minimum keeps the column readable; inside the modal the
        // left pane takes the width the dialog gives it.
        modal ? 'h-full w-full min-w-0' : 'min-w-[320px]',
      )}
    >
      {/*
        Article region (upper). The prev/next rails live inside it so they stay
        centred on the article rather than on the pane, which the docked comment
        region would otherwise drag downwards on narrow screens.
      */}
      <div
        ref={articleRef}
        className="relative flex min-h-0 min-w-0 flex-col"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          setHoverEdge(x < 56 ? 'left' : x > rect.width - 56 ? 'right' : null);
        }}
        onMouseLeave={() => setHoverEdge(null)}
      >
        <div
          ref={scrollRef}
          className="scrollbar-thin h-full min-h-0 min-w-0 overflow-auto"
        >
        {/* Floating action bar ---------------------------------------- */}
        {entry && (
          <div
            className={cn(
              'pointer-events-none sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-2',
              // In the modal the bar floats over the full-bleed hero instead of
              // pushing it down: cancel its own layout height.
              modal && '-mb-[54px]',
            )}
          >
            {isMobile && !modal ? (
              <button
                type="button"
                className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-background/85 px-2 py-1 text-headline text-fg/85 shadow-pop backdrop-blur-md"
                onClick={() => void openEntry(null)}
              >
                <ArrowLeft size={15} />
                返回
              </button>
            ) : (
              <span />
            )}
            <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-border bg-background/85 p-1 shadow-pop backdrop-blur-md">
              {!modal && (
                <IconButton
                  title={commentsVisible ? '收起评论区' : '展开评论区'}
                  active={commentsVisible}
                  onClick={() => setCommentsVisible(!commentsVisible)}
                >
                  <MessageSquare size={15} />
                </IconButton>
              )}
              {!entry.hasFullContent && (
                <IconButton
                  title={fetchingFullText ? '正在获取全文' : '获取全文'}
                  disabled={fetchingFullText || !entry.url}
                  onClick={() => void reExtract()}
                >
                  {fetchingFullText ? <Spinner size={14} /> : <FileText size={15} />}
                </IconButton>
              )}
              <IconButton
                title={entry.read ? '标记为未读 (M)' : '标记为已读 (M)'}
                onClick={() => void markRead([entry.id], !entry.read)}
              >
                {entry.read ? (
                  <CheckCircle2 size={15} />
                ) : (
                  <Circle size={15} className="fill-accent/20 text-accent" />
                )}
              </IconButton>
              <IconButton
                title={entry.starred ? '取消星标 (S)' : '加星标 (S)'}
                active={entry.starred}
                onClick={() => void toggleStar(entry.id)}
              >
                <Star
                  size={15}
                  className={entry.starred ? 'fill-amber-400 text-amber-400' : undefined}
                />
              </IconButton>
              <IconButton
                title="加入稍后读"
                active={entry.readLater}
                onClick={() => void toggleReadLater(entry.id)}
              >
                <BookmarkPlus size={15} />
              </IconButton>
              <IconButton
                title="复制链接"
                onClick={() => {
                  void navigator.clipboard?.writeText(entry.url);
                  pushToast({ message: '已复制链接', tone: 'success' });
                }}
              >
                <Copy size={15} />
              </IconButton>
              <IconButton
                title="在浏览器中打开 (B)"
                disabled={!entry.url}
                onClick={() => openExternal(entry.url)}
              >
                <ExternalLink size={15} />
              </IconButton>
              </div>
            </div>
        )}

        {loadingEntry && !entry ? (
          <ReaderSkeleton wide={modal} />
        ) : entry ? (
          <article className="relative w-full min-w-0 overflow-hidden pb-10">
            {/* In the modal the hero is full-bleed: no top, left or right margin
                and no rounded corners, so it reads as the note's cover rather
                than an inline picture. The floating toolbar sits over it. */}
            {modal && entry.imageUrl && (
              <CardImage
                src={entry.imageUrl}
                proxy={imageProxy}
                referer={entry.url}
                seed={entry.feedTitle || entry.title}
                ratio="16 / 9"
                color={feeds.find((f) => f.id === entry.feedId)?.color}
                hero
                instant
                className="w-full"
              />
            )}
            {/* Width is relative to the pane, not the viewport: `w-full` caps
                the column and `max-w` only takes effect on a wide window. */}
            <div className={cn('mx-auto w-full min-w-0 px-4', measure)}>
              {/* Mode switch: feed body vs extracted full text. It lives inside
                  the article so the modal's hero can stay flush with the top. */}
              {entry.hasFullContent && (
                <div
                  className={cn(
                    'flex min-w-0 items-center gap-2',
                    modal && entry.imageUrl ? 'mt-4' : 'mt-6',
                  )}
                >
                  <div className="flex shrink-0 gap-0.5 rounded-md bg-fill p-0.5">
                    {(
                      [
                        ['full', '全文'],
                        ['feed', '原文'],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setContentMode(mode)}
                        className={cn(
                          'rounded px-2 py-0.5 text-footnote font-medium transition-colors',
                          contentMode === mode
                            ? 'bg-background text-fg shadow-sm'
                            : 'text-fg/50 hover:text-fg/85',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="min-w-0 flex-1 truncate" />
                  <button
                    type="button"
                    className="btn shrink-0"
                    disabled={fetchingFullText}
                    onClick={() => void reExtract()}
                  >
                    {fetchingFullText ? <Spinner size={13} /> : <RefreshCw size={13} />}
                    重新获取
                  </button>
                  <button
                    type="button"
                    className="btn shrink-0"
                    onClick={() => void revertFullText()}
                  >
                    清除
                  </button>
                </div>
              )}
              {/* Title block, in Xiaohongshu's note-detail order: title, author
                  card, then meta chips (the modal's hero is above). */}
              <div
                className={cn(
                  'flex flex-col gap-3',
                  modal ? (entry.imageUrl || entry.hasFullContent ? 'mt-4' : 'mt-14') : 'mt-5',
                )}
              >
                {entry.imageUrl && !modal && (
                  <CardImage
                    src={entry.imageUrl}
                    proxy={imageProxy}
                    referer={entry.url}
                    seed={entry.feedTitle || entry.title}
                    ratio="16 / 9"
                    color={feeds.find((f) => f.id === entry.feedId)?.color}
                    hero
                    instant
                    className="rounded-xl"
                  />
                )}

                <h1 className="inline-block break-words text-[1.85rem] font-bold leading-normal text-fg">
                  {entry.url ? (
                    <a
                      href={entry.url}
                      onClick={(e) => {
                        e.preventDefault();
                        openExternal(entry.url);
                      }}
                      className="transition-opacity hover:opacity-95"
                    >
                      {entry.title}
                    </a>
                  ) : (
                    entry.title
                  )}
                </h1>

                {/* In the modal the author card and meta live in the right
                    sidebar, so the article pane keeps only the image and title. */}
                {!modal && (
                  <>
                    {/* Author card. The feed is the author here and it is already
                        followed, so the pill shows that state instead of a follow
                        button; tapping the card opens the feed's timeline. */}
                    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-fill/20 p-2.5">
                      <FeedIcon title={entry.feedTitle} iconUrl={entry.feedIcon} size={36} />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => void useApp.getState().selectFeed(entry.feedId)}
                      >
                        <p className="truncate text-headline font-semibold text-fg">{entry.feedTitle}</p>
                        <p className="mt-0.5 truncate text-footnote text-fg/50">
                          {entry.author ? `${entry.author} · ` : ''}
                          {formatDate(entry.publishedAt)} · 约 {entry.readingMinutes} 分钟
                        </p>
                      </button>
                      <span className="shrink-0 rounded-full bg-fill px-2.5 py-1 text-footnote font-medium text-fg/60">
                        已订阅
                      </span>
                    </div>

                    {/* Meta chips */}
                    <div className="flex flex-wrap items-center gap-2">
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
                      {entry.author && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-fill/60 px-2 py-1 text-footnote text-fg/50">
                          <UserRound size={12} />
                          {entry.author}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Article body */}
              <div
                className="article-content selectable mt-6"
                style={{ fontSize: settings.contentFontSize }}
                onClick={handleContentLinkClick}
                dangerouslySetInnerHTML={{ __html: proxyRemoteImages(body || `<p>${entry.summary}</p>`, imageProxy, entry.url) }}
              />

              {/* Footer navigation */}
              <div className="mt-12 flex items-center justify-between border-t border-border pt-4">
                <button
                  type="button"
                  disabled={!hasPrev}
                  onClick={() => void step(-1)}
                  className="btn disabled:opacity-30"
                >
                  <ArrowLeft size={14} />
                  上一篇
                </button>
                <span className="text-footnote tabular-nums text-fg/25">
                  {index >= 0 ? `${index + 1} / ${entries.length}` : ''}
                </span>
                <button
                  type="button"
                  disabled={!hasNext}
                  onClick={() => void step(1)}
                  className="btn disabled:opacity-30"
                >
                  下一篇
                  <ArrowRight size={14} />
                </button>
              </div>

              <p className="mt-4 text-center text-footnote text-fg/25">
                {hostOf(entry.url)}
              </p>
            </div>
          </article>
        ) : null}
        </div>

        {/* Prev / next rails, centred on the article region ------------- */}
        {hasPrev && (
          <button
            type="button"
            aria-label="上一篇"
            onClick={() => void step(-1)}
            className={cn(
              'absolute left-2 top-1/2 z-10 -translate-y-12 rounded-full border border-border',
              'bg-background/90 p-2 shadow-pop backdrop-blur transition-opacity duration-200',
              hoverEdge === 'left' ? 'opacity-100' : 'opacity-0',
            )}
          >
            <ChevronLeft size={18} />
          </button>
        )}
        {hasNext && (
          <button
            type="button"
            aria-label="下一篇"
            onClick={() => void step(1)}
            className={cn(
              'absolute right-2 top-1/2 z-10 -translate-y-12 rounded-full border border-border',
              'bg-background/90 p-2 shadow-pop backdrop-blur transition-opacity duration-200',
              hoverEdge === 'right' ? 'opacity-100' : 'opacity-0',
            )}
          >
            <ChevronRight size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

function ReaderSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div
      className={cn(
        'mx-auto w-full min-w-0 px-4 pt-12',
        wide ? 'max-w-[720px]' : 'max-w-[65ch]',
      )}
    >
      <div className="skeleton h-7 w-4/5 rounded" />
      <div className="skeleton mt-3 h-7 w-3/5 rounded" />
      <div className="mt-5 flex gap-4">
        <div className="skeleton h-4 w-28 rounded" />
        <div className="skeleton h-4 w-20 rounded" />
        <div className="skeleton h-4 w-24 rounded" />
      </div>
      <div className="mt-8 space-y-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className={cn('skeleton h-4 rounded', i % 4 === 3 ? 'w-3/5' : 'w-full')} />
        ))}
      </div>
    </div>
  );
}
