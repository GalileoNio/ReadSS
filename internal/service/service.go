// Package service exposes ReadS's behaviour to the frontend as a Wails v3
// service. Every exported method becomes callable from JavaScript through
// Call.ByName("reads/internal/service.Service.<Method>", ...) — Wails keys
// bindings by the fully-qualified Go name of the method.
package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"reads/internal/feed"
	"reads/internal/model"
	"reads/internal/opml"
	"reads/internal/store"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Events emitted to the frontend.
const (
	EventRefreshStart    = "reads:refresh:start"
	EventRefreshProgress = "reads:refresh:progress"
	EventRefreshDone     = "reads:refresh:done"
	EventDataChanged     = "reads:data:changed"
	EventFeedError       = "reads:feed:error"
)

// minFullContentRunes is the point below which a feed-provided body is
// considered a teaser and a readability pass is attempted instead.
const minFullContentRunes = 400

// Service is the Wails-bound application service.
type Service struct {
	store   *store.Store
	fetcher *feed.Fetcher
	dataDir string
	version string

	app *application.App // nil in headless/self-test mode
	log *slog.Logger

	// proxyBase is the loopback image proxy's origin, when one is running.
	proxyBase string

	ctx    context.Context
	cancel context.CancelFunc

	refreshMu  sync.Mutex
	refreshing bool

	schedMu   sync.Mutex
	schedStop context.CancelFunc
}

// New creates the service.
func New(st *store.Store, dataDir, version string) *Service {
	fetcher := feed.NewFetcher()
	// Let the fetcher cache the comment APIs it discovers, per host.
	fetcher.SetRecipeStore(st)

	return &Service{
		store:   st,
		fetcher: fetcher,
		dataDir: dataDir,
		version: version,
		log:     slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}

// SetLogger routes the service's diagnostic logging to the application log.
func (s *Service) SetLogger(logger *slog.Logger) {
	if logger != nil {
		s.log = logger
		s.fetcher.SetLogger(logger)
	}
}

// Attach gives the service a handle to the running application so it can emit
// events. It is called after application.New and may be skipped in headless
// mode, in which case event emission becomes a no-op.
func (s *Service) Attach(app *application.App) { s.app = app }

// ServiceName names the service in logs and error messages.
//
// Note: this is *not* the prefix used to call bound methods from JavaScript.
// Wails v3 keys bindings by the fully-qualified Go name
// `reads/internal/service.Service.<Method>`, which is what
// frontend/src/lib/api.ts must pass to Call.ByName.
func (s *Service) ServiceName() string { return "ReadS" }

// ServiceStartup is the Wails lifecycle hook: it records the app context and
// starts the background refresh loop.
func (s *Service) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	if ctx == nil {
		// Headless callers (self-test, future CLI) may not supply one.
		ctx = context.Background()
	}
	s.ctx, s.cancel = context.WithCancel(ctx)
	s.backfillFeedColors()
	s.startScheduler()
	return nil
}

// ServiceShutdown stops the scheduler and closes the database.
func (s *Service) ServiceShutdown() error {
	if s.cancel != nil {
		s.cancel()
	}
	if s.store != nil {
		return s.store.Close()
	}
	return nil
}

func (s *Service) emit(name string, data any) {
	if s.app == nil {
		return
	}
	s.app.Event.Emit(name, data)
}

/* ------------------------------------------------------------- bootstrap */

// Bootstrap returns everything needed for the first render.
func (s *Service) Bootstrap() (*model.Bootstrap, error) {
	cats, err := s.store.Categories()
	if err != nil {
		return nil, err
	}
	feeds, err := s.store.Feeds()
	if err != nil {
		return nil, err
	}
	counts, err := s.store.Counts()
	if err != nil {
		return nil, err
	}
	settings, err := s.store.Settings()
	if err != nil {
		return nil, err
	}
	return &model.Bootstrap{Categories: cats, Feeds: feeds, Counts: counts, Settings: settings}, nil
}

