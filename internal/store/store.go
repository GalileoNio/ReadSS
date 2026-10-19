// Package store is the SQLite persistence layer for ReadS.
//
// It uses modernc.org/sqlite (a pure-Go SQLite) so the app builds without cgo
// and without a C toolchain on any platform.
package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"reads/internal/model"

	_ "modernc.org/sqlite"
)

// Store owns the database handle.
type Store struct {
	db *sql.DB
}

// schema is applied on every open; all statements are idempotent.
const schema = `
CREATE TABLE IF NOT EXISTS categories (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	name        TEXT    NOT NULL UNIQUE,
	sort_order  INTEGER NOT NULL DEFAULT 0,
	created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS feeds (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	title         TEXT    NOT NULL DEFAULT '',
	url           TEXT    NOT NULL UNIQUE,
	site_url      TEXT    NOT NULL DEFAULT '',
	description   TEXT    NOT NULL DEFAULT '',
	icon_url      TEXT    NOT NULL DEFAULT '',
	color         TEXT    NOT NULL DEFAULT '',
	category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
	view          TEXT    NOT NULL DEFAULT 'articles',
	sort_order    INTEGER NOT NULL DEFAULT 0,
	last_fetched  INTEGER NOT NULL DEFAULT 0,
	last_success  INTEGER NOT NULL DEFAULT 0,
	etag          TEXT    NOT NULL DEFAULT '',
	last_modified TEXT    NOT NULL DEFAULT '',
	error         TEXT    NOT NULL DEFAULT '',
	icon_at       INTEGER NOT NULL DEFAULT 0,
	created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feeds_category ON feeds(category_id);

CREATE TABLE IF NOT EXISTS entries (
	id              INTEGER PRIMARY KEY AUTOINCREMENT,
	feed_id         INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
	guid            TEXT    NOT NULL,
	title           TEXT    NOT NULL DEFAULT '',
	url             TEXT    NOT NULL DEFAULT '',
	author          TEXT    NOT NULL DEFAULT '',
	summary         TEXT    NOT NULL DEFAULT '',
	content         TEXT    NOT NULL DEFAULT '',
	full_content    TEXT    NOT NULL DEFAULT '',
	full_content_at INTEGER NOT NULL DEFAULT 0,
	comments        TEXT    NOT NULL DEFAULT '',
	comments_count  INTEGER NOT NULL DEFAULT 0,
	comments_at     INTEGER NOT NULL DEFAULT 0,
	image_url       TEXT    NOT NULL DEFAULT '',
	published_at    INTEGER NOT NULL DEFAULT 0,
	fetched_at      INTEGER NOT NULL DEFAULT 0,
	read            INTEGER NOT NULL DEFAULT 0,
	starred         INTEGER NOT NULL DEFAULT 0,
	read_later      INTEGER NOT NULL DEFAULT 0,
	UNIQUE(feed_id, guid)
);
CREATE INDEX IF NOT EXISTS idx_entries_feed_pub  ON entries(feed_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_published ON entries(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_unread    ON entries(read, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_starred   ON entries(starred, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_later     ON entries(read_later, published_at DESC);

CREATE TABLE IF NOT EXISTS meta (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

-- Discovered, working ways to read one host's comments. Filled in lazily the
-- first time a site's comments turn out not to be in its HTML, so discovery
-- (which reads the page's scripts) runs once per host rather than per article.
CREATE TABLE IF NOT EXISTS comment_recipes (
	host        TEXT PRIMARY KEY,
	endpoint    TEXT NOT NULL,
	id_param    TEXT NOT NULL,
	page_param  TEXT NOT NULL DEFAULT '',
	limit_param TEXT NOT NULL DEFAULT '',
	data_path   TEXT NOT NULL DEFAULT '',
	asset_base  TEXT NOT NULL DEFAULT '',
	verified_at INTEGER NOT NULL DEFAULT 0
);
`

// Open opens (creating if needed) the database at path and applies the schema.
func Open(path string) (*Store, error) {
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create data directory: %w", err)
		}
	}

	// modernc.org/sqlite accepts pragmas as query parameters.
	dsn := "file:" + filepath.ToSlash(path) +
		"?_pragma=busy_timeout(10000)" +
		"&_pragma=journal_mode(WAL)" +
		"&_pragma=foreign_keys(1)" +
		"&_pragma=synchronous(NORMAL)"

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	// A desktop reader has a tiny write volume; serialising access removes any
	// chance of SQLITE_BUSY between the refresher and UI-triggered writes.
	db.SetMaxOpenConns(1)
	db.SetConnMaxLifetime(0)

	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate database: %w", err)
	}
	return s, nil
}

