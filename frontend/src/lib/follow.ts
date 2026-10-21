// Follow / unfollow ("关注" / "取消关注") shared by the article modal's author
// bar and the discover pane. Following is subscribing; unfollowing removes the
// subscription for real, so the follow state is always read from `feeds`.
import * as api from './api';
import type { Feed, ViewKey } from './types';
import { useApp } from '../store/app';
import { useUI } from '../store/ui';

/** What it takes to follow a feed again after it was removed. */
export interface FollowTarget {
  url: string;
  title: string;
  categoryId?: number;
  /** '' lets the backend classify the feed. */
  view?: ViewKey | '';
}

/** Feed URLs compared the way the backend deduplicates subscriptions: scheme,
 *  `www.`, host case and a trailing slash do not matter. */
export function feedKey(url: string): string {
  const raw = url.trim();
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return `${host}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return raw.toLowerCase().replace(/\/+$/, '');
  }
}

export function findFeedByUrl(feeds: Feed[], url: string): Feed | undefined {
  if (!url) return undefined;
  const key = feedKey(url);
  return feeds.find((f) => feedKey(f.url) === key);
}

/** Refreshes the subscription list and the timeline after a follow change. In
 *  the desktop app the data-changed event does the same; the browser mock has
 *  no events. */
async function syncAfterChange() {
  const app = useApp.getState();
  await app.reloadSubscriptions();
  await app.loadEntries(true);
}

/** Subscribes and returns the new feed, or null when it failed (already
 *  reported as a toast). */
export async function followFeed(target: FollowTarget): Promise<Feed | null> {
  const { pushToast } = useUI.getState();
  try {
    const feed = await api.addFeedByUrl(target.url, target.categoryId ?? 0, target.view ?? '');
    await syncAfterChange();
    pushToast({ message: `已关注 ${feed?.title || target.title}`, tone: 'success' });
    return feed;
  } catch (err) {
    pushToast({ message: `关注失败：${(err as Error).message}`, tone: 'error' });
    return null;
  }
}

/**
 * Removes the subscription after confirmation. Returns false when the reader
 * backs out or the call fails. The toast offers to follow again, which
 * resubscribes into the same folder and tab.
 */
export async function unfollowFeed(
  feed: Feed,
  onRefollow?: (feed: Feed) => void,
): Promise<boolean> {
  const ok = window.confirm(
    `不再关注「${feed.title}」？\n它已抓取的文章会从时间线移除，其中收藏和稍后读的也会一起删除。`,
  );
  if (!ok) return false;

  const { pushToast } = useUI.getState();
  try {
    await api.removeFeed(feed.id);
    await syncAfterChange();
  } catch (err) {
    pushToast({ message: `取消关注失败：${(err as Error).message}`, tone: 'error' });
    return false;
  }
  pushToast({
    message: `已取消关注 ${feed.title}`,
    tone: 'info',
    duration: 6000,
    action: {
      label: '重新关注',
      onAction: () => {
        void followFeed({
          url: feed.url,
          title: feed.title,
          categoryId: feed.categoryId,
          view: feed.view,
        }).then((next) => {
          if (next) onRefollow?.(next);
        });
      },
    },
  });
  return true;
}