// Counts returns the sidebar smart-list totals.
func (s *Service) Counts() (model.Counts, error) { return s.store.Counts() }

// GetSettings returns the persisted preferences.
func (s *Service) GetSettings() (model.Settings, error) { return s.store.Settings() }

// SaveSettings persists preferences and applies any that affect the scheduler.
func (s *Service) SaveSettings(v model.Settings) error {
	if err := s.store.SaveSettings(v); err != nil {
		return err
	}
	s.startScheduler()
	return nil
}

// AppInfo reports build/runtime facts for the About panel.
func (s *Service) AppInfo() map[string]any {
	return map[string]any{
		"name":     "ReadS",
		"version":  s.version,
		"dataDir":  s.dataDir,
		"platform": "windows",
		// Remote images are rewritten to go through this loopback proxy, which
		// can supply the Referer some CDNs require. Empty means "load directly",
		// which is what the browser preview does.
		"imageProxy": s.imageProxyBase(),
	}
}

// SetImageProxy wires the loopback image proxy used for article images.
func (s *Service) SetImageProxy(p interface{ Base() string }) {
	if p != nil {
		s.proxyBase = p.Base()
	}
}

func (s *Service) imageProxyBase() string { return s.proxyBase }

/* -------------------------------------------------------------- timeline */

// ListEntries returns one page of the timeline.
func (s *Service) ListEntries(q model.ListQuery) (*model.EntryPage, error) {
	return s.store.QueryEntries(q)
}

// GetEntry returns a single entry with its article body.
func (s *Service) GetEntry(id int64) (*model.EntryDetail, error) {
	return s.store.EntryDetail(id)
}

/* ---------------------------------------------------------- discovery */

// RecommendEntries suggests unread articles based on what the reader has
// starred and read: a content-based ranking over the entries already in the
// library, so it needs no network and no account.
func (s *Service) RecommendEntries(limit int) ([]*model.Entry, error) {
	if limit <= 0 || limit > 60 {
		limit = 24
	}
	seeds, candidates, err := s.store.RecommendationData(400, 1200)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return []*model.Entry{}, nil
	}
	ranked := feed.RankEntries(seeds, candidates)
	if len(ranked) > limit {
		ranked = ranked[:limit]
	}
	return ranked, nil
}

// RecommendFeeds suggests subscriptions similar to the reader's interests.
//
// Candidates come from a curated catalogue (internal/feed/catalog.go) because
// the app cannot invent feeds it has never seen; the reader's own feed titles,
// descriptions and reading history decide the order, and anything already
// subscribed is filtered out. Subscribing still goes through AddFeedByURL, so
// discovery and validation are unchanged.
func (s *Service) RecommendFeeds(limit int) ([]model.FeedSuggestion, error) {
	if limit <= 0 || limit > 40 {
		limit = 12
	}
	feeds, err := s.store.Feeds()
	if err != nil {
		return nil, err
	}
	seeds, _, err := s.store.RecommendationData(300, 0)
	if err != nil {
		return nil, err
	}

	interest := make([]string, 0, len(feeds)*2+len(seeds)*2)
	subscribed := make([]string, 0, len(feeds)*2)
	for _, f := range feeds {
		interest = append(interest, f.Title, f.Description)
		subscribed = append(subscribed, f.URL, f.SiteURL)
	}
	for _, e := range seeds {
		interest = append(interest, e.Title, e.Summary)
	}

	ranked := feed.RankFeeds(interest, subscribed, feed.Catalog)
	if len(ranked) > limit {
		ranked = ranked[:limit]
	}
	return ranked, nil
}

// MarkRead sets the read flag for the given entries.
func (s *Service) MarkRead(ids []int64, read bool) error {
	if err := s.store.SetRead(ids, read); err != nil {
		return err
	}
	s.emit(EventDataChanged, map[string]any{"reason": "read"})
	return nil
}

