/**
 * Typed bridge to the Go service.
 *
 * In the packaged app these calls are dispatched to the Wails v3 binding
 * `ReadS.<Method>`; in a plain browser (vite dev, visual regression runs) the
 * same surface is served by an in-memory mock so the UI is fully explorable
 * without the desktop shell.
 */
import { Call } from '@wailsio/runtime';
import type {
  AppInfo,
  Bootstrap,
  Category,
  CommentResult,
  Counts,
  DiscoveredFeed,
  EntryDetail,
  EntryPage,
  Entry,
  Feed,
  FeedSuggestion,
  ListQuery,
  PodcastSuggestion,
  RefreshResult,
  Settings,
  VideoChannel,
  VideoPlatform,
} from './types';

/**
 * Wails v3 registers each bound method under its fully-qualified Go name,
 * `<package path>.<type>.<method>` — see the FQN construction in
 * wails/v3/pkg/application/bindings.go. The service's own `ServiceName()`
 * method is used only for logging and is NOT part of this name, so it cannot
 * be shortened to something like "ReadS".
 */
const SERVICE = 'reads/internal/service.Service';

let bridgeProbe: Promise<boolean> | null = null;

/**
 * Detects once whether the Wails backend is reachable.
 *
 * The probe validates the response shape rather than just checking that the
 * request resolved: a static file server will happily answer POST
 * /wails/runtime with an HTML fallback page, which would otherwise be mistaken
 * for a working backend and break every subsequent call.
 */
function hasBridge(): Promise<boolean> {
  if (!bridgeProbe) {
    bridgeProbe = Call.ByName(`${SERVICE}.AppInfo`)
      .then((info) => {
        const value = info as AppInfo | null;
        return !!value && typeof value === 'object' && typeof value.name === 'string';
      })
      .catch(() => false);
  }
  return bridgeProbe;
}

type MockModule = { invoke: (method: string, args: unknown[]) => unknown };

let mockModule: MockModule | null = null;

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  if (await hasBridge()) {
    return (await Call.ByName(`${SERVICE}.${method}`, ...args)) as T;
  }
  if (!mockModule) {
    mockModule = (await import('./mock')) as unknown as MockModule;
  }
  return mockModule.invoke(method, args) as T;
}

/** True when running without the Go backend (browser development). */
export const isMockMode = () => hasBridge().then((ok) => !ok);

/* ----------------------------------------------------------- app/session */

export const getAppInfo = () => call<AppInfo>('AppInfo');
export const bootstrap = () => call<Bootstrap>('Bootstrap');
export const getCounts = () => call<Counts>('Counts');
export const getSettings = () => call<Settings>('GetSettings');
export const saveSettings = (settings: Settings) => call<void>('SaveSettings', settings);

/* --------------------------------------------------------------- timeline */

export const listEntries = (query: ListQuery) => call<EntryPage>('ListEntries', query);
export const getEntry = (id: number) => call<EntryDetail>('GetEntry', id);
export const markRead = (ids: number[], read: boolean) => call<void>('MarkRead', ids, read);
export const markAllRead = (query: ListQuery, read: boolean) =>
  call<number>('MarkAllRead', query, read);
export const toggleStar = (id: number) => call<boolean>('ToggleStar', id);
export const toggleReadLater = (id: number) => call<boolean>('ToggleReadLater', id);
export const fetchFullContent = (id: number) => call<EntryDetail>('FetchFullContent', id);
export const clearFullContent = (id: number) => call<EntryDetail>('ClearFullContent', id);
export const fetchComments = (id: number) => call<CommentResult>('FetchComments', id);

/* --------------------------------------------------------------- podcast */

/** Persists the episode position (milliseconds) and completion. */
export const savePlayback = (entryId: number, positionMs: number, durationSec: number, completed = false) =>
  call<void>('SavePlayback', entryId, positionMs, durationSec, completed);

/* ------------------------------------------------------------------ icons */

export const fetchFeedIcon = (feedId: number) => call<string>('FetchFeedIcon', feedId);
export const refreshAllFeedIcons = () => call<number>('RefreshAllFeedIcons');

/* ---------------------------------------------------------- subscriptions */

export const discover = (url: string) => call<DiscoveredFeed[]>('Discover', url);
export const addFeedByUrl = (url: string, categoryId = 0, view = '') =>
  call<Feed>('AddFeedByURL', url, categoryId, view);

/** Resolves a Bilibili / YouTube username or user ID to subscribable channels. */
export const searchVideoChannels = (platform: VideoPlatform, query: string) =>
  call<VideoChannel[]>('SearchVideoChannels', platform, query);
export const removeFeed = (id: number) => call<void>('RemoveFeed', id);
export const updateFeed = (id: number, title: string, categoryId: number, view: string) =>
  call<void>('UpdateFeed', id, title, categoryId, view);
export const moveFeed = (feedId: number, categoryId: number) =>
  call<void>('MoveFeed', feedId, categoryId);
export const setFeedView = (feedId: number, view: string) =>
  call<void>('SetFeedView', feedId, view);
export const reorderFeeds = (ids: number[]) => call<void>('ReorderFeeds', ids);

/* -------------------------------------------------------------- folders */

export const createCategory = (name: string) => call<Category>('CreateCategory', name);
export const renameCategory = (id: number, name: string) =>
  call<void>('RenameCategory', id, name);
export const deleteCategory = (id: number) => call<void>('DeleteCategory', id);

/* -------------------------------------------------------------- refresh */

export const refreshAll = () => call<RefreshResult>('RefreshAll');
export const refreshFeeds = (ids: number[]) => call<RefreshResult>('Refresh', ids);

/* ----------------------------------------------------------------- OPML */

export const importOpmlContent = (content: string) =>
  call<RefreshResult>('ImportOPMLContent', content);
export const exportOpmlContent = () => call<string>('ExportOPMLContent');
export const importOpmlFile = (path: string) => call<RefreshResult>('ImportOPML', path);
export const exportOpmlFile = (path: string) => call<number>('ExportOPML', path);

/* ------------------------------------------------------------------ misc */

/** Records the frontend's layout viewport in the application log. */
export const reportViewport = (width: number, height: number, dpr: number) =>
  call<void>('ReportViewport', width, height, dpr);


/* -------------------------------------------------------------- discovery */

/** Unread articles ranked by what the reader has starred and read. */
export const recommendEntries = (limit = 24) =>
  call<Entry[]>('RecommendEntries', limit);

/** Subscriptions the reader may like, similar to their own feeds. */
export const recommendFeeds = (limit = 12) =>
  call<FeedSuggestion[]>('RecommendFeeds', limit);

/** Real podcast shows; `round` rotates topics, `exclude` skips shows already shown. */
export const recommendPodcasts = (limit = 8, round = 0, exclude: string[] = []) =>
  call<PodcastSuggestion[]>('RecommendPodcasts', limit, round, exclude);
/* ---------------------------------------------------------------- events */

export const EVENTS = {
  refreshStart: 'reads:refresh:start',
  refreshProgress: 'reads:refresh:progress',
  refreshDone: 'reads:refresh:done',
  dataChanged: 'reads:data:changed',
  feedError: 'reads:feed:error',
} as const;
