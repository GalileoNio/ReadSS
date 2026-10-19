// Package model holds the plain data types shared between the storage layer,
// the feed engine and the Wails-bound service.
//
// Every type here is serialised straight to JSON for the frontend, so field
// names are lowerCamelCase and timestamps are Unix milliseconds.
package model

// View values classify feeds and entries into Folo's timeline tabs.
const (
	ViewArticles = "articles"
	ViewSocial   = "social"
	ViewPictures = "pictures"
	ViewVideos   = "videos"
)

// Scope values select what a timeline query shows.
const (
	ScopeAll       = "all"
	ScopeUnread    = "unread"
	ScopeStarred   = "starred"
	ScopeReadLater = "readLater"
	ScopeFeed      = "feed"
	ScopeCategory  = "category"
	ScopeToday     = "today"
)

// Category is a collapsible folder of feeds ("group" in Folo's UI).
type Category struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	SortOrder int    `json:"sortOrder"`
	Unread    int    `json:"unread"`
	FeedCount int    `json:"feedCount"`
}

// Feed is a subscription.
type Feed struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	URL         string `json:"url"`
	SiteURL     string `json:"siteUrl"`
	Description string `json:"description"`
	IconURL     string `json:"iconUrl"`
	CategoryID  int64  `json:"categoryId"`
	View        string `json:"view"`
	Unread      int    `json:"unread"`
	Error       string `json:"error"`
	LastFetched int64  `json:"lastFetched"`
	SortOrder   int    `json:"sortOrder"`
}

// Entry is a single article as it appears in the entry list.
type Entry struct {
	ID          int64  `json:"id"`
	FeedID      int64  `json:"feedId"`
	FeedTitle   string `json:"feedTitle"`
	FeedIcon    string `json:"feedIcon"`
	FeedView    string `json:"feedView"`
	Title       string `json:"title"`
	URL         string `json:"url"`
	Author      string `json:"author"`
	Summary     string `json:"summary"`
	ImageURL    string `json:"imageUrl"`
	PublishedAt int64  `json:"publishedAt"`
	Read        bool   `json:"read"`
	Starred     bool   `json:"starred"`
	ReadLater   bool   `json:"readLater"`
	HasContent  bool   `json:"hasContent"`
}

// EntryDetail adds the fields only needed by the reader pane.
type EntryDetail struct {
	Entry

	// Content is the body the reader should show: the extracted full text when
	// it exists, otherwise whatever the feed supplied.
	Content string `json:"content"`

	// FeedContent keeps the feed's own body so the reader can switch back to
	// it after a full-text fetch, and FullContent is the extracted body.
	FeedContent    string `json:"feedContent"`
	FullContent    string `json:"fullContent"`
	HasFullContent bool   `json:"hasFullContent"`

	// Comments holds the extracted comment thread, if one was found.
	Comments      string `json:"comments"`
	CommentsCount int    `json:"commentsCount"`

	ContentSource  string `json:"contentSource"`
	ReadingMinutes int    `json:"readingMinutes"`
	SiteURL        string `json:"siteUrl"`
}

// CommentResult reports the outcome of a comment extraction attempt.
type CommentResult struct {
	Count   int    `json:"count"`
	HTML    string `json:"html"`
	Message string `json:"message"`
}

// CommentRecipe is a discovered, working way to read one host's comments.
//
// It lives here rather than in the feed package because the storage layer
// persists it, and the feed engine already depends on the storage layer for
// FeedItem — putting it in either of those two would create an import cycle.
type CommentRecipe struct {
	Host       string `json:"host"`
	Endpoint   string `json:"endpoint"`
	IDParam    string `json:"idParam"`
	PageParam  string `json:"pageParam"`
	LimitParam string `json:"limitParam"`
	DataPath   string `json:"dataPath"`
	// AssetBase is the origin that serves the API's relative asset paths.
	// Comment APIs often return avatar paths with no host at all, and that host
	// is frequently a CDN that is neither the page nor the API origin, so it is
	// discovered once and remembered.
	AssetBase  string `json:"assetBase"`
	VerifiedAt int64  `json:"verifiedAt"`
}