// MarkAllRead applies the read flag to every entry matching a query.
//
// The query is evaluated server-side so "mark all as read" covers the whole
// selection, not just the page the UI happens to be holding.
func (s *Service) MarkAllRead(q model.ListQuery, read bool) (int, error) {
	ids, err := s.store.EntryIDs(q)
	if err != nil {
		return 0, err
	}
	if err := s.store.SetRead(ids, read); err != nil {
		return 0, err
	}
	s.emit(EventDataChanged, map[string]any{"reason": "read-all"})
	return len(ids), nil
}

// ToggleStar flips an entry's starred flag.
func (s *Service) ToggleStar(id int64) (bool, error) {
	v, err := s.store.ToggleStar(id)
	if err == nil {
		s.emit(EventDataChanged, map[string]any{"reason": "star"})
	}
	return v, err
}

// ToggleReadLater flips an entry's "read later" flag.
func (s *Service) ToggleReadLater(id int64) (bool, error) {
	v, err := s.store.ToggleReadLater(id)
	if err == nil {
		s.emit(EventDataChanged, map[string]any{"reason": "read-later"})
	}
	return v, err
}

// FetchFullContent pulls the original article through readability and caches
// it separately from the feed's own body, so the reader can switch between the
// two. Calling it again re-fetches and replaces the cached copy.
func (s *Service) FetchFullContent(id int64) (*model.EntryDetail, error) {
	detail, err := s.store.EntryDetail(id)
	if err != nil {
		return nil, err
	}
	if detail.URL == "" {
		return detail, errors.New("这篇没有原文链接，无法获取全文")
	}

	ctx, cancel := context.WithTimeout(s.baseCtx(), 45*time.Second)
	defer cancel()

	content, err := s.fetcher.FetchArticle(ctx, detail.URL)
	if err != nil {
		return detail, err
	}
	if err := s.store.SetFullContent(id, content); err != nil {
		return nil, err
	}
	s.emit(EventDataChanged, map[string]any{"reason": "full-content", "entryId": id})
	return s.store.EntryDetail(id)
}

// ClearFullContent discards the extracted body and reverts the reader to the
// feed's own version.
func (s *Service) ClearFullContent(id int64) (*model.EntryDetail, error) {
	if err := s.store.ClearFullContent(id); err != nil {
		return nil, err
	}
	s.emit(EventDataChanged, map[string]any{"reason": "full-content-cleared", "entryId": id})
	return s.store.EntryDetail(id)
}

// FetchComments downloads the article page and extracts its comment thread,
// caching it against the entry.
func (s *Service) FetchComments(id int64) (*model.CommentResult, error) {
	detail, err := s.store.EntryDetail(id)
	if err != nil {
		return nil, err
	}
	if detail.URL == "" {
		return nil, errors.New("这篇没有原文链接，无法获取评论")
	}

	result, err := s.FetchCommentsByURL(detail.URL)
	if err != nil {
		return nil, err
	}
	if result.Count > 0 {
		if err := s.storeComments(id, result.HTML, result.Count); err != nil {
			return nil, err
		}
	}
	return result, nil
}

// FetchCommentsByURL fetches comments for an arbitrary article URL.
//
// It exists so the comment pipeline can be exercised directly (see --test-comments)
// without first subscribing to a feed.
func (s *Service) FetchCommentsByURL(articleURL string) (*model.CommentResult, error) {
	html, count, err := s.fetcher.FetchComments(s.baseCtx(), articleURL)
	if err != nil {
		// Not being able to read a site's comments is an ordinary outcome, not
		// a failure of the app: log the reason for diagnosis and hand the reader
		// a plain sentence. Returning an error here would surface it as a
		// crash-level log entry and an error toast.
		s.log.Info("comments unavailable", "url", articleURL, "reason", err.Error())
		return &model.CommentResult{Count: 0, Message: "暂时取不到这篇的评论"}, nil
	}
	if count == 0 {
		return &model.CommentResult{
			Count:   0,
			Message: "这篇还没有评论",
		}, nil
	}
	return &model.CommentResult{
		Count:   count,
		HTML:    html,
		Message: fmt.Sprintf("已获取 %d 条评论", count),
	}, nil
}

