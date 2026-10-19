package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"reads/internal/feed"
	"reads/internal/model"
	"reads/internal/service"
	"reads/internal/store"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// runSubscribe is a headless helper for scripting and smoke-testing: it opens
// the same database the GUI uses, subscribes to the given URLs, and fetches
// them once.
//
//	go run . --subscribe https://example.com/feed.xml
func runSubscribe(dataDir string, urls []string) error {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}

	st, err := store.Open(filepath.Join(dataDir, "reads.db"))
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	defer st.Close()

	svc := service.New(st, dataDir, version)
	if err := svc.ServiceStartup(context.Background(), application.ServiceOptions{}); err != nil {
		return fmt.Errorf("service startup: %w", err)
	}
	defer svc.ServiceShutdown()

	fmt.Println("subscribing…")
	added := make([]int64, 0, len(urls))
	for _, raw := range urls {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		feed, err := svc.AddFeedByURL(raw, 0, "")
		if err != nil {
			fmt.Fprintf(os.Stderr, "  x %s: %v\n", raw, err)
			continue
		}
		fmt.Printf("  + %s\n    %s  [%s]\n", feed.Title, feed.URL, feed.View)
		added = append(added, feed.ID)
	}
	if len(added) == 0 {
		return fmt.Errorf("no feeds were added")
	}

	fmt.Println("refreshing…")
	started := time.Now()
	result, err := svc.Refresh(added)
	if err != nil {
		return fmt.Errorf("refresh: %w", err)
	}
	fmt.Printf("  %d new articles in %s (%d feeds failed)\n",
		result.New, time.Since(started).Round(time.Millisecond), result.Failed)
	for _, e := range result.Errors {
		fmt.Fprintf(os.Stderr, "  ! %s\n", e)
	}

	// Report the resulting timeline so the run verifies itself.
	feeds, err := st.Feeds()
	if err != nil {
		return err
	}
	fmt.Println("library:")
	for _, feed := range feeds {
		page, err := svc.ListEntries(model.ListQuery{
			Scope: model.ScopeFeed, FeedID: feed.ID, Limit: 1,
		})
		if err != nil {
			continue
		}
		fmt.Printf("  %-30s %4d entries, %3d unread\n",
			truncateRunes(feed.Title, 30), page.Total, feed.Unread)
	}
	return nil
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(s) == 0 {
		return s
	}
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}

// runFetchComments fetches and stores one entry's comments through the same
// service call the UI makes.
//
// --probe deliberately works in a scratch database, so it cannot show what the
// user's own library ends up holding. This flag exercises the real storing path
// against the real database.
//
//	go run . --fetch-comments 42
func runFetchComments(dataDir string, entryID int64) error {
	st, err := store.Open(filepath.Join(dataDir, "reads.db"))
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	defer st.Close()

	svc := service.New(st, dataDir, version)
	svc.SetLogger(newLogger(dataDir))
	if err := svc.ServiceStartup(context.Background(), application.ServiceOptions{}); err != nil {
		return err
	}
	defer svc.ServiceShutdown()

	detail, err := st.EntryDetail(entryID)
	if err != nil {
		return fmt.Errorf("entry %d: %w", entryID, err)
	}
	fmt.Printf("entry %d: %s\n  %s\n", entryID, detail.Title, detail.URL)

	result, err := svc.FetchComments(entryID)
	if err != nil {
		fmt.Printf("  result: FAILED - %v\n", err)
		return nil
	}
	fmt.Printf("  result: %d comments, %d chars\n", result.Count, len(result.HTML))

	stored, err := st.EntryDetail(entryID)
	if err != nil {
		return err
	}
	inlined, notInlined := countURLs(stored.Comments)
	fmt.Printf("  stored: %d chars, %d comments; images: %d inlined, %d not\n",
		len(stored.Comments), stored.CommentsCount, inlined, notInlined)
	for _, s := range firstRelative(stored.Comments, 3) {
		fmt.Printf("    still not inlined: %s\n", s)
	}
	fmt.Printf("  preview: %s\n", truncateRunes(feed.PlainText(stored.Comments), 200))
	return nil
}

