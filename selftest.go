package main

import (
	"fmt"
	"strings"

	"reads/internal/feed"
	"reads/internal/model"
	"reads/internal/service"
	"reads/internal/store"
)

// sampleRSS is a small but complete RSS 2.0 document, including the hostile
// markup the sanitiser is expected to strip.
const sampleRSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>ReadS Test Feed</title>
    <link>https://example.com/</link>
    <description>A feed used by the self-test</description>
    <item>
      <title>First &amp; Foremost</title>
      <link>https://example.com/first</link>
      <guid>https://example.com/first</guid>
      <author>ada@example.com (Ada Lovelace)</author>
      <pubDate>Mon, 02 Jan 2024 15:04:05 GMT</pubDate>
      <description>Short teaser for the first entry.</description>
      <content:encoded><![CDATA[
        <p>Hello <strong>world</strong>.</p>
        <script>alert('xss')</script>
        <img src="https://example.com/cover.jpg" alt="cover">
        <a href="javascript:alert(1)">bad link</a>
        <a href="https://example.com/ok">good link</a>
        <iframe src="https://evil.example.com"></iframe>
        <table><tr><td>a very wide table cell</td><td>another one</td></tr></table>
      ]]></content:encoded>
    </item>
    <item>
      <title>Second Entry</title>
      <link>https://example.com/second</link>
      <guid>https://example.com/second</guid>
      <pubDate>Tue, 03 Jan 2024 10:00:00 GMT</pubDate>
      <description>Another teaser.</description>
    </item>
  </channel>