// storeComments persists an extracted thread against an entry.
func (s *Service) storeComments(id int64, html string, count int) error {
	if err := s.store.SetComments(id, html, count); err != nil {
		return err
	}
	s.emit(EventDataChanged, map[string]any{"reason": "comments", "entryId": id})
	return nil
}

func (s *Service) baseCtx() context.Context {
	if s.ctx != nil {
		return s.ctx
	}
	return context.Background()
}

/* ---------------------------------------------------------------- icons */

// iconCooldown is how long the app waits before retrying a feed whose icon
// could not be fetched, so a site without a favicon is not retried constantly.
const iconCooldown = 7 * 24 * time.Hour

// feedImageBudget bounds an inlined feed-provided logo. It is larger than the
// icon budget because site logos are routinely bigger than favicons.
const feedImageBudget = 128 << 10

// fetchAndStoreIcon resolves a feed's icon and caches it locally.
//
// Order of preference: an image the feed advertises itself (inlined, since it
// is the site's chosen mark), then the site's own favicon declarations.
func (s *Service) fetchAndStoreIcon(ctx context.Context, feedID int64, feedImage, siteURL, feedURL string) {
	// A remote link from the feed itself is downloaded and stored inline.
	if strings.HasPrefix(feedImage, "http") {
		if inlined, err := s.fetcher.InlineImage(ctx, feedImage, feedImageBudget); err == nil {
			if err := s.store.SetFeedIcon(feedID, inlined); err == nil {
				s.storeFeedColor(feedID, inlined)
				s.emit(EventDataChanged, map[string]any{"reason": "feed-icon", "feedId": feedID})
			}
			return
		}
		// Oversized or unreachable: keep the remote link rather than nothing,
		// then still try to find a smaller local icon below.
		_ = s.store.SetFeedIcon(feedID, feedImage)
	}

	for _, candidate := range []string{siteURL, feedURL} {
		if strings.TrimSpace(candidate) == "" {
			continue
		}
		icon, err := s.fetcher.FetchIcon(ctx, candidate)
		if err != nil || icon == "" {
			continue
		}
		if err := s.store.SetFeedIcon(feedID, icon); err == nil {
			s.storeFeedColor(feedID, icon)
			s.emit(EventDataChanged, map[string]any{"reason": "feed-icon", "feedId": feedID})
		}
		return
	}

	// Nothing found: record the attempt so it is not retried immediately.
	_ = s.store.TouchFeedIcon(feedID)
}

// storeFeedColor derives the icon's dominant colour and persists it. The
// colour is what cards use as the feed's theme tint, so a feed with a known
// icon should not have to fall back to a hash of its title.
func (s *Service) storeFeedColor(feedID int64, iconDataURI string) {
	if color := feed.DominantColor(iconDataURI); color != "" {
		_ = s.store.SetFeedColor(feedID, color)
	}
}

// backfillFeedColors fills in colours for icons that were cached by an older
// build (their data URI is already in the database, so no network is needed).
func (s *Service) backfillFeedColors() {
	feeds, err := s.store.Feeds()
	if err != nil {
		return
	}
	for _, f := range feeds {
		if f.Color != "" || !strings.HasPrefix(f.IconURL, "data:image/") {
			continue
		}
		s.storeFeedColor(f.ID, f.IconURL)
	}
}

// FetchFeedIcon re-resolves a single feed's icon on demand.
func (s *Service) FetchFeedIcon(feedID int64) (string, error) {
	feed, err := s.store.FeedByID(feedID)
	if err != nil {
		return "", err
	}

	ctx, cancel := context.WithTimeout(s.baseCtx(), 40*time.Second)
	defer cancel()

	s.fetchAndStoreIcon(ctx, feedID, feed.IconURL, feed.SiteURL, feed.URL)

	updated, err := s.store.FeedByID(feedID)
	if err != nil {
		return "", err
	}
	if updated.IconURL == "" {
		return "", fmt.Errorf("没有找到 %s 的站点图标", feed.Title)
	}
	return updated.IconURL, nil
}