// ListQuery describes a timeline request coming from the frontend.
type ListQuery struct {
	Scope       string `json:"scope"`
	FeedID      int64  `json:"feedId"`
	CategoryID  int64  `json:"categoryId"`
	View        string `json:"view"`
	UnreadOnly  bool   `json:"unreadOnly"`
	StarredOnly bool   `json:"starredOnly"`
	Search      string `json:"search"`
	SortAsc     bool   `json:"sortAsc"`
	Limit       int    `json:"limit"`
	Offset      int    `json:"offset"`
}

// EntryPage is one page of timeline results.
type EntryPage struct {
	Entries []*Entry `json:"entries"`
	Total   int      `json:"total"`
	HasMore bool     `json:"hasMore"`
}

// Counts powers the sidebar's smart-list numbers.
type Counts struct {
	All       int `json:"all"`
	Unread    int `json:"unread"`
	Starred   int `json:"starred"`
	ReadLater int `json:"readLater"`
	Today     int `json:"today"`
}

// Settings mirrors the subset of user preferences the app persists.
type Settings struct {
	Theme              string `json:"theme"`
	AccentColor        string `json:"accentColor"`
	FeedColWidth       int    `json:"feedColWidth"`
	EntryColWidth      int    `json:"entryColWidth"`
	SidebarShowUnread  bool   `json:"sidebarShowUnreadCount"`
	RefreshIntervalMin int    `json:"refreshIntervalMinutes"`
	MarkReadOnScroll   bool   `json:"markReadOnScroll"`
	DimRead            bool   `json:"dimRead"`
	GroupByDate        bool   `json:"groupByDate"`
	TimelineSortAsc    bool   `json:"timelineSortAsc"`
	AutoRefresh        bool   `json:"autoRefresh"`
	ContentFontSize    int    `json:"contentFontSize"`
	// CommentPaneWidth is the width of the comments column, in CSS pixels. The
	// column is docked to the right of the reader, so its size is a user
	// preference rather than something derived from the content.
	CommentPaneWidth int `json:"commentPaneWidth"`
	// EntryLayout is how the article list is presented: "list" (rows) or
	// "masonry" (a two-column waterfall of cards).
	EntryLayout string `json:"entryLayout"`
}

// DefaultSettings returns the settings a fresh install starts with. The
// defaults intentionally match Folo's own defaults where an equivalent exists.
func DefaultSettings() Settings {
	return Settings{
		Theme:              "dark",
		AccentColor:        "orange",
		FeedColWidth:       256,
		EntryColWidth:      450,
		SidebarShowUnread:  true,
		RefreshIntervalMin: 30,
		MarkReadOnScroll:   true,
		DimRead:            false,
		GroupByDate:        false,
		TimelineSortAsc:    false,
		AutoRefresh:        true,
		ContentFontSize:    16,
		CommentPaneWidth:   380,
		EntryLayout:        "list",
	}
}

// Bootstrap is everything the frontend needs for its first render.
type Bootstrap struct {
	Categories []*Category `json:"categories"`
	Feeds      []*Feed     `json:"feeds"`
	Counts     Counts      `json:"counts"`
	Settings   Settings    `json:"settings"`
}

// DiscoveredFeed is a candidate feed found while resolving a URL.
type DiscoveredFeed struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Type    string `json:"type"`
	IsFeed  bool   `json:"isFeed"`
	SiteURL string `json:"siteUrl"`
}

// FeedSuggestion is a subscription the app thinks the reader may want, shown as
// a card in the discover pane. Clicking it subscribes through the normal
// AddFeedByURL path, so nothing here bypasses discovery or validation.
type FeedSuggestion struct {
	Title       string   `json:"title"`
	URL         string   `json:"url"`
	SiteURL     string   `json:"siteUrl"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	// Score is the interest match; the frontend only uses it for ordering.
	Score int `json:"score"`
}

// RefreshResult summarises one refresh pass.
type RefreshResult struct {
	Updated  int      `json:"updated"`
	New      int      `json:"new"`
	Failed   int      `json:"failed"`
	Errors   []string `json:"errors"`
	Duration int64    `json:"durationMs"`
}

// RefreshProgress is streamed to the UI while a refresh is running.
type RefreshProgress struct {
	Done    int    `json:"done"`
	Total   int    `json:"total"`
	Current string `json:"current"`
	New     int    `json:"new"`
}