// runTestComments runs the comment extractor over a saved HTML file, or over a
// live article URL.
//
// Separating "can we parse this page" from "can we fetch this page" is what
// makes a comment-extraction failure diagnosable: if this succeeds on a file
// the app could not extract from over HTTP, the bug is in fetching (headers,
// bot walls, timeouts), not in the extraction heuristics.
//
//	go run . --test-comments page.html
//	go run . --test-comments https://example.com/post/123
func runTestComments(dataDir, target string) error {
	if strings.HasPrefix(target, "http://") || strings.HasPrefix(target, "https://") {
		return runTestCommentsLive(dataDir, target)
	}

	page, err := os.ReadFile(target)
	if err != nil {
		return fmt.Errorf("read %s: %w", target, err)
	}
	fmt.Printf("file: %s (%d bytes)\n", target, len(page))

	// Always show the candidate table: it is what makes a failure diagnosable.
	candidates, err := feed.AnalyzeComments(page)
	if err != nil {
		return err
	}
	fmt.Printf("  candidates (class/id mentioning 'comment'), by text length:\n")
	if len(candidates) == 0 {
		fmt.Printf("    (none — this response contains no comment markup at all)\n")
	}
	for _, c := range candidates {
		fmt.Printf("    text=%-7d items=%-4d score=%-4d <%s class=%q id=%q>\n",
			c.TextLength, c.ItemCount, c.Score, c.Tag, c.Class, c.ID)
	}

	html, count, err := feed.ExtractComments(page, "https://example.com/article")
	if err != nil {
		fmt.Printf("  html result: FAILED - %v\n", err)
		return nil
	}
	text := feed.PlainText(html)
	fmt.Printf("  html result: %d comments, %d chars of HTML, %d chars of text\n",
		count, len(html), len([]rune(text)))
	fmt.Printf("  preview: %s\n", truncateRunes(text, 220))
	return nil
}

// runTestCommentsLive fetches one article and reports how its comments were
// obtained, including which layer (HTML or a discovered API) produced them.
func runTestCommentsLive(dataDir, articleURL string) error {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}
	st, err := store.Open(filepath.Join(dataDir, "probe.db"))
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	defer st.Close()

	svc := service.New(st, dataDir, version)
	svc.SetLogger(newLogger(dataDir))
	if err := svc.ServiceStartup(context.Background(), application.ServiceOptions{}); err != nil {
		return err
	}
	defer svc.ServiceShutdown()

	fmt.Printf("live: %s\n", articleURL)
	result, err := svc.FetchCommentsByURL(articleURL)
	if err != nil {
		fmt.Printf("  result: FAILED - %v\n", err)
		return nil
	}
	fmt.Printf("  result: %d comments, %d chars\n", result.Count, len(result.HTML))
	if recipe, err := st.GetCommentRecipe(hostOf(articleURL)); err == nil && recipe != nil {
		fmt.Printf("  recipe cached: %s  idParam=%s dataPath=%s\n",
			recipe.Endpoint, recipe.IDParam, recipe.DataPath)
	}
	// Relative image/link paths are a silent failure mode: they resolve against
	// the app's own origin and render as broken assets.
	absolute, relative := countURLs(result.HTML)
	fmt.Printf("  asset URLs: %d absolute, %d relative\n", absolute, relative)
	for _, s := range firstRelative(result.HTML, 3) {
		fmt.Printf("    still relative: %s\n", s)
	}
	fmt.Printf("  preview: %s\n", truncateRunes(feed.PlainText(result.HTML), 220))
	return nil
}