// RefreshAllFeedIcons re-resolves icons for every feed that needs one.
func (s *Service) RefreshAllFeedIcons() (int, error) {
	feeds, err := s.store.FeedsNeedingIcons(iconCooldown.Milliseconds(), 50)
	if err != nil {
		return 0, err
	}
	if len(feeds) == 0 {
		// Nothing is due; retry everything so a manual click always does work.
		all, err := s.store.Feeds()
		if err != nil {
			return 0, err
		}
		feeds = all
	}

	fixed := 0
	for _, f := range feeds {
		before := f.IconURL
		ctx, cancel := context.WithTimeout(s.baseCtx(), 40*time.Second)
		s.fetchAndStoreIcon(ctx, f.ID, f.IconURL, f.SiteURL, f.URL)
		cancel()

		updated, err := s.store.FeedByID(f.ID)
		if err == nil && updated.IconURL != "" && updated.IconURL != before {
			fixed++
		}
	}
	s.emit(EventDataChanged, map[string]any{"reason": "feed-icons", "count": fixed})
	return fixed, nil
}

/* ---------------------------------------------------------------- refresh */
/* --------------------------------------------------------- subscriptions */

// Discover resolves a URL to candidate feeds without subscribing.
func (s *Service) Discover(rawURL string) ([]model.DiscoveredFeed, error) {
	ctx, cancel := context.WithTimeout(s.baseCtx(), 40*time.Second)
	defer cancel()
	return s.fetcher.Discover(ctx, rawURL)
}

// AddFeedByURL subscribes to a URL, discovering the feed if necessary, and
// immediately fetches its items.
func (s *Service) AddFeedByURL(rawURL string, categoryID int64, view string) (*model.Feed, error) {
	ctx, cancel := context.WithTimeout(s.baseCtx(), 60*time.Second)
	defer cancel()

	candidates, err := s.fetcher.Discover(ctx, rawURL)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return nil, errors.New("这个地址上没有找到订阅源")
	}

	// Prefer an explicit feed reference; fall back to the first candidate.
	chosen := candidates[0]
	for _, c := range candidates {
		if c.IsFeed {
			chosen = c
			break
		}
	}

	result, err := s.fetcher.Fetch(ctx, chosen.URL, "", "")
	if err != nil {
		return nil, err
	}

	title := strings.TrimSpace(result.Title)
	if title == "" {
		title = chosen.Title
	}
	candidate := &model.Feed{
		Title:       title,
		URL:         chosen.URL,
		SiteURL:     firstNonEmpty(result.SiteURL, chosen.SiteURL),
		Description: result.Description,
		IconURL:     result.IconURL,
		CategoryID:  categoryID,
		View:        firstNonEmpty(view, result.View),
	}

	saved, created, err := s.store.AddFeed(candidate)
	if err != nil {
		return nil, err
	}
	if !created {
		// Already subscribed: refresh it instead of duplicating.
		if _, err := s.Refresh([]int64{saved.ID}); err != nil {
			return saved, err
		}
		return s.store.FeedByID(saved.ID)
	}

	if _, err := s.store.SaveEntries(saved.ID, result.Items); err != nil {
		return nil, err
	}
	if err := s.store.UpdateFeedDetails(saved.ID, title, candidate.SiteURL, candidate.Description, candidate.IconURL); err != nil {
		return nil, err
	}
	if err := s.store.SetFeedValidators(saved.ID, result.ETag, result.LastModified); err != nil {
		return nil, err
	}

	// Resolve the site's real icon now, so the sidebar shows it immediately
	// rather than after the next background refresh.
	s.fetchAndStoreIcon(ctx, saved.ID, candidate.IconURL,
		firstNonEmpty(candidate.SiteURL, chosen.SiteURL), chosen.URL)

	s.emit(EventDataChanged, map[string]any{"reason": "feed-added", "feedId": saved.ID})
	return s.store.FeedByID(saved.ID)
}