// migrate adds columns introduced after a database was first created.
// CREATE TABLE IF NOT EXISTS does not alter existing tables, so an app update
// must patch older databases in place rather than dropping the user's data.
func (s *Store) migrate() error {
	additions := []struct{ table, column, definition string }{
		{"entries", "full_content", "TEXT NOT NULL DEFAULT ''"},
		{"entries", "full_content_at", "INTEGER NOT NULL DEFAULT 0"},
		{"entries", "comments", "TEXT NOT NULL DEFAULT ''"},
		{"entries", "comments_count", "INTEGER NOT NULL DEFAULT 0"},
		{"entries", "comments_at", "INTEGER NOT NULL DEFAULT 0"},
		{"feeds", "icon_at", "INTEGER NOT NULL DEFAULT 0"},
		{"feeds", "color", "TEXT NOT NULL DEFAULT ''"},
		{"comment_recipes", "asset_base", "TEXT NOT NULL DEFAULT ''"},
	}

	for _, a := range additions {
		exists, err := s.columnExists(a.table, a.column)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		if _, err := s.db.Exec(fmt.Sprintf(
			"ALTER TABLE %s ADD COLUMN %s %s", a.table, a.column, a.definition)); err != nil {
			return fmt.Errorf("add %s.%s: %w", a.table, a.column, err)
		}
	}

	// Earlier builds stored a link to a third-party favicon service, which may
	// be unreachable and leaks subscriptions to that service. Clear those so
	// the real site icons get fetched and cached locally instead.
	if _, err := s.db.Exec(
		`UPDATE feeds SET icon_url = '', icon_at = 0
		 WHERE icon_url LIKE '%google.com/s2/favicons%'`); err != nil {
		return fmt.Errorf("clear third-party favicon links: %w", err)
	}

	// Cached threads that still point at remote images predate avatar inlining.
	// Those images are frequently hotlink-protected, so they render broken; the
	// cache is dropped and refilled with inlined data URIs on next open.
	//
	// The test is done in Go rather than SQL because a relative source (one
	// real case requested `/2025/01/02/avatar/…` from the app's own asset
	// server) does not look like a remote image to a LIKE pattern, yet is
	// exactly as broken.
	if err := s.dropUninlinedCommentCaches(); err != nil {
		return err
	}

	return nil
}

// dropUninlinedCommentCaches clears cached threads produced by an older comment
// pipeline, leaving already-correct threads (which cost a request to refetch)
// alone.
func (s *Store) dropUninlinedCommentCaches() error {
	rows, err := s.db.Query(`SELECT id, comments FROM entries WHERE comments <> ''`)
	if err != nil {
		return err
	}
	var staleIDs []int64
	for rows.Next() {
		var id int64
		var html string
		if err := rows.Scan(&id, &html); err != nil {
			rows.Close()
			return err
		}
		if needsCommentRefresh(html) {
			staleIDs = append(staleIDs, id)
		}
	}
	err = rows.Err()
	// Close before writing: the pool holds a single connection.
	rows.Close()
	if err != nil {
		return err
	}
	for _, id := range staleIDs {
		if _, err := s.db.Exec(
			`UPDATE entries SET comments = '', comments_count = 0, comments_at = 0 WHERE id = ?`,
			id); err != nil {
			return fmt.Errorf("invalidate comment cache for entry %d: %w", id, err)
		}
	}
	return nil
}

// srcAttrRe matches the value of a src attribute in a stored fragment.
var srcAttrRe = regexp.MustCompile(`src\s*=\s*"([^"]*)"`)

// needsCommentRefresh reports whether a cached thread was produced by an older
// comment pipeline and would render wrong today:
//
//   - an image that is not inlined (hotlink-protected sources render broken,
//     and a relative path gets requested from the app's own origin);
//   - an avatar fallback without the app's gradient. The current sanitiser also
//     passes the label through as data-initial; older builds dropped it, so
//     such a bubble would show as an empty circle. DESIGN.md §1.5;
//   - an avatar nested inside the author paragraph. The avatar is now a direct
//     child of the comment so the grid can give it its own column; with the old
//     nesting the avatar sits inside the author flex row, and the author line
//     never lines up with the body text below it.
//
// NeedsCommentRefresh reports whether a stored comment fragment is stale, and is
// exported so the self-test can assert each staleness rule.
func (s *Store) NeedsCommentRefresh(fragment string) bool {
	return needsCommentRefresh(fragment)
}

func needsCommentRefresh(fragment string) bool {
	if fragment == "" {
		return false
	}
	for _, m := range srcAttrRe.FindAllStringSubmatch(fragment, -1) {
		if !strings.HasPrefix(strings.TrimSpace(m[1]), "data:") {
			return true
		}
	}
	if strings.Contains(fragment, "avatar--text") && !strings.Contains(fragment, "linear-gradient") {
		return true
	}
	if strings.Contains(fragment, `<p class="comment-author"><img class="avatar"`) ||
		strings.Contains(fragment, `<p class="comment-author"><span class="avatar"`) {
		return true
	}
	return false
}