// countURLs counts src/href values in a fragment, split by absoluteness.
func countURLs(fragment string) (absolute, relative int) {
	for _, m := range urlAttrRe.FindAllStringSubmatch(fragment, -1) {
		v := m[1]
		if strings.HasPrefix(v, "http") || strings.HasPrefix(v, "data:") || strings.HasPrefix(v, "#") {
			absolute++
		} else {
			relative++
		}
	}
	return absolute, relative
}

// firstRelative returns up to n relative URL values from a fragment.
func firstRelative(fragment string, n int) []string {
	var out []string
	for _, m := range urlAttrRe.FindAllStringSubmatch(fragment, -1) {
		v := m[1]
		if strings.HasPrefix(v, "http") || strings.HasPrefix(v, "data:") || strings.HasPrefix(v, "#") {
			continue
		}
		out = append(out, v)
		if len(out) >= n {
			break
		}
	}
	return out
}

var urlAttrRe = regexp.MustCompile(`(?:src|href|poster)="([^"]*)"`)

func hostOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

// runProbe exercises the network-facing capabilities end to end against a live
// site: feed discovery, parsing, site icon resolution, full-text extraction and
// comment extraction. It is the quickest way to tell whether a scraper-based
// feature still works against today's web.
//
//	go run . --probe https://example.com
func runProbe(dataDir string, rawURL string) error {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}
	st, err := store.Open(filepath.Join(dataDir, "probe.db"))
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	defer st.Close()

	svc := service.New(st, dataDir, version)
	// Route the same diagnostics the GUI writes, so --probe can explain itself.
	svc.SetLogger(newLogger(dataDir))
	if err := svc.ServiceStartup(context.Background(), application.ServiceOptions{}); err != nil {
		return err
	}
	defer svc.ServiceShutdown()

	fmt.Printf("probing %s\n", rawURL)

	// 1. Discovery + subscribe (which also resolves the feed's metadata).
	feed, err := svc.AddFeedByURL(rawURL, 0, "")
	if err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}
	fmt.Printf("  feed      : %s [%s]\n", feed.Title, feed.View)
	fmt.Printf("  site      : %s\n", feed.SiteURL)

	// 2. Icon.
	if feed.IconURL == "" {
		fmt.Println("  icon      : not stored (resolve failed)")
	} else if strings.HasPrefix(feed.IconURL, "data:") {
		mime := strings.TrimPrefix(strings.SplitN(feed.IconURL, ";", 2)[0], "data:")
		fmt.Printf("  icon      : cached inline, %s, %d bytes\n",
			mime, len(feed.IconURL)*3/4)
	} else {
		fmt.Printf("  icon      : remote link %s\n", truncateRunes(feed.IconURL, 70))
	}

	// 3. Pick the newest entry from the feed just subscribed to.
	page, err := svc.ListEntries(model.ListQuery{
		Scope: model.ScopeFeed, FeedID: feed.ID, Limit: 1,
	})
	if err != nil {
		return err
	}
	if len(page.Entries) == 0 {
		fmt.Println("  entries   : none (feed returned no items)")
		return nil
	}
	entry := page.Entries[0]
	fmt.Printf("  newest    : %s\n", truncateRunes(entry.Title, 60))
	fmt.Printf("  feed body : %d chars\n", len(entry.Summary))

	// 4. Full text.
	detail, err := svc.FetchFullContent(entry.ID)
	if err != nil {
		fmt.Printf("  full text : FAILED - %v\n", err)
	} else {
		fmt.Printf("  full text : %d chars (readability), feed version %d chars\n",
			len(detail.FullContent), len(detail.FeedContent))
	}

	// 5. Comments.
	if _, err := svc.FetchComments(entry.ID); err != nil {
		fmt.Printf("  comments  : FAILED - %v\n", err)
	} else {
		after, err := svc.GetEntry(entry.ID)
		if err == nil {
			fmt.Printf("  comments  : %d extracted, %d chars\n",
				after.CommentsCount, len(after.Comments))
		}
	}
	return nil
}