// RemoveFeed unsubscribes and deletes the feed's entries.
func (s *Service) RemoveFeed(id int64) error {
	if err := s.store.DeleteFeed(id); err != nil {
		return err
	}
	s.emit(EventDataChanged, map[string]any{"reason": "feed-removed", "feedId": id})
	return nil
}

// UpdateFeed edits a subscription's title, folder and timeline tab.
func (s *Service) UpdateFeed(id int64, title string, categoryID int64, view string) error {
	if err := s.store.UpdateFeed(id, title, categoryID, view); err != nil {
		return err
	}
	s.emit(EventDataChanged, map[string]any{"reason": "feed-updated", "feedId": id})
	return nil
}

// MoveFeed moves a subscription into a folder (0 = uncategorised).
func (s *Service) MoveFeed(feedID, categoryID int64) error {
	if err := s.store.SetFeedCategory(feedID, categoryID); err != nil {
		return err
	}
	s.emit(EventDataChanged, map[string]any{"reason": "feed-moved", "feedId": feedID})
	return nil
}

// SetFeedView moves a subscription between timeline tabs.
func (s *Service) SetFeedView(feedID int64, view string) error {
	if err := s.store.SetFeedView(feedID, view); err != nil {
		return err
	}
	s.emit(EventDataChanged, map[string]any{"reason": "feed-view", "feedId": feedID})
	return nil
}

// ReorderFeeds persists a manual sidebar ordering.
func (s *Service) ReorderFeeds(ids []int64) error {
	if err := s.store.ReorderFeeds(ids); err != nil {
		return err
	}
	s.emit(EventDataChanged, map[string]any{"reason": "reorder"})
	return nil
}

/* ------------------------------------------------------------ categories */

// CreateCategory creates a folder.
func (s *Service) CreateCategory(name string) (*model.Category, error) {
	c, err := s.store.CreateCategory(name)
	if err == nil {
		s.emit(EventDataChanged, map[string]any{"reason": "category-created"})
	}
	return c, err
}

// RenameCategory renames a folder.
func (s *Service) RenameCategory(id int64, name string) error {
	if err := s.store.RenameCategory(id, name); err != nil {
		return err
	}
	s.emit(EventDataChanged, map[string]any{"reason": "category-renamed"})
	return nil
}

// DeleteCategory removes a folder, leaving its feeds uncategorised.
func (s *Service) DeleteCategory(id int64) error {
	if err := s.store.DeleteCategory(id); err != nil {
		return err
	}
	s.emit(EventDataChanged, map[string]any{"reason": "category-deleted"})
	return nil
}

/* --------------------------------------------------------------- refresh */

// Refresh fetches the given feeds; an empty slice refreshes everything.
func (s *Service) Refresh(feedIDs []int64) (*model.RefreshResult, error) {
	return s.refresh(feedIDs, false)
}

// RefreshAll fetches every subscription.
func (s *Service) RefreshAll() (*model.RefreshResult, error) {
	return s.refresh(nil, false)
}

