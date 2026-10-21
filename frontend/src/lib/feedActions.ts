// Small feed-related actions used by the floating feed switcher.
//
// These used to live in Sidebar.tsx; they moved out when the group/feed list
// relocated to the floating switcher at the bottom of the list column.
import type { MenuItem } from '../store/ui';
import { VIEWS } from './types';

/** Opens a URL in the system browser through the Wails runtime. */
export function openExternal(url: string) {
  if (!url) return;
  void import('@wailsio/runtime')
    .then(({ Browser }) => Browser.OpenURL(url))
    .catch(() => {
      // Runtime unavailable (browser mock): fall back to a new tab.
      window.open(url, '_blank', 'noopener');
    });
}

/** Copies text and reports the outcome as a toast. */
export function copyText(
  text: string,
  pushToast: (t: { message: string; tone: 'success' | 'error' | 'info' }) => void,
) {
  navigator.clipboard
    ?.writeText(text)
    .then(() => pushToast({ message: '已复制到剪贴板', tone: 'success' }))
    .catch(() => pushToast({ message: '复制失败', tone: 'error' }));
}

/** Prompts for a name and creates a folder. */
export async function createCategory(reload: () => Promise<void>): Promise<void> {
  const name = window.prompt('新建分组名称', '');
  if (!name || !name.trim()) return;
  const { createCategory: create } = await import('../lib/api');
  await create(name.trim());
  await reload();
}

/** Context menu items for a feed row. Shared so both lists behave the same. */
export function feedMenuItems(feed: import('../lib/types').Feed, actions: {
  reload: () => Promise<void>;
  selectFeed: (id: number) => Promise<void>;
  refresh: (ids?: number[]) => Promise<void>;
  openContextMenu: (x: number, y: number, items: MenuItem[]) => void;
  pushToast: (t: { message: string; tone: 'success' | 'error' | 'info' }) => void;
  openExternal: (url: string) => void;
}): MenuItem[] {
  const { reload, selectFeed, refresh, pushToast } = actions;
  return [
    {
      label: '标记此订阅源为已读',
      onSelect: () => {
        void (async () => {
          const { markAllRead } = await import('../lib/api');
          await markAllRead({ scope: 'feed', feedId: feed.id }, true);
          await reload();
          await selectFeed(feed.id);
        })();
      },
    },
    {
      label: '重命名…',
      onSelect: () => {
        void (async () => {
          const next = window.prompt('重命名订阅源', feed.title);
          if (next === null || next.trim() === '' || next === feed.title) return;
          const { updateFeed } = await import('../lib/api');
          await updateFeed(feed.id, next.trim(), feed.categoryId, feed.view);
          await reload();
        })();
      },
    },
    { label: '刷新此订阅源', onSelect: () => void refresh([feed.id]) },
    // Classification: the backend guesses a tab when subscribing (address +
    // content); this is the manual override (DESIGN.md §7.5).
    ...VIEWS.map((view) => ({
      label: `归类到「${view.label}」`,
      checked: feed.view === view.key,
      separatorBefore: view.key === 'articles',
      onSelect: () => {
        void (async () => {
          const { setFeedView } = await import('../lib/api');
          await setFeedView(feed.id, view.key);
          await reload();
          actions.pushToast({ message: `已归类到「${view.label}」`, tone: 'success' });
        })();
      },
    })),
    {
      label: '在浏览器中打开网站',
      separatorBefore: true,
      onSelect: () => actions.openExternal(feed.siteUrl),
    },
    { label: '复制订阅源地址', onSelect: () => copyText(feed.url, pushToast) },
    {
      label: '移动到未分组',
      separatorBefore: true,
      disabled: feed.categoryId === 0,
      onSelect: () => {
        void (async () => {
          const { moveFeed } = await import('../lib/api');
          await moveFeed(feed.id, 0);
          await reload();
        })();
      },
    },
    { label: '新建分组…', onSelect: () => void createCategory(reload) },
    {
      label: '取消订阅',
      danger: true,
      separatorBefore: true,
      onSelect: () => {
        void (async () => {
          if (!window.confirm(`取消订阅「${feed.title}」？该订阅源的文章将被删除。`)) return;
          const { removeFeed } = await import('../lib/api');
          await removeFeed(feed.id);
          await reload();
          pushToast({ message: `已取消订阅 ${feed.title}`, tone: 'info' });
        })();
      },
    },
  ];
}
