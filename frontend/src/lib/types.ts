/** TypeScript mirror of the Go models in internal/model/model.go. */

export interface Category {
  id: number;
  name: string;
  sortOrder: number;
  unread: number;
  feedCount: number;
}

export interface Feed {
  id: number;
  title: string;
  url: string;
  siteUrl: string;
  description: string;
  iconUrl: string;
  /** Dominant colour of the icon (#rrggbb), used as the feed's theme tint. */
  color: string;
  categoryId: number;
  view: ViewKey;
  unread: number;
  error: string;
  lastFetched: number;
  sortOrder: number;
}

export interface Entry {
  id: number;
  feedId: number;
  feedTitle: string;
  feedIcon: string;
  feedView: ViewKey;
  title: string;
  url: string;
  author: string;
  summary: string;
  imageUrl: string;
  publishedAt: number;
  read: boolean;
  starred: boolean;
  readLater: boolean;
  hasContent: boolean;
  /** Episode file; empty for non-audio entries. */
  audioUrl: string;
  audioType: string;
  /** Feed-declared duration in seconds (0 when unknown). */
  audioDuration: number;
  /** Saved resume point in milliseconds. */
  audioPosition: number;
  /** The episode was played to its end. */
  audioPlayed: boolean;
}

export interface EntryDetail extends Entry {
  /** Body to display: the extracted full text when present, else the feed's. */
  content: string;
  /** The feed's own body, kept so the reader can switch back after extraction. */
  feedContent: string;
  fullContent: string;
  hasFullContent: boolean;
  comments: string;
  commentsCount: number;
  contentSource: string;
  readingMinutes: number;
  siteUrl: string;
}

export interface CommentResult {
  count: number;
  html: string;
  message: string;
}

/** Which body the reader is currently showing. */
export type ContentMode = 'feed' | 'full';

export interface ListQuery {
  scope: Scope;
  feedId?: number;
  categoryId?: number;
  view?: string;
  unreadOnly?: boolean;
  starredOnly?: boolean;
  search?: string;
  sortAsc?: boolean;
  limit?: number;
  offset?: number;
}

export interface EntryPage {
  entries: Entry[];
  total: number;
  hasMore: boolean;
}

export interface Counts {
  all: number;
  unread: number;
  starred: number;
  readLater: number;
  today: number;
}

export interface Settings {
  theme: 'light' | 'dark' | 'system';
  accentColor: string;
  entryColWidth: number;
  sidebarShowUnreadCount: boolean;
  refreshIntervalMinutes: number;
  markReadOnScroll: boolean;
  dimRead: boolean;
  groupByDate: boolean;
  timelineSortAsc: boolean;
  autoRefresh: boolean;
  contentFontSize: number;
  /** Width of the comments column, in CSS pixels. */
  commentPaneWidth: number;
  /** How the article list is presented: rows, or a two-column waterfall. */
  entryLayout: 'list' | 'masonry';
}

/** A subscription suggestion card in the discover pane. */
export interface FeedSuggestion {
  title: string;
  url: string;
  siteUrl: string;
  description: string;
  tags: string[];
  score: number;
}

/** A real show from the Apple Podcasts directory; `url` is its RSS feed. */
export interface PodcastSuggestion {
  title: string;
  author: string;
  url: string;
  pageUrl: string;
  artworkUrl: string;
  genre: string;
  description: string;
  episodeCount: number;
  /** Newest episode, unix milliseconds (0 = unknown). */
  lastEpisodeAt: number;
  /** One phrase saying why the show was picked. */
  reason: string;
  score: number;
}

export interface Bootstrap {
  categories: Category[];
  feeds: Feed[];
  counts: Counts;
  settings: Settings;
}

export interface DiscoveredFeed {
  title: string;
  url: string;
  type: string;
  isFeed: boolean;
  siteUrl: string;
}

export interface RefreshResult {
  updated: number;
  new: number;
  failed: number;
  errors: string[];
  durationMs: number;
}

export interface RefreshProgress {
  done: number;
  total: number;
  current: string;
  new: number;
}

export interface AppInfo {
  name: string;
  version: string;
  dataDir: string;
  platform: string;
  /**
   * Loopback image proxy origin, or '' when there is none (e.g. the browser
   * preview). Several CDNs refuse an image request whose Referer is the app's
   * own origin, so remote article images are routed through the Go side.
   */
  imageProxy?: string;
}

/* ------------------------------------------------------------------ views */

export type Scope = 'all' | 'unread' | 'starred' | 'readLater' | 'feed' | 'category' | 'today';
export type ViewKey = 'articles' | 'social' | 'pictures' | 'videos' | 'audio';

export interface ViewDefinition {
  key: ViewKey | 'all';
  label: string;
  /** Active-state colour, matching Folo's per-view accents. */
  color: string;
}

/** The five content tabs. Each one carries one kind of subscription: RSS
 *  articles, social posts, photo streams, video channels and podcasts. */
export const VIEWS: ViewDefinition[] = [
  { key: 'articles', label: '文章', color: '#84CC16' },
  { key: 'social', label: '社交', color: '#0EA5E9' },
  { key: 'pictures', label: '图片', color: '#22C55E' },
  { key: 'videos', label: '视频', color: '#EF4444' },
  { key: 'audio', label: '音频', color: '#A855F7' },
];

/** The home tab ("everything") now lives in the smart-list capsule group
 *  next to unread/starred/read-later/today (DESIGN.md §7.5). */
export const HOME_VIEW: ViewDefinition = { key: 'all', label: '首页', color: '#FF5C00' };

/** Folo's selectable accent presets, as light/dark pairs. */
export const ACCENTS: Record<string, { light: string; dark: string; label: string }> = {
  orange: { light: '#FF6B35', dark: '#FF5C00', label: '橙色' },
  blue: { light: '#5CA9F2', dark: '#2F78E8', label: '蓝色' },
  green: { light: '#4CD7A5', dark: '#1FA97A', label: '绿色' },
  purple: { light: '#B07BEF', dark: '#8A3DCC', label: '紫色' },
  pink: { light: '#F266A8', dark: '#C63C82', label: '粉色' },
  red: { light: '#E84A3C', dark: '#C22E28', label: '红色' },
  yellow: { light: '#F7B500', dark: '#D99800', label: '黄色' },
  gray: { light: '#8A96A3', dark: '#5C6673', label: '灰色' },
};