// refresh performs the actual work. When quiet is set (background timer) no
// progress events are emitted unless something actually changed.
func (s *Service) refresh(feedIDs []int64, quiet bool) (*model.RefreshResult, error) {
	s.refreshMu.Lock()
	if s.refreshing {
		s.refreshMu.Unlock()
		return nil, errors.New("正在刷新中")
	}
	s.refreshing = true
	s.refreshMu.Unlock()
	defer func() {
		s.refreshMu.Lock()
		s.refreshing = false
		s.refreshMu.Unlock()
	}()

	started := time.Now()
	feeds, err := s.store.Feeds()
	if err != nil {
		return nil, err
	}
	if len(feedIDs) > 0 {
		want := make(map[int64]bool, len(feedIDs))
		for _, id := range feedIDs {
			want[id] = true
		}
		filtered := feeds[:0:0]
		for _, f := range feeds {
			if want[f.ID] {
				filtered = append(filtered, f)
			}
		}
		feeds = filtered
	}

	result := &model.RefreshResult{}
	if len(feeds) == 0 {
		result.Duration = time.Since(started).Milliseconds()
		return result, nil
	}

	s.emit(EventRefreshStart, map[string]any{"total": len(feeds)})

	ctx := s.baseCtx()
	const workers = 4
	var (
		mu   sync.Mutex
		wg   sync.WaitGroup
		done int
	)
	sem := make(chan struct{}, workers)

	for _, f := range feeds {
		wg.Add(1)
		go func(f *model.Feed) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}

			newCount, err := s.refreshOne(ctx, f)

			mu.Lock()
			done++
			if err != nil {
				result.Failed++
				result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", f.Title, err))
			} else if newCount > 0 {
				result.Updated++
				result.New += newCount
			}
			progress := model.RefreshProgress{
				Done: done, Total: len(feeds), Current: f.Title, New: result.New,
			}
			mu.Unlock()

			if !quiet {
				s.emit(EventRefreshProgress, progress)
			}
		}(f)
	}
	wg.Wait()

	result.Duration = time.Since(started).Milliseconds()
	s.emit(EventRefreshDone, result)
	if result.New > 0 || result.Failed > 0 {
		s.emit(EventDataChanged, map[string]any{"reason": "refresh"})
	}
	return result, nil
}

// refreshOne fetches a single feed and stores whatever is new.
func (s *Service) refreshOne(ctx context.Context, f *model.Feed) (int, error) {
	etag, lastModified, err := s.store.FeedValidators(f.ID)
	if err != nil {
		etag, lastModified = "", ""
	}

	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()

	res, err := s.fetcher.Fetch(ctx, f.URL, etag, lastModified)
	if err != nil {
		_ = s.store.SetFeedError(f.ID, err.Error())
		s.emit(EventFeedError, map[string]any{"feedId": f.ID, "title": f.Title, "error": err.Error()})
		return 0, err
	}

	// A feed whose icon is missing, or still a remote link, gets it resolved
	// and cached locally on refresh (subject to the retry cooldown).
	if f.IconURL == "" || strings.HasPrefix(f.IconURL, "http") {
		s.fetchAndStoreIcon(ctx, f.ID, f.IconURL,
			firstNonEmpty(f.SiteURL, res.SiteURL), f.URL)
	}

	if res.NotModified {
		_ = s.store.SetFeedValidators(f.ID, res.ETag, res.LastModified)
		return 0, nil
	}

	inserted, err := s.store.SaveEntries(f.ID, res.Items)
	if err != nil {
		_ = s.store.SetFeedError(f.ID, err.Error())
		return 0, err
	}

	// Adopt feed-provided metadata, but never clobber a user-set title with an
	// empty one (UpdateFeedDetails already guards on empty strings).
	if err := s.store.UpdateFeedDetails(f.ID, res.Title, res.SiteURL, res.Description, res.IconURL); err != nil {
		return inserted, err
	}
	if err := s.store.SetFeedValidators(f.ID, res.ETag, res.LastModified); err != nil {
		return inserted, err
	}
	return inserted, nil
}

// startScheduler (re)configures the automatic background refresh.
//
// It is safe to call repeatedly: any previously running ticker is stopped
// first, so changing the interval or toggling auto-refresh takes effect
// without restarting the app.
func (s *Service) startScheduler() {
	s.schedMu.Lock()
	defer s.schedMu.Unlock()

	if s.schedStop != nil {
		s.schedStop()
		s.schedStop = nil
	}

	settings, err := s.store.Settings()
	if err != nil || !settings.AutoRefresh || settings.RefreshIntervalMin <= 0 {
		return
	}
	interval := time.Duration(settings.RefreshIntervalMin) * time.Minute

	ctx, cancel := context.WithCancel(s.baseCtx())
	s.schedStop = cancel

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				// Quiet mode: results are only surfaced when something changed.
				if _, err := s.refresh(nil, true); err != nil {
					continue
				}
			}
		}
	}()
}