</rss>`

// selftestStore checks that parsing, sanitisation and persistence behave.
func selftestStore(st *store.Store) error {
	// Cached threads are only refetched when a stored fragment is recognisably
	// stale, so each staleness rule needs to still fire. A silent regression
	// here means old markup renders forever.
	staleFragments := map[string]string{
		"avatar inside the author paragraph (pre-column layout)": `<div class="comment comment--api"><p class="comment-author"><img class="avatar" src="data:image/png;base64,AAAA" alt="张三">张三</p><div class="comment__content">正文</div></div>`,
		"gradient-less initials bubble":                          `<span class="avatar avatar--text" data-initial="张"></span>`,
		"non-inlined image":                                      `<img class="avatar" src="https://cdn.example.com/a.png">`,
	}
	for label, fragment := range staleFragments {
		if !st.NeedsCommentRefresh(fragment) {
			return fmt.Errorf("[comments] stale cached markup was not detected: %s", label)
		}
	}
	if st.NeedsCommentRefresh(`<div class="comment comment--api"><img class="avatar" src="data:image/png;base64,AAAA" alt="张三"><p class="comment-author">张三<span class="comment-meta">1 楼 · 2026-01-01</span></p><div class="comment__content">正文</div></div>`) {
		return fmt.Errorf("[comments] current markup was flagged as stale")
	}

	parser := feed.NewFetcher()
	res, err := parser.ParseBytes([]byte(sampleRSS), "https://example.com/rss.xml")
	if err != nil {
		return fmt.Errorf("[feed] parse sample: %w", err)
	}
	if res.Title != "ReadS Test Feed" {
		return fmt.Errorf("[feed] title = %q, want %q", res.Title, "ReadS Test Feed")
	}
	if len(res.Items) != 2 {
		return fmt.Errorf("[feed] parsed %d items, want 2", len(res.Items))
	}

	first := res.Items[0]
	if first.GUID != "https://example.com/first" {
		return fmt.Errorf("[feed] guid = %q", first.GUID)
	}
	if first.PublishedAt == 0 {
		return fmt.Errorf("[feed] published time was not parsed")
	}
	if first.ImageURL != "https://example.com/cover.jpg" {
		return fmt.Errorf("[feed] image = %q, want the in-content cover", first.ImageURL)
	}

	// The sanitiser must remove script/style/iframe and javascript: URLs.
	for _, bad := range []string{"<script", "alert(", "javascript:", "<iframe", "evil.example.com"} {
		if contains(first.Content, bad) {
			return fmt.Errorf("[sanitize] %q survived sanitisation", bad)
		}
	}
	for _, good := range []string{"<strong>world</strong>", "https://example.com/ok", "cover.jpg"} {
		if !contains(first.Content, good) {
			return fmt.Errorf("[sanitize] %q was stripped but should be kept", good)
		}
	}
	// Tables must be wrapped so a wide one scrolls instead of widening the
	// reader pane (see the sanitiser's table handling).
	if !contains(first.Content, `<div class="table-scroll"><table>`) {
		return fmt.Errorf("[sanitize] table was not wrapped in .table-scroll: %s", first.Content)
	}

	f, created, err := st.AddFeed(&model.Feed{
		Title: res.Title, URL: "https://example.com/rss.xml", SiteURL: res.SiteURL,
	})
	if err != nil {
		return fmt.Errorf("[store] add feed: %w", err)
	}
	if !created {
		return fmt.Errorf("[store] add feed reported an existing feed")
	}

	inserted, err := st.SaveEntries(f.ID, res.Items)
	if err != nil {
		return fmt.Errorf("[store] save entries: %w", err)
	}
	if inserted != 2 {
		return fmt.Errorf("[store] inserted %d entries, want 2", inserted)
	}

	// Re-saving must be idempotent and must not resurrect read state.
	again, err := st.SaveEntries(f.ID, res.Items)
	if err != nil {
		return fmt.Errorf("[store] re-save entries: %w", err)
	}
	if again != 0 {
		return fmt.Errorf("[store] re-save inserted %d duplicate entries", again)
	}

	page, err := st.QueryEntries(model.ListQuery{Scope: model.ScopeAll, Limit: 10})
	if err != nil {
		return fmt.Errorf("[store] query entries: %w", err)
	}
	if page.Total != 2 || len(page.Entries) != 2 {
		return fmt.Errorf("[store] query returned %d/%d entries, want 2", len(page.Entries), page.Total)
	}
	// Descending order by publish date: the January 3rd entry must come first.
	if page.Entries[0].Title != "Second Entry" {
		return fmt.Errorf("[store] ordering: first entry is %q", page.Entries[0].Title)
	}

	counts, err := st.Counts()
	if err != nil {
		return fmt.Errorf("[store] counts: %w", err)
	}
	if counts.Unread != 2 {
		return fmt.Errorf("[store] unread = %d, want 2", counts.Unread)
	}

	// Mark one entry read and confirm counts follow.
	if err := st.SetRead([]int64{page.Entries[0].ID}, true); err != nil {
		return fmt.Errorf("[store] set read: %w", err)
	}
	counts, _ = st.Counts()
	if counts.Unread != 1 {
		return fmt.Errorf("[store] unread after read = %d, want 1", counts.Unread)
	}

	starred, err := st.ToggleStar(page.Entries[0].ID)
	if err != nil || !starred {
		return fmt.Errorf("[store] toggle star = %v, %v", starred, err)
	}

	// Re-saving now must preserve both read and starred state.
	if _, err := st.SaveEntries(f.ID, res.Items); err != nil {
		return fmt.Errorf("[store] re-save after state change: %w", err)
	}
	detail, err := st.EntryDetail(page.Entries[0].ID)
	if err != nil {
		return fmt.Errorf("[store] entry detail: %w", err)
	}
	if !detail.Read || !detail.Starred {
		return fmt.Errorf("[store] user state lost on refresh: read=%v starred=%v",
			detail.Read, detail.Starred)
	}
	if detail.ReadingMinutes < 1 {
		return fmt.Errorf("[store] reading time = %d", detail.ReadingMinutes)
	}
	return nil
}

// selftestService checks the service layer, including OPML round-tripping.
func selftestService(svc *service.Service, st *store.Store) error {
	boot, err := svc.Bootstrap()
	if err != nil {
		return fmt.Errorf("[service] bootstrap: %w", err)
	}
	if len(boot.Feeds) != 1 {
		return fmt.Errorf("[service] bootstrap returned %d feeds, want 1", len(boot.Feeds))
	}
	if boot.Settings.FeedColWidth != 256 || boot.Settings.EntryColWidth != 450 {
		return fmt.Errorf("[service] default widths are %d/%d, want 256/450",
			boot.Settings.FeedColWidth, boot.Settings.EntryColWidth)
	}

	cat, err := svc.CreateCategory("Tech")
	if err != nil {
		return fmt.Errorf("[service] create category: %w", err)
	}
	if err := svc.MoveFeed(boot.Feeds[0].ID, cat.ID); err != nil {
		return fmt.Errorf("[service] move feed: %w", err)
	}

	exported, err := svc.ExportOPMLContent()
	if err != nil {
		return fmt.Errorf("[service] export OPML: %w", err)
	}
	if !contains(exported, "ReadS Test Feed") || !contains(exported, "Tech") {
		return fmt.Errorf("[service] exported OPML is missing the feed or its folder")
	}

	// Import into the same database to prove the round trip is idempotent.
	imported, err := svc.ImportOPMLContent(exported)
	if err != nil {
		return fmt.Errorf("[service] import OPML: %w", err)
	}
	// Everything is already subscribed, so this must be a no-op rather than
	// creating duplicates.
	feeds, _ := st.Feeds()
	if len(feeds) != 1 {
		return fmt.Errorf("[service] OPML re-import duplicated feeds: %d", len(feeds))
	}
	_ = imported

	// Mark-all-read over a scope.
	q := model.ListQuery{Scope: model.ScopeAll}
	n, err := svc.MarkAllRead(q, true)
	if err != nil {
		return fmt.Errorf("[service] mark all read: %w", err)
	}
	if n != 2 {
		return fmt.Errorf("[service] mark all read touched %d entries, want 2", n)
	}
	counts, _ := svc.Counts()
	if counts.Unread != 0 {
		return fmt.Errorf("[service] unread after mark-all = %d, want 0", counts.Unread)
	}

	// Settings persistence, including a value that differs from the default.
	settings, _ := svc.GetSettings()
	settings.RefreshIntervalMin = 45
	settings.AccentColor = "blue"
	if err := svc.SaveSettings(settings); err != nil {
		return fmt.Errorf("[service] save settings: %w", err)
	}
	reloaded, _ := svc.GetSettings()
	if reloaded.RefreshIntervalMin != 45 || reloaded.AccentColor != "blue" {
		return fmt.Errorf("[service] settings did not persist: %+v", reloaded)
	}

	// Search should find the entry by its title.
	found, err := svc.ListEntries(model.ListQuery{Scope: model.ScopeAll, Search: "Second"})
	if err != nil {
		return fmt.Errorf("[service] search: %w", err)
	}
	if found.Total != 1 {
		return fmt.Errorf("[service] search matched %d entries, want 1", found.Total)
	}

	if err := svc.ServiceShutdown(); err != nil {
		return fmt.Errorf("[service] shutdown: %w", err)
	}
	return nil
}

func contains(haystack, needle string) bool {
	return strings.Contains(haystack, needle)
}
