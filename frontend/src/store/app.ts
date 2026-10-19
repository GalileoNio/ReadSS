import { create } from 'zustand';
import * as api from '../lib/api';
import type {
  Category,
  ContentMode,
  Counts,
  Entry,
  EntryDetail,
  Feed,
  ListQuery,
  RefreshProgress,
  Scope,
  Settings,
  ViewKey,
} from '../lib/types';

const PAGE_SIZE = 60;

/** What the entry list is currently showing. */
export interface Selection {
  scope: Scope;
  feedId: number;
  categoryId: number;
  view: ViewKey | 'all';
}

interface AppState {
  ready: boolean;
  error: string | null;

  categories: Category[];
  feeds: Feed[];
  counts: Counts;
  /** Loopback image proxy origin, or '' to load remote images directly. */
  imageProxy: string;
  settings: Settings;

  selection: Selection;
  entries: Entry[];
  total: number;
  hasMore: boolean;
  loadingEntries: boolean;

  selectedEntryId: number | null;
  entry: EntryDetail | null;
  loadingEntry: boolean;

  unreadOnly: boolean;
  search: string;
  refreshing: boolean;
  progress: RefreshProgress | null;

  /** Which body the reader shows when both a feed and an extracted one exist. */
  contentMode: ContentMode;
  fetchingFullText: boolean;
  loadingComments: boolean;
  /**
   * Why the last comment fetch failed, so the comments section can explain
   * itself inline instead of only reporting through a toast.
   */
  commentsError: string | null;
  /** Entries whose comments have already been attempted this session. */
  commentsAttempted: number[];