/* ------------------------------------------------------------------ OPML */

// ImportOPML reads an OPML file from disk and subscribes to everything in it.
func (s *Service) ImportOPML(path string) (*model.RefreshResult, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, errors.New("无法打开 OPML 文件")
	}
	defer f.Close()

	subs, err := opml.Parse(f)
	if err != nil {
		return nil, err
	}
	return s.importSubscriptions(subs)
}

// ImportOPMLContent imports OPML supplied as text (e.g. pasted by the user).
func (s *Service) ImportOPMLContent(content string) (*model.RefreshResult, error) {
	subs, err := opml.Parse(strings.NewReader(content))
	if err != nil {
		return nil, err
	}
	return s.importSubscriptions(subs)
}

func (s *Service) importSubscriptions(subs []opml.Subscription) (*model.RefreshResult, error) {
	cats, err := s.store.Categories()
	if err != nil {
		return nil, err
	}
	byName := map[string]int64{}
	for _, c := range cats {
		byName[strings.ToLower(c.Name)] = c.ID
	}

	var added []int64
	for _, sub := range subs {
		categoryID := int64(0)
		if sub.Category != "" {
			key := strings.ToLower(sub.Category)
			if id, ok := byName[key]; ok {
				categoryID = id
			} else if created, err := s.store.CreateCategory(sub.Category); err == nil {
				byName[key] = created.ID
				categoryID = created.ID
			}
		}

		f, created, err := s.store.AddFeed(&model.Feed{
			Title:      sub.Title,
			URL:        sub.URL,
			SiteURL:    sub.SiteURL,
			CategoryID: categoryID,
			View:       model.ViewArticles,
		})
		if err != nil || !created {
			continue
		}
		added = append(added, f.ID)
	}

	s.emit(EventDataChanged, map[string]any{"reason": "opml-import", "feeds": len(added)})
	if len(added) == 0 {
		return &model.RefreshResult{}, nil
	}
	// Fetch the new subscriptions so the timeline fills immediately.
	return s.refresh(added, true)
}

// ExportOPML writes the current subscriptions to an OPML file.
func (s *Service) ExportOPML(path string) (int, error) {
	content, err := s.ExportOPMLContent()
	if err != nil {
		return 0, err
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return 0, errors.New("无法写入 OPML 文件")
	}
	feeds, _ := s.store.Feeds()
	return len(feeds), nil
}

// ExportOPMLContent renders the current subscriptions as OPML text.
func (s *Service) ExportOPMLContent() (string, error) {
	cats, err := s.store.Categories()
	if err != nil {
		return "", err
	}
	feeds, err := s.store.Feeds()
	if err != nil {
		return "", err
	}
	b, err := opml.Build("ReadS Subscriptions", cats, feeds)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

/* --------------------------------------------------------------- utility */

// FeedURLs returns the feed URLs of the current subscriptions, used by the UI
// to seed sample data or diagnostics.
func (s *Service) FeedURLs() ([]string, error) {
	feeds, err := s.store.Feeds()
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(feeds))
	for _, f := range feeds {
		out = append(out, f.URL)
	}
	sort.Strings(out)
	return out, nil
}

// DataDir reports where the database lives, for the About panel.
func (s *Service) DataDir() string { return s.dataDir }

// ReportViewport records the frontend's layout viewport.
//
// A WebView's CSS viewport can differ from the window's physical size when DPI
// scaling is involved, and that difference decides which responsive breakpoint
// applies. Logging it makes layout bugs diagnosable from the log file, since a
// packaged WebView has no accessible developer console.
func (s *Service) ReportViewport(width, height int, devicePixelRatio float64) error {
	s.log.Debug("frontend viewport",
		"cssWidth", width,
		"cssHeight", height,
		"devicePixelRatio", devicePixelRatio,
		"compact", width < 1024)
	return nil
}

// DBPath is the full path of the SQLite database.
func (s *Service) DBPath() string { return filepath.Join(s.dataDir, "reads.db") }

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