func (s *Store) columnExists(table, column string) (bool, error) {
	rows, err := s.db.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid         int
			name, ctype string
			notNull     int
			dflt        sql.NullString
			pk          int
		)
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dflt, &pk); err != nil {
			return false, err
		}
		if strings.EqualFold(name, column) {
			return true, nil
		}
	}
	return false, rows.Err()
}

// Close releases the database handle.
func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func nowMS() int64 { return time.Now().UnixMilli() }

/* -------------------------------------------------------- comment recipes */

// GetCommentRecipe returns the cached comment-API recipe for a host, or nil.
func (s *Store) GetCommentRecipe(host string) (*model.CommentRecipe, error) {
	r := &model.CommentRecipe{}
	err := s.db.QueryRow(`
		SELECT host, endpoint, id_param, page_param, limit_param, data_path, asset_base, verified_at
		FROM comment_recipes WHERE host = ?`, host).
		Scan(&r.Host, &r.Endpoint, &r.IDParam, &r.PageParam, &r.LimitParam, &r.DataPath, &r.AssetBase, &r.VerifiedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return r, nil
}

// PutCommentRecipe stores (or refreshes) a host's comment-API recipe.
func (s *Store) PutCommentRecipe(r *model.CommentRecipe) error {
	if r == nil || r.Host == "" || r.Endpoint == "" {
		return nil
	}
	_, err := s.db.Exec(`
		INSERT INTO comment_recipes(host, endpoint, id_param, page_param, limit_param, data_path, asset_base, verified_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(host) DO UPDATE SET
			endpoint    = excluded.endpoint,
			id_param    = excluded.id_param,
			page_param  = excluded.page_param,
			limit_param = excluded.limit_param,
			data_path   = excluded.data_path,
			asset_base  = CASE WHEN excluded.asset_base <> '' THEN excluded.asset_base ELSE comment_recipes.asset_base END,
			verified_at = excluded.verified_at`,
		r.Host, r.Endpoint, r.IDParam, r.PageParam, r.LimitParam, r.DataPath, r.AssetBase, r.VerifiedAt)
	return err
}

// DeleteCommentRecipe forgets a host's recipe, forcing rediscovery.
func (s *Store) DeleteCommentRecipe(host string) error {
	_, err := s.db.Exec(`DELETE FROM comment_recipes WHERE host = ?`, host)
	return err
}

/* ------------------------------------------------------------------ meta */

func (s *Store) getMeta(key string) (string, bool) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM meta WHERE key = ?`, key).Scan(&v)
	if err != nil {
		return "", false
	}
	return v, true
}

// EnsureBuildVersion records the running build's version and reports whether it
// differs from the previously recorded one.
//
// The caller uses this to drop cached WebView assets after an update: the
// embedded index.html references hashed bundles, so a cached copy of the old
// page would silently keep the app running the previous build.
func (s *Store) EnsureBuildVersion(version string) (bool, error) {
	previous, _ := s.getMeta("build_version")
	if previous == version {
		return false, nil
	}
	if err := s.setMeta("build_version", version); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Store) setMeta(key, value string) error {
	_, err := s.db.Exec(
		`INSERT INTO meta(key, value) VALUES(?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

// Settings loads persisted settings, layering them over the defaults so that a
// settings file written by an older build still gains newly added fields.
func (s *Store) Settings() (model.Settings, error) {
	out := model.DefaultSettings()
	raw, ok := s.getMeta("settings")
	if !ok || raw == "" {
		return out, nil
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return model.DefaultSettings(), nil
	}
	// Fields added by a later build arrive empty from an older settings record;
	// fall back to the default instead of leaving an invalid value.
	if out.EntryLayout != "list" && out.EntryLayout != "masonry" {
		out.EntryLayout = "list"
	}
	return out, nil
}

// SaveSettings persists the given settings.
func (s *Store) SaveSettings(v model.Settings) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return s.setMeta("settings", string(b))
}

// RecommendationData returns what the recommender learns from (entries the
// reader starred or read) and the unread entries it may suggest.
//
// Both lists are capped: the model is a bag of terms, so a few hundred of the
// most recent entries is plenty and keeps a refresh cheap. Either limit may be
// zero to skip that half.
func (s *Store) RecommendationData(seedLimit, candidateLimit int) ([]*model.Entry, []*model.Entry, error) {
	readEntries := func(query string, args ...any) ([]*model.Entry, error) {
		rows, err := s.db.Query(query, args...)
		if err != nil {
			return nil, err
		}
		// Rows must be closed before the next query: the pool is a single
		// connection, so an open cursor would deadlock the caller.
		defer rows.Close()
		out := []*model.Entry{}
		for rows.Next() {
			e := &model.Entry{}
			if err := rows.Scan(&e.ID, &e.Title, &e.Summary, &e.Author, &e.URL); err != nil {
				return nil, err
			}
			out = append(out, e)
		}
		return out, rows.Err()
	}

	seeds := []*model.Entry{}
	if seedLimit > 0 {
		var err error
		seeds, err = readEntries(`
			SELECT id, title, summary, author, url FROM entries
			WHERE starred = 1 OR read = 1
			ORDER BY published_at DESC LIMIT ?`, seedLimit)
		if err != nil {
			return nil, nil, err
		}
	}

	candidates := []*model.Entry{}
	if candidateLimit > 0 {
		var err error
		candidates, err = readEntries(`
			SELECT id, title, summary, author, url FROM entries
			WHERE read = 0
			ORDER BY published_at DESC LIMIT ?`, candidateLimit)
		if err != nil {
			return nil, nil, err
		}
	}

	return seeds, candidates, nil
}

/* ------------------------------------------------------------ categories */

// Categories lists folders with their unread totals.
func (s *Store) Categories() ([]*model.Category, error) {
	rows, err := s.db.Query(`
		SELECT c.id, c.name, c.sort_order,
		       COALESCE(SUM(CASE WHEN e.read = 0 THEN 1 ELSE 0 END), 0) AS unread,
		       COUNT(DISTINCT f.id) AS feed_count
		FROM categories c
		LEFT JOIN feeds  f ON f.category_id = c.id
		LEFT JOIN entries e ON e.feed_id = f.id
		GROUP BY c.id, c.name, c.sort_order
		ORDER BY c.sort_order, c.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []*model.Category{}
	for rows.Next() {
		c := &model.Category{}
		if err := rows.Scan(&c.ID, &c.Name, &c.SortOrder, &c.Unread, &c.FeedCount); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CreateCategory inserts a folder and returns it.
func (s *Store) CreateCategory(name string) (*model.Category, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("分组名称不能为空")
	}
	var maxOrder sql.NullInt64
	_ = s.db.QueryRow(`SELECT MAX(sort_order) FROM categories`).Scan(&maxOrder)
	order := int(maxOrder.Int64) + 1

	res, err := s.db.Exec(
		`INSERT INTO categories(name, sort_order, created_at) VALUES(?, ?, ?)`,
		name, order, nowMS())
	if err != nil {
		return nil, fmt.Errorf("create category: %w", err)
	}
	id, _ := res.LastInsertId()
	return &model.Category{ID: id, Name: name, SortOrder: order}, nil
}

// RenameCategory changes a folder's display name.
func (s *Store) RenameCategory(id int64, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("分组名称不能为空")
	}
	_, err := s.db.Exec(`UPDATE categories SET name = ? WHERE id = ?`, name, id)
	return err
}

// DeleteCategory removes a folder; its feeds fall back to uncategorised.
func (s *Store) DeleteCategory(id int64) error {
	_, err := s.db.Exec(`DELETE FROM categories WHERE id = ?`, id)
	return err
}

/* ----------------------------------------------------------------- feeds */

const feedCols = `f.id, f.title, f.url, f.site_url, f.description, f.icon_url, f.color,
	COALESCE(f.category_id, 0), f.view, f.sort_order, f.last_fetched, f.error,
	COALESCE((SELECT COUNT(*) FROM entries e WHERE e.feed_id = f.id AND e.read = 0), 0)`

func scanFeed(rows interface{ Scan(...any) error }) (*model.Feed, error) {
	f := &model.Feed{}
	err := rows.Scan(&f.ID, &f.Title, &f.URL, &f.SiteURL, &f.Description, &f.IconURL, &f.Color,
		&f.CategoryID, &f.View, &f.SortOrder, &f.LastFetched, &f.Error, &f.Unread)
	if err != nil {
		return nil, err
	}
	return f, nil
}

// Feeds lists every subscription ordered for the sidebar.
func (s *Store) Feeds() ([]*model.Feed, error) {
	rows, err := s.db.Query(`SELECT ` + feedCols + ` FROM feeds f
		ORDER BY f.sort_order, LOWER(f.title)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []*model.Feed{}
	for rows.Next() {
		f, err := scanFeed(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// FeedByID loads a single subscription.
func (s *Store) FeedByID(id int64) (*model.Feed, error) {
	return scanFeed(s.db.QueryRow(`SELECT `+feedCols+` FROM feeds f WHERE f.id = ?`, id))
}

// FeedByURL loads a subscription by its canonical feed URL.
func (s *Store) FeedByURL(u string) (*model.Feed, error) {
	return scanFeed(s.db.QueryRow(`SELECT `+feedCols+` FROM feeds f WHERE f.url = ?`, u))
}

// AddFeed inserts a subscription, returning the existing row if the URL is
// already subscribed (so re-adding a feed is a no-op rather than an error).
func (s *Store) AddFeed(f *model.Feed) (*model.Feed, bool, error) {
	if existing, err := s.findFeedByURL(f.URL); err == nil && existing != nil {
		return existing, false, nil
	}

	var maxOrder sql.NullInt64
	_ = s.db.QueryRow(`SELECT MAX(sort_order) FROM feeds`).Scan(&maxOrder)

	var cat any
	if f.CategoryID > 0 {
		cat = f.CategoryID
	}
	view := f.View
	if view == "" {
		view = model.ViewArticles
	}

	res, err := s.db.Exec(`
		INSERT INTO feeds(title, url, site_url, description, icon_url, category_id,
		                  view, sort_order, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		f.Title, f.URL, f.SiteURL, f.Description, f.IconURL, cat,
		view, int(maxOrder.Int64)+1, nowMS())
	if err != nil {
		return nil, false, fmt.Errorf("add feed: %w", err)
	}
	id, _ := res.LastInsertId()
	f.ID = id
	return f, true, nil
}

// findFeedByURL looks up a subscription by feed URL, treating URLs that differ
// only in trailing slash, host case or fragment as the same feed.
//
// Without this, subscribing to `https://example.com/rss` and
// `https://example.com/rss/` silently created two copies of one feed.
func (s *Store) findFeedByURL(rawURL string) (*model.Feed, error) {
	if f, err := s.FeedByURL(rawURL); err == nil && f != nil {
		return f, nil
	}

	want := normalizeFeedURL(rawURL)
	if want == "" {
		return nil, nil
	}

	rows, err := s.db.Query(`SELECT id, url FROM feeds`)
	if err != nil {
		return nil, err
	}

	var matchID int64
	for rows.Next() {
		var id int64
		var stored string
		if err := rows.Scan(&id, &stored); err != nil {
			rows.Close()
			return nil, err
		}
		if normalizeFeedURL(stored) == want {
			matchID = id
			break
		}
	}
	err = rows.Err()
	// Close before the next query: the pool is limited to a single connection,
	// so reading another row while this cursor is open would block forever.
	rows.Close()
	if err != nil {
		return nil, err
	}

	if matchID == 0 {
		return nil, nil
	}
	return s.FeedByID(matchID)
}

// normalizeFeedURL produces a comparison key for feed URLs.
func normalizeFeedURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)
	u.Fragment = ""
	if len(u.Path) > 1 {
		u.Path = strings.TrimRight(u.Path, "/")
	}
	return u.String()
}

// UpdateFeedDetails refreshes the descriptive fields of a subscription.
func (s *Store) UpdateFeedDetails(id int64, title, siteURL, description, iconURL string) error {
	_, err := s.db.Exec(`
		UPDATE feeds
		SET title       = CASE WHEN ? <> '' THEN ? ELSE title END,
		    site_url    = CASE WHEN ? <> '' THEN ? ELSE site_url END,
		    description = CASE WHEN ? <> '' THEN ? ELSE description END,
		    icon_url    = CASE WHEN ? <> '' THEN ? ELSE icon_url END
		WHERE id = ?`,
		title, title, siteURL, siteURL, description, description, iconURL, iconURL, id)
	return err
}

// UpdateFeed syncs the user-editable fields of a subscription.
func (s *Store) UpdateFeed(id int64, title string, categoryID int64, view string) error {
	var cat any
	if categoryID > 0 {
		cat = categoryID
	}
	_, err := s.db.Exec(`
		UPDATE feeds
		SET title = CASE WHEN ? <> '' THEN ? ELSE title END,
		    category_id = ?,
		    view = CASE WHEN ? <> '' THEN ? ELSE view END
		WHERE id = ?`, title, title, cat, view, view, id)
	return err
}

// SetFeedCategory moves a subscription into (or out of) a folder.
func (s *Store) SetFeedCategory(feedID, categoryID int64) error {
	var cat any
	if categoryID > 0 {
		cat = categoryID
	}
	_, err := s.db.Exec(`UPDATE feeds SET category_id = ? WHERE id = ?`, cat, feedID)
	return err
}

// SetFeedView moves a subscription between timeline tabs.
func (s *Store) SetFeedView(feedID int64, view string) error {
	_, err := s.db.Exec(`UPDATE feeds SET view = ? WHERE id = ?`, view, feedID)
	return err
}

// SetFeedError records the outcome of the most recent fetch attempt.
func (s *Store) SetFeedError(id int64, msg string) error {
	_, err := s.db.Exec(`UPDATE feeds SET error = ?, last_fetched = ? WHERE id = ?`,
		msg, nowMS(), id)
	return err
}

// SetFeedValidators stores the HTTP cache validators captured during a fetch.
func (s *Store) SetFeedValidators(id int64, etag, lastModified string) error {
	_, err := s.db.Exec(`
		UPDATE feeds
		SET etag = ?, last_modified = ?, last_fetched = ?, last_success = ?, error = ''
		WHERE id = ?`, etag, lastModified, nowMS(), nowMS(), id)
	return err
}

// FeedValidators returns the cached ETag / Last-Modified pair for a feed.
func (s *Store) FeedValidators(id int64) (etag, lastModified string, err error) {
	err = s.db.QueryRow(`SELECT etag, last_modified FROM feeds WHERE id = ?`, id).
		Scan(&etag, &lastModified)
	return
}

// DeleteFeed unsubscribes and cascades to its entries.
func (s *Store) DeleteFeed(id int64) error {
	_, err := s.db.Exec(`DELETE FROM feeds WHERE id = ?`, id)
	return err
}

// ReorderFeeds rewrites sort_order to match the given ID order.
func (s *Store) ReorderFeeds(ids []int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for i, id := range ids {
		if _, err := tx.Exec(`UPDATE feeds SET sort_order = ? WHERE id = ?`, i, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

/* --------------------------------------------------------------- entries */

// upsertEntry inserts an entry or refreshes its content if already present.
// User state (read / starred / readLater) is never touched by an update, so
// re-fetching a feed can never mark items unread again.
func (s *Store) upsertEntry(tx *sql.Tx, feedID int64, guid, title, link, author, summary, content, imageURL string, publishedAt int64) (bool, error) {
	res, err := tx.Exec(`
		INSERT OR IGNORE INTO entries
			(feed_id, guid, title, url, author, summary, content, image_url,
			 published_at, fetched_at, read, starred, read_later)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
		feedID, guid, title, link, author, summary, content, imageURL, publishedAt, nowMS())
	if err != nil {
		return false, err
	}
	if n, err := res.RowsAffected(); err == nil && n > 0 {
		return true, nil
	}

	// Already known: refresh only the feed-supplied content.
	_, err = tx.Exec(`
		UPDATE entries
		SET title        = ?,
		    url          = CASE WHEN ? <> '' THEN ? ELSE url END,
		    author       = CASE WHEN ? <> '' THEN ? ELSE author END,
		    summary      = CASE WHEN ? <> '' THEN ? ELSE summary END,
		    content      = CASE WHEN ? <> '' THEN ? ELSE content END,
		    image_url    = CASE WHEN ? <> '' THEN ? ELSE image_url END,
		    published_at = CASE WHEN ? > 0 THEN ? ELSE published_at END
		WHERE feed_id = ? AND guid = ?`,
		title, link, link, author, author, summary, summary,
		content, content, imageURL, imageURL, publishedAt, publishedAt, feedID, guid)
	return false, err
}

// SaveEntries writes a batch of feed items inside one transaction.
func (s *Store) SaveEntries(feedID int64, items []FeedItem) (int, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	inserted := 0
	for _, it := range items {
		isNew, err := s.upsertEntry(tx, feedID, it.GUID, it.Title, it.URL, it.Author,
			it.Summary, it.Content, it.ImageURL, it.PublishedAt)
		if err != nil {
			return inserted, err
		}
		if isNew {
			inserted++
		}
	}
	if err := tx.Commit(); err != nil {
		return inserted, err
	}
	return inserted, nil
}

// FeedItem is the storage-layer view of a parsed feed item.
type FeedItem struct {
	GUID        string
	Title       string
	URL         string
	Author      string
	Summary     string
	Content     string
	ImageURL    string
	PublishedAt int64
}

func buildFilters(q model.ListQuery) (where []string, args []any) {
	switch q.Scope {
	case model.ScopeFeed:
		where = append(where, "e.feed_id = ?")
		args = append(args, q.FeedID)
	case model.ScopeCategory:
		where = append(where, "e.feed_id IN (SELECT id FROM feeds WHERE category_id = ?)")
		args = append(args, q.CategoryID)
	case model.ScopeStarred:
		where = append(where, "e.starred = 1")
	case model.ScopeReadLater:
		where = append(where, "e.read_later = 1")
	case model.ScopeUnread:
		where = append(where, "e.read = 0")
	case model.ScopeToday:
		start := time.Now().Truncate(24 * time.Hour)
		where = append(where, "e.published_at >= ?")
		args = append(args, start.UnixMilli())
	}

	if q.View != "" && q.View != "all" {
		where = append(where, "f.view = ?")
		args = append(args, q.View)
	}
	if q.UnreadOnly {
		where = append(where, "e.read = 0")
	}
	if q.StarredOnly {
		where = append(where, "e.starred = 1")
	}
	if s := strings.TrimSpace(q.Search); s != "" {
		where = append(where, "(e.title LIKE ? OR e.summary LIKE ? OR e.content LIKE ? OR f.title LIKE ?)")
		like := "%" + s + "%"
		args = append(args, like, like, like, like)
	}
	return where, args
}

// QueryEntries returns one page of the timeline plus the total match count.
func (s *Store) QueryEntries(q model.ListQuery) (*model.EntryPage, error) {
	if q.Limit <= 0 || q.Limit > 500 {
		q.Limit = 100
	}
	where, args := buildFilters(q)

	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}

	var total int
	if err := s.db.QueryRow(
		`SELECT COUNT(*) FROM entries e JOIN feeds f ON f.id = e.feed_id`+clause,
		args...).Scan(&total); err != nil {
		return nil, err
	}

	dir := "DESC"
	if q.SortAsc {
		dir = "ASC"
	}
	pageArgs := append(append([]any{}, args...), q.Limit, q.Offset)

	rows, err := s.db.Query(`
		SELECT e.id, e.feed_id, f.title, f.icon_url, f.view, e.title, e.url, e.author,
		       e.summary, e.image_url, e.published_at, e.read, e.starred, e.read_later,
		       (e.content <> '') AS has_content
		FROM entries e
		JOIN feeds f ON f.id = e.feed_id`+clause+`
		ORDER BY e.published_at `+dir+`, e.id `+dir+`
		LIMIT ? OFFSET ?`, pageArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	page := &model.EntryPage{Entries: []*model.Entry{}, Total: total}
	for rows.Next() {
		e := &model.Entry{}
		if err := rows.Scan(&e.ID, &e.FeedID, &e.FeedTitle, &e.FeedIcon, &e.FeedView,
			&e.Title, &e.URL, &e.Author, &e.Summary, &e.ImageURL, &e.PublishedAt,
			&e.Read, &e.Starred, &e.ReadLater, &e.HasContent); err != nil {
			return nil, err
		}
		page.Entries = append(page.Entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	page.HasMore = q.Offset+len(page.Entries) < total
	return page, nil
}

// EntryDetail loads a single entry with its article body.
//
// full_content (from a readability pass) takes precedence over the
// feed-supplied content when it has been fetched, and the original is still
// returned so the reader can toggle between them.
func (s *Store) EntryDetail(id int64) (*model.EntryDetail, error) {
	d := &model.EntryDetail{}
	var feedContent, fullContent string

	err := s.db.QueryRow(`
		SELECT e.id, e.feed_id, f.title, f.icon_url, f.view, e.title, e.url, e.author,
		       e.summary, e.image_url, e.published_at, e.read, e.starred, e.read_later,
		       (e.content <> '' OR e.full_content <> ''), e.content, e.full_content,
		       e.comments, e.comments_count, COALESCE(f.site_url, '')
		FROM entries e
		JOIN feeds f ON f.id = e.feed_id
		WHERE e.id = ?`, id).
		Scan(&d.ID, &d.FeedID, &d.FeedTitle, &d.FeedIcon, &d.FeedView, &d.Title,
			&d.URL, &d.Author, &d.Summary, &d.ImageURL, &d.PublishedAt, &d.Read,
			&d.Starred, &d.ReadLater, &d.HasContent, &feedContent, &fullContent,
			&d.Comments, &d.CommentsCount, &d.SiteURL)
	if err != nil {
		return nil, err
	}

	d.FeedContent = feedContent
	d.FullContent = fullContent
	d.HasFullContent = fullContent != ""
	if d.HasFullContent {
		d.Content = fullContent
		d.ContentSource = "readability"
	} else {
		d.Content = feedContent
		d.ContentSource = "feed"
	}
	d.ReadingMinutes = EstimateReadingMinutes(d.Content, d.Summary)
	return d, nil
}

// EntryIDs returns the IDs of every entry matching a timeline query, used to
// implement "mark all as read" over the current selection.
func (s *Store) EntryIDs(q model.ListQuery) ([]int64, error) {
	where, args := buildFilters(q)
	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}
	rows, err := s.db.Query(
		`SELECT e.id FROM entries e JOIN feeds f ON f.id = e.feed_id`+clause, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// SetRead updates the read flag for the given entry IDs.
func (s *Store) SetRead(ids []int64, read bool) error {
	if len(ids) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`UPDATE entries SET read = ? WHERE id = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, id := range ids {
		if _, err := stmt.Exec(read, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// SetContent replaces the feed-supplied article body.
func (s *Store) SetContent(id int64, content string) error {
	_, err := s.db.Exec(`UPDATE entries SET content = ? WHERE id = ?`, content, id)
	return err
}

// SetFullContent stores a readability-extracted article body, keeping the
// feed-supplied version untouched so the reader can switch back to it.
func (s *Store) SetFullContent(id int64, content string) error {
	_, err := s.db.Exec(
		`UPDATE entries SET full_content = ?, full_content_at = ? WHERE id = ?`,
		content, nowMS(), id)
	return err
}

// ClearFullContent drops the extracted body, reverting to the feed's version.
func (s *Store) ClearFullContent(id int64) error {
	_, err := s.db.Exec(
		`UPDATE entries SET full_content = '', full_content_at = 0 WHERE id = ?`, id)
	return err
}

// SetComments stores the extracted comment thread for an entry.
func (s *Store) SetComments(id int64, html string, count int) error {
	_, err := s.db.Exec(
		`UPDATE entries SET comments = ?, comments_count = ?, comments_at = ? WHERE id = ?`,
		html, count, nowMS(), id)
	return err
}

// SetFeedIcon caches a feed's icon, normally as a data URI so it renders
// without any third-party favicon service.
func (s *Store) SetFeedIcon(id int64, icon string) error {
	_, err := s.db.Exec(
		`UPDATE feeds SET icon_url = ?, icon_at = ? WHERE id = ?`, icon, nowMS(), id)
	return err
}

// TouchFeedIcon records an icon-fetch attempt that produced nothing, so the
// app does not retry a hopeless host on every launch.
func (s *Store) TouchFeedIcon(id int64) error {
	_, err := s.db.Exec(`UPDATE feeds SET icon_at = ? WHERE id = ?`, nowMS(), id)
	return err
}

// SetFeedColor records the icon's dominant colour, the feed's theme tint. An
// empty colour clears it; the frontend then falls back to a hash hue.
func (s *Store) SetFeedColor(id int64, color string) error {
	_, err := s.db.Exec(`UPDATE feeds SET color = ? WHERE id = ?`, color, id)
	return err
}

// FeedsNeedingIcons returns feeds whose icon is missing or still a remote
// link, and which have not been tried within the cooldown window. Remote links
// count as missing because the app caches icons locally.
func (s *Store) FeedsNeedingIcons(cooldownMS int64, limit int) ([]*model.Feed, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.db.Query(`
		SELECT `+feedCols+`
		FROM feeds f
		WHERE (f.icon_url = '' OR f.icon_url LIKE 'http%') AND f.icon_at < ?
		ORDER BY f.sort_order
		LIMIT ?`, nowMS()-cooldownMS, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []*model.Feed{}
	for rows.Next() {
		f, err := scanFeed(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// ToggleStar flips the starred flag and reports the new value.
func (s *Store) ToggleStar(id int64) (bool, error) {
	return s.toggle(id, "starred")
}

// ToggleReadLater flips the "read later" flag and reports the new value.
func (s *Store) ToggleReadLater(id int64) (bool, error) {
	return s.toggle(id, "read_later")
}

func (s *Store) toggle(id int64, column string) (bool, error) {
	// column is never user-supplied; it comes from the two wrappers above.
	if _, err := s.db.Exec(
		`UPDATE entries SET `+column+` = 1 - `+column+` WHERE id = ?`, id); err != nil {
		return false, err
	}
	var v bool
	err := s.db.QueryRow(`SELECT `+column+` FROM entries WHERE id = ?`, id).Scan(&v)
	return v, err
}

// Counts returns the sidebar's smart-list totals.
func (s *Store) Counts() (model.Counts, error) {
	c := model.Counts{}
	startOfDay := time.Now().Truncate(24 * time.Hour).UnixMilli()

	err := s.db.QueryRow(`
		SELECT COUNT(*),
		       COALESCE(SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN starred = 1 THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN read_later = 1 THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN published_at >= ? THEN 1 ELSE 0 END), 0)
		FROM entries`, startOfDay).
		Scan(&c.All, &c.Unread, &c.Starred, &c.ReadLater, &c.Today)
	return c, err
}

// DeleteAllEntries empties the timeline without removing subscriptions.
func (s *Store) DeleteAllEntries() error {
	_, err := s.db.Exec(`DELETE FROM entries`)
	return err
}

// EstimateReadingMinutes approximates reading time from text length.
func EstimateReadingMinutes(parts ...string) int {
	total := 0
	for _, p := range parts {
		total += len([]rune(stripTags(p)))
	}
	if total == 0 {
		return 1
	}
	// ~350 CJK chars or ~220 words per minute; 4 chars/word is a fair blend.
	mins := total / 900
	if mins < 1 {
		return 1
	}
	return mins
}

// stripTags removes HTML tags and collapses whitespace for text measurement.
func stripTags(s string) string {
	var b strings.Builder
	depth := 0
	for _, r := range s {
		switch {
		case r == '<':
			depth++
		case r == '>':
			if depth > 0 {
				depth--
			}
		case depth == 0:
			b.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// HostOf returns the hostname of a URL, used for feed fallbacks in the UI.
func HostOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return strings.TrimPrefix(u.Hostname(), "www.")
}