  /* actions */
  init: () => Promise<void>;
  reloadSubscriptions: () => Promise<void>;
  loadEntries: (reset?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  openEntry: (id: number | null) => Promise<void>;
  selectView: (view: ViewKey | 'all') => Promise<void>;
  selectFeed: (feedId: number) => Promise<void>;
  selectCategory: (categoryId: number) => Promise<void>;
  selectSmart: (scope: Scope) => Promise<void>;
  setUnreadOnly: (value: boolean) => void;
  setSearch: (value: string) => void;
  setContentMode: (mode: ContentMode) => void;
  fetchFullText: () => Promise<{ ok: boolean; error?: string }>;
  revertFullText: () => Promise<void>;
  loadComments: () => Promise<{ ok: boolean; count?: number; message?: string; error?: string }>;
  autoLoadComments: () => Promise<void>;

  markRead: (ids: number[], read: boolean) => Promise<void>;
  markAllRead: () => Promise<number>;
  toggleStar: (id: number) => Promise<void>;
  toggleReadLater: (id: number) => Promise<void>;
  step: (delta: number) => Promise<void>;

  refresh: (feedIds?: number[]) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
}

const emptyCounts: Counts = { all: 0, unread: 0, starred: 0, readLater: 0, today: 0 };

/**
 * Locally apply a read/star change so the UI responds instantly; the backend
 * call follows and a refresh reconciles any drift.
 */
function patchEntries(entries: Entry[], ids: number[], patch: Partial<Entry>): Entry[] {
  return entries.map((e) => (ids.includes(e.id) ? { ...e, ...patch } : e));
}

/** Re-reads an entry without letting a failure mask the original error. */
async function loadEntryQuietly(id: number): Promise<EntryDetail | null> {
  try {
    return await api.getEntry(id);
  } catch {
    return null;
  }
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  error: null,

  categories: [],
  feeds: [],
  counts: emptyCounts,
  settings: {
    theme: 'dark',
    accentColor: 'orange',
    entryColWidth: 450,
    sidebarShowUnreadCount: true,
    refreshIntervalMinutes: 30,
    markReadOnScroll: true,
    dimRead: false,
    groupByDate: false,
    timelineSortAsc: false,
    autoRefresh: true,
    contentFontSize: 16,
  // Tall enough for a couple of comments, small enough to leave the article readable.
  commentPaneWidth: 380,
  entryLayout: 'list',
  },

  selection: { scope: 'all', feedId: 0, categoryId: 0, view: 'all' },
  entries: [],
  total: 0,
  hasMore: false,
  loadingEntries: false,

  selectedEntryId: null,
  entry: null,
  loadingEntry: false,

  unreadOnly: false,
  search: '',
  refreshing: false,
  progress: null,
  contentMode: 'feed',
  fetchingFullText: false,
  loadingComments: false,
  commentsError: null,
  commentsAttempted: [],
  imageProxy: '',

  async init() {
    try {
      const boot = await api.bootstrap();
      set({
        ready: true,
        categories: boot.categories ?? [],
        feeds: boot.feeds ?? [],
        counts: boot.counts ?? emptyCounts,
        settings: { ...get().settings, ...boot.settings },
      });

      // Learn whether remote images need to go through the loopback proxy
      // (see AppInfo.imageProxy). Failure is not fatal: images then load
      // directly, which works for hosts without hotlink protection.
      void api
        .getAppInfo()
        .then((info) => set({ imageProxy: info?.imageProxy ?? '' }))
        .catch(() => undefined);

      await get().loadEntries(true);

      // Browser preview only: open the first article so the reader pane is
      // part of the render. `?list=1` keeps the list instead, which is how the
      // phone layout's list view gets captured. The desktop app always waits
      // for an explicit selection.
      if (await api.isMockMode()) {
        const wantsList = new URLSearchParams(window.location.search).has('list');
        const first = get().entries[0];
        if (first && !wantsList) await get().openEntry(first.id);
      }
    } catch (err) {
      set({ ready: true, error: `初始化失败：${(err as Error).message}` });
    }
  },

  async reloadSubscriptions() {
    const boot = await api.bootstrap();
    set({
      categories: boot.categories ?? [],
      feeds: boot.feeds ?? [],
      counts: boot.counts ?? emptyCounts,
    });
  },

  setContentMode(mode) {
    set({ contentMode: mode });
  },

  /**
   * Runs a readability pass over the original article and caches the result.
   * The feed's own body is kept, so this is always reversible.
   */
  async fetchFullText() {
    const id = get().selectedEntryId;
    if (!id) return { ok: false, error: '没有选中的文章' };

    set({ fetchingFullText: true });
    try {
      const detail = await api.fetchFullContent(id);
      set({ entry: detail, contentMode: 'full', fetchingFullText: false });
      return { ok: true };
    } catch (err) {
      set({ fetchingFullText: false });
      return { ok: false, error: (err as Error).message };
    }
  },

  async revertFullText() {
    const id = get().selectedEntryId;
    if (!id) return;
    const detail = await api.clearFullContent(id);
    set({ entry: detail, contentMode: 'feed' });
  },

  /** Downloads the article page and extracts its comment thread. */
  async loadComments() {
    const id = get().selectedEntryId;
    if (!id) return { ok: false, error: '没有选中的文章' };

    set({ loadingComments: true, commentsError: null });
    try {
      const result = await api.fetchComments(id);
      // The user may have moved on while this was in flight.
      if (get().selectedEntryId !== id) {
        set({ loadingComments: false });
        return { ok: true, count: result.count };
      }
      const detail = await api.getEntry(id);
      set({ entry: detail, loadingComments: false, commentsError: null });
      // The service explains an empty thread in plain words ("还没有评论" or
      // "暂时取不到"), and the reader shows that sentence as-is.
      return { ok: true, count: result.count, message: result.message };
    } catch (err) {
      const message = (err as Error).message;
      if (get().selectedEntryId === id) {
        set({ loadingComments: false, commentsError: message, entry: await loadEntryQuietly(id) });
      } else {
        set({ loadingComments: false, commentsError: message });
      }
      return { ok: false, error: message };
    }
  },

  /**
   * Fetches comments automatically the first time an article is opened, so the
   * section below the article is populated without the user asking.
   */
  async autoLoadComments() {
    const { selectedEntryId, entry, commentsAttempted } = get();
    if (!entry || !selectedEntryId) return;
    if (entry.comments) return;
    if (!entry.url) return;
    if (commentsAttempted.includes(selectedEntryId)) return;

    set({ commentsAttempted: [...commentsAttempted, selectedEntryId] });
    await get().loadComments();
  },

  async loadEntries(reset = false) {
    const { selection, unreadOnly, search, entries } = get();
    set({ loadingEntries: true });
    try {
      const query: ListQuery = {
        scope: selection.scope,
        feedId: selection.feedId,
        categoryId: selection.categoryId,
        view: selection.view,
        unreadOnly,
        search,
        sortAsc: get().settings.timelineSortAsc,
        limit: PAGE_SIZE,
        offset: reset ? 0 : entries.length,
      };
      const page = await api.listEntries(query);
      set({
        entries: reset ? page.entries : [...entries, ...page.entries],
        total: page.total,
        hasMore: page.hasMore,
        loadingEntries: false,
      });
    } catch (err) {
      set({ loadingEntries: false, error: (err as Error).message });
    }
  },

  async loadMore() {
    const { hasMore, loadingEntries } = get();
    if (!hasMore || loadingEntries) return;
    await get().loadEntries(false);
  },

  async openEntry(id) {
    if (id == null) {
      set({ selectedEntryId: null, entry: null });
      return;
    }
    set({ selectedEntryId: id, loadingEntry: true, commentsError: null });
    try {
      const detail = await api.getEntry(id);
      // Prefer the extracted full text whenever it has already been fetched.
      set({
        entry: detail,
        loadingEntry: false,
        contentMode: detail.hasFullContent ? 'full' : 'feed',
      });
      // Opening an entry marks it read, matching Folo's behaviour.
      const current = get().entries.find((e) => e.id === id);
      if (current && !current.read) {
        set({ entries: patchEntries(get().entries, [id], { read: true }) });
        await api.markRead([id], true);
        set({ counts: await api.getCounts() });
        void get().reloadSubscriptions();
      }

      // The comments section below the article populates itself the first time
      // an article is opened, rather than waiting for a click.
      void get().autoLoadComments();
    } catch (err) {
      set({ loadingEntry: false, error: (err as Error).message });
    }
  },

  async selectView(view) {
    set({ selection: { scope: 'all', feedId: 0, categoryId: 0, view } });
    await get().loadEntries(true);
  },

  async selectFeed(feedId) {
    set({ selection: { scope: 'feed', feedId, categoryId: 0, view: 'all' } });
    await get().loadEntries(true);
  },

  async selectCategory(categoryId) {
    set({ selection: { scope: 'category', categoryId, feedId: 0, view: 'all' } });
    await get().loadEntries(true);
  },

  async selectSmart(scope) {
    set({ selection: { scope, feedId: 0, categoryId: 0, view: 'all' } });
    await get().loadEntries(true);
  },

  setUnreadOnly(value) {
    set({ unreadOnly: value });
    void get().loadEntries(true);
  },

  setSearch(value) {
    set({ search: value });
    void get().loadEntries(true);
  },

  async markRead(ids, read) {
    set({ entries: patchEntries(get().entries, ids, { read }) });
    await api.markRead(ids, read);
    set({ counts: await api.getCounts() });
    void get().reloadSubscriptions();
  },

  async markAllRead() {
    const { selection, unreadOnly, search } = get();
    const n = await api.markAllRead(
      {
        scope: selection.scope,
        feedId: selection.feedId,
        categoryId: selection.categoryId,
        view: selection.view,
        unreadOnly,
        search,
      },
      true,
    );
    await get().loadEntries(true);
    await get().reloadSubscriptions();
    set({ counts: await api.getCounts() });
    return n;
  },

  async toggleStar(id) {
    const starred = await api.toggleStar(id);
    set({ entries: patchEntries(get().entries, [id], { starred }) });
    if (get().entry?.id === id) set({ entry: { ...get().entry!, starred } });
    set({ counts: await api.getCounts() });
  },

  async toggleReadLater(id) {
    const readLater = await api.toggleReadLater(id);
    set({ entries: patchEntries(get().entries, [id], { readLater }) });
    if (get().entry?.id === id) set({ entry: { ...get().entry!, readLater } });
    set({ counts: await api.getCounts() });
  },

  /** Move the selection by delta, as J/K and the arrow keys do. */
  async step(delta) {
    const { entries, selectedEntryId } = get();
    if (entries.length === 0) return;
    const index = entries.findIndex((e) => e.id === selectedEntryId);
    const next = index < 0 ? 0 : Math.min(entries.length - 1, Math.max(0, index + delta));
    await get().openEntry(entries[next].id);
  },

  async refresh(feedIds) {
    if (get().refreshing) return;
    set({ refreshing: true, progress: null });
    try {
      const result = feedIds?.length
        ? await api.refreshFeeds(feedIds)
        : await api.refreshAll();
      await get().reloadSubscriptions();
      await get().loadEntries(true);
      set({ counts: await api.getCounts(), refreshing: false, progress: null });
      if (result.failed > 0) {
        set({ error: `${result.failed} 个订阅源刷新失败：${result.errors[0] ?? ''}` });
      }
    } catch (err) {
      set({ refreshing: false, progress: null, error: (err as Error).message });
    }
  },

  async updateSettings(patch) {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    await api.saveSettings(next);
    if (patch.timelineSortAsc !== undefined) {
      await get().loadEntries(true);
    }
  },
}));

/** Feeds grouped by folder, with an uncategorised bucket last. */
export function groupFeeds(
  feeds: Feed[],
  categories: Category[],
): { category: Category | null; feeds: Feed[] }[] {
  const groups: { category: Category | null; feeds: Feed[] }[] = categories
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => ({
      category,
      feeds: feeds.filter((f) => f.categoryId === category.id),
    }))
    .filter((g) => g.feeds.length > 0);

  const loose = feeds.filter((f) => !categories.some((c) => c.id === f.categoryId));
  if (loose.length > 0) groups.push({ category: null, feeds: loose });
  return groups;
}
