import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { groupFeeds, useApp } from '../store/app';
import { useUI } from '../store/ui';
import type { Feed } from '../lib/types';
import { cn } from '../lib/utils';
import { createCategory, feedMenuItems, openExternal } from '../lib/feedActions';
import { FeedIcon } from './primitives';

/* ------------------------------------------------------------------- rows */

interface FeedRowProps {
  feed: Feed;
  active: boolean;
  showCount: boolean;
  onSelect: (feed: Feed) => void;
  onContextMenu: (e: React.MouseEvent, feed: Feed) => void;
}

/** A single subscription row: 16px favicon, title, plain unread number. */
function FeedRow({ feed, active, showCount, onSelect, onContextMenu }: FeedRowProps) {
  return (
    <button
      type="button"
      data-active={active}
      onContextMenu={(e) => onContextMenu(e, feed)}
      onClick={() => onSelect(feed)}
      title={feed.error ? `${feed.title} — ${feed.error}` : feed.title}
      className={cn(
        'flex w-full items-center rounded-md py-1 pl-2.5 pr-2.5 text-left',
        'text-sm font-medium leading-loose transition-colors duration-150',
        'hover:bg-item-hover',
        active && 'bg-item-active',
      )}
    >
      <FeedIcon title={feed.title} iconUrl={feed.iconUrl} size={16} className="mr-2" />
      <span className="min-w-0 flex-1 truncate text-fg/85">{feed.title}</span>
      {feed.error && (
        <span className="ml-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" title={feed.error} />
      )}
      {showCount && feed.unread > 0 && (
        <span className="ml-2 shrink-0 text-[0.65rem] tabular-nums text-fg/25">
          {feed.unread > 99 ? '99+' : feed.unread}
        </span>
      )}
    </button>
  );
}

/* --------------------------------------------------------------- switcher */

interface FeedSwitcherProps {
  /** Called after a navigation, so the floating panel can close itself. */
  onNavigate?: () => void;
}

/**
 * The subscription list, rendered inside the floating panel at the bottom of the
 * list column (it used to live in the sidebar). Groups expand upward; each row
 * keeps the same context menu it had in the sidebar.
 */
export function FeedSwitcher({ onNavigate }: FeedSwitcherProps) {
  const {
    feeds,
    categories,
    settings,
    selection,
    selectFeed,
    selectCategory,
    reloadSubscriptions,
    refresh,
  } = useApp();
  const { openContextMenu, setAddFeedOpen, pushToast } = useUI();
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

  const groups = useMemo(() => groupFeeds(feeds, categories), [feeds, categories]);

  const goFeed = (id: number) => {
    void selectFeed(id);
    onNavigate?.();
  };
  const goCategory = (id: number) => {
    void selectCategory(id);
    onNavigate?.();
  };

  const feedMenu = (e: React.MouseEvent, feed: Feed) => {
    e.preventDefault();
    openContextMenu(
      e.clientX,
      e.clientY,
      feedMenuItems(feed, {
        reload: reloadSubscriptions,
        selectFeed,
        refresh: async (ids) => void refresh(ids),
        openContextMenu,
        pushToast,
        openExternal,
      }),
    );
  };

  const categoryMenu = (e: React.MouseEvent, id: number, name: string) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, [
      {
        label: '重命名分组…',
        onSelect: () => {
          void (async () => {
            const next = window.prompt('重命名分组', name);
            if (!next || next === name) return;
            const { renameCategory } = await import('../lib/api');
            await renameCategory(id, next);
            await reloadSubscriptions();
          })();
        },
      },
      {
        label: '删除分组',
        danger: true,
        onSelect: () => {
          void (async () => {
            if (!window.confirm(`删除分组「${name}」？其中的订阅源会移到未分组。`)) return;
            const { deleteCategory } = await import('../lib/api');
            await deleteCategory(id);
            await reloadSubscriptions();
          })();
        },
      },
    ]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {feeds.length === 0 && (
          <div className="px-2 py-6 text-center">
            <p className="text-headline text-fg/50">还没有订阅源</p>
            <button
              type="button"
              className="btn btn-accent mt-3"
              onClick={() => setAddFeedOpen(true)}
            >
              <Plus size={14} />
              添加订阅
            </button>
          </div>
        )}

        {groups.map(({ category, feeds: list }) => {
          const key = category?.id ?? -1;
          const isCollapsed = collapsed[key] ?? false;
          return (
            <section key={key} className="mb-1">
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [key]: !isCollapsed }))}
                onContextMenu={
                  category ? (e) => categoryMenu(e, category.id, category.name) : undefined
                }
                className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left hover:bg-item-hover"
              >
                {isCollapsed ? (
                  <ChevronRight size={13} className="shrink-0 text-fg/25" />
                ) : (
                  <ChevronDown size={13} className="shrink-0 text-fg/25" />
                )}
                <span className="min-w-0 flex-1 truncate text-callout font-medium text-fg/50">
                  {category?.name ?? '未分组'}
                </span>
                {category && category.unread > 0 && (
                  <span className="text-[0.65rem] tabular-nums text-fg/25">{category.unread}</span>
                )}
              </button>

              {!isCollapsed &&
                list.map((feed) => (
                  <FeedRow
                    key={feed.id}
                    feed={feed}
                    active={selection.scope === 'feed' && selection.feedId === feed.id}
                    showCount={settings.sidebarShowUnreadCount}
                    onSelect={(f) => goFeed(f.id)}
                    onContextMenu={feedMenu}
                  />
                ))}

              {!isCollapsed && category && (
                <button
                  type="button"
                  onClick={() => goCategory(category.id)}
                  className={cn(
                    'w-full rounded px-1.5 py-1 text-left text-footnote text-fg/25',
                    'hover:bg-item-hover hover:text-fg/50',
                    selection.scope === 'category' &&
                      selection.categoryId === category.id &&
                      'text-accent',
                  )}
                >
                  查看分组全部文章
                </button>
              )}
            </section>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t border-border px-2 py-1.5">
        <button
          type="button"
          className="btn shrink-0"
          onClick={() => setAddFeedOpen(true)}
        >
          <Plus size={13} />
          添加订阅
        </button>
        <button
          type="button"
          className="btn shrink-0"
          onClick={() => void createCategory(reloadSubscriptions)}
        >
          新建分组
        </button>
        <div className="flex-1" />
        <span className="text-footnote text-fg/25">{feeds.length} 个订阅源</span>
      </div>
    </div>
  );
}
