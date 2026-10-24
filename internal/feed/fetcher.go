// Package feed implements everything that talks to the outside world:
// fetching feeds over HTTP with conditional requests, parsing them into a
// normalised shape, discovering feed URLs from a website, and extracting
// full article text with a readability pass.
package feed

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"reads/internal/model"
	"reads/internal/store"

	"github.com/go-shiori/go-readability"
	"github.com/mmcdole/gofeed"
)

const (
	userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
		"(KHTML, like Gecko) Chrome/124.0 Safari/537.36 ReadS/1.0"
	maxBodyBytes = 12 << 20 // 12 MiB is generous for a feed or an article page
)

// Fetcher performs feed and article HTTP requests.
type Fetcher struct {
	client *http.Client
	parser *gofeed.Parser
	// recipes remembers how each host exposes its comments, once discovered.
	recipes CommentRecipeStore
	// log receives discovery diagnostics; nil-safe via logf.
	log *slog.Logger
}

// SetRecipeStore gives the fetcher somewhere to cache discovered comment APIs.
// It is optional: without a store, discovery simply runs on every request.
func (f *Fetcher) SetRecipeStore(store CommentRecipeStore) { f.recipes = store }

// SetLogger routes discovery diagnostics to the application log.
func (f *Fetcher) SetLogger(logger *slog.Logger) { f.log = logger }

// logf writes a debug line when a logger is configured.
func (f *Fetcher) logf(msg string, args ...any) {
	if f.log != nil {
		f.log.Debug(msg, args...)
	}
}

// doRetry issues a GET and retries transient failures.
//
// A single timeout or connection reset is common on flaky links and previously
// surfaced to the user as a hard "could not add feed" error. Server errors and
// rate limiting are retried too; genuine client errors (404, 403) are not,
// because retrying them only wastes the user's time.
func (f *Fetcher) doRetry(req *http.Request) (*http.Response, error) {
	const attempts = 3
	var lastErr error

	for attempt := 0; attempt < attempts; attempt++ {
		if attempt > 0 {
			select {
			case <-req.Context().Done():
				return nil, req.Context().Err()
			case <-time.After(time.Duration(attempt) * 700 * time.Millisecond):
			}
		}

		// Clone per attempt: a request can only be sent once.
		resp, err := f.client.Do(req.Clone(req.Context()))
		if err != nil {
			if req.Context().Err() != nil {
				return nil, err // cancelled or timed out by the caller
			}
			lastErr = err
			f.logf("request failed, will retry", "url", req.URL.String(), "attempt", attempt+1, "err", err.Error())
			continue
		}

		if resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests {
			resp.Body.Close()
			lastErr = fmt.Errorf("服务器返回 %d", resp.StatusCode)
			f.logf("server error, will retry", "url", req.URL.String(), "attempt", attempt+1, "status", resp.StatusCode)
			continue
		}
		return resp, nil
	}
	return nil, lastErr
}
func NewFetcher() *Fetcher {
	p := gofeed.NewParser()
	p.UserAgent = userAgent

	return &Fetcher{
		client: &http.Client{
			Timeout: 30 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 8 {
					return errors.New("重定向次数过多")
				}
				return nil
			},
			// Per-phase deadlines, so a link that stalls mid-handshake fails in
			// seconds and gets retried instead of burning the whole 30s budget.
			// Measured on a flaky path to a Cloudflare-fronted site: TLS
			// handshakes intermittently hang for 10–30s while the same site
			// answers in 1–4s on the next attempt; with only an overall
			// timeout a single stall surfaced as "服务器响应超时" and the
			// retry never got a chance. These limits bound only the phases
			// before the body, so slow-but-progressing downloads are unaffected.
			Transport: &http.Transport{
				Proxy: http.ProxyFromEnvironment,
				DialContext: (&net.Dialer{
					Timeout:   10 * time.Second,
					KeepAlive: 30 * time.Second,
				}).DialContext,
				TLSHandshakeTimeout:   10 * time.Second,
				ResponseHeaderTimeout: 15 * time.Second,
				ExpectContinueTimeout: time.Second,
				IdleConnTimeout:       60 * time.Second,
				MaxIdleConnsPerHost:   4,
				ForceAttemptHTTP2:     true,
			},
		},
		parser: p,
	}
}

// FetchResult is the normalised outcome of fetching one feed.
type FetchResult struct {
	NotModified  bool
	ETag         string
	LastModified string
	Title        string
	SiteURL      string
	Description  string
	IconURL      string
	Items        []store.FeedItem
	View         string
}

// Fetch retrieves and parses a feed, sending conditional headers when the
// caller supplies validators from a previous request.
func (f *Fetcher) Fetch(ctx context.Context, feedURL, etag, lastModified string) (*FetchResult, error) {
	// Bilibili has no RSS: a stored space URL is read through its API instead.
	if mid := bilibiliSpaceID(feedURL); mid != "" {
		return f.fetchBilibiliSpace(ctx, feedURL, mid)
	}
	// Channel pages can arrive through OPML or an older build; normalise them
	// to the native RSS address the rest of the pipeline expects.
	if channelID := youtubeChannelIDFromURL(feedURL); channelID != "" && !isYouTubeFeedURL(feedURL) {
		feedURL = youtubeFeedURL(channelID)
	}

	// Conditional headers are rebuilt per attempt, so a retry after a stall
	// still asks "has this changed since I last saw it".
	status, header, body, err := f.fetchBody(ctx, feedURL, func(ctx context.Context) (*http.Request, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", userAgent)
		req.Header.Set("Accept", "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8")
		if etag != "" {
			req.Header.Set("If-None-Match", etag)
		}
		if lastModified != "" {
			req.Header.Set("If-Modified-Since", lastModified)
		}
		return req, nil
	})
	if err != nil {
		return nil, friendlyNetErr(err)
	}

	if status == http.StatusNotModified {
		return &FetchResult{
			NotModified:  true,
			ETag:         firstNonEmpty(header.Get("ETag"), etag),
			LastModified: firstNonEmpty(header.Get("Last-Modified"), lastModified),
		}, nil
	}
	if status < 200 || status > 299 {
		return nil, fmt.Errorf("服务器返回 %d", status)
	}

	parsed, err := f.parser.Parse(bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("无法解析订阅源内容")
	}

	result := f.normalize(parsed, feedURL, header.Get("ETag"), header.Get("Last-Modified"))
	if isYouTubeFeedURL(feedURL) {
		enrichYouTubeMedia(body, result)
	}
	return result, nil
}

// ParseBytes parses feed bytes that the caller already has. It shares the
// normalisation path used by Fetch, which makes the parsing pipeline testable
// without touching the network.
func (f *Fetcher) ParseBytes(body []byte, feedURL string) (*FetchResult, error) {
	parsed, err := f.parser.Parse(bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("无法解析订阅源内容")
	}
	result := f.normalize(parsed, feedURL, "", "")
	if isYouTubeFeedURL(feedURL) {
		enrichYouTubeMedia(body, result)
	}
	return result, nil
}

// normalize converts a gofeed feed into the app's own shape.
func (f *Fetcher) normalize(parsed *gofeed.Feed, feedURL, etag, lastModified string) *FetchResult {
	res := &FetchResult{
		ETag:         etag,
		LastModified: lastModified,
		Title:        strings.TrimSpace(parsed.Title),
		SiteURL:      strings.TrimSpace(parsed.Link),
		Description:  Truncate(PlainText(parsed.Description), 240),
	}

	// Prefer an image the feed itself advertises. Otherwise leave the icon
	// empty: the service resolves the site's real icon and caches it as a data
	// URI (see icon.go). No third-party favicon service is involved.
	if parsed.Image != nil && parsed.Image.URL != "" {
		res.IconURL = parsed.Image.URL
	}

	for _, it := range parsed.Items {
		item := f.normalizeItem(it)
		if item.GUID == "" {
			continue
		}
		res.Items = append(res.Items, item)
	}

	res.View = Classify(feedURL, res.Items)
	return res
}

func (f *Fetcher) normalizeItem(it *gofeed.Item) store.FeedItem {
	raw := firstNonEmpty(it.Content, it.Description)
	content := SanitizeHTML(raw)

	summary := Truncate(PlainText(firstNonEmpty(it.Description, it.Content)), 300)

	image := ""
	if it.Image != nil && it.Image.URL != "" {
		image = it.Image.URL
	}
	for _, enc := range it.Enclosures {
		if strings.HasPrefix(strings.ToLower(enc.Type), "image/") && enc.URL != "" {
			image = enc.URL
			break
		}
	}
	if image == "" {
		image = FirstImageURL(content)
	}

	published := int64(0)
	switch {
	case it.PublishedParsed != nil:
		published = it.PublishedParsed.UnixMilli()
	case it.UpdatedParsed != nil:
		published = it.UpdatedParsed.UnixMilli()
	default:
		published = time.Now().UnixMilli()
	}

	author := ""
	if it.Author != nil && it.Author.Name != "" {
		author = it.Author.Name
	} else if len(it.Authors) > 0 && it.Authors[0] != nil {
		author = it.Authors[0].Name
	}

	guid := strings.TrimSpace(it.GUID)
	if guid == "" {
		guid = strings.TrimSpace(it.Link)
	}
	if guid == "" {
		sum := sha1.Sum([]byte(it.Title + "|" + fmt.Sprint(published)))
		guid = "sha1:" + hex.EncodeToString(sum[:])
	}

	title := strings.TrimSpace(PlainText(it.Title))
	if title == "" {
		title = Truncate(summary, 90)
	}

	audioURL, audioType := audioSource(it, content)
	audioDuration := 0
	if audioURL != "" {
		audioDuration = parseAudioDuration(it)
	}

	return store.FeedItem{
		GUID:          guid,
		Title:         title,
		URL:           strings.TrimSpace(it.Link),
		Author:        author,
		Summary:       summary,
		Content:       content,
		ImageURL:      image,
		PublishedAt:   published,
		AudioURL:      audioURL,
		AudioType:     audioType,
		AudioDuration: audioDuration,
	}
}

// audioSource finds the episode file. Podcast feeds put it in an enclosure;
// some blog-style feeds embed an <audio> player instead. Video enclosures are
// deliberately ignored, so a video feed never becomes an audio episode.
func audioSource(it *gofeed.Item, content string) (string, string) {
	for _, enc := range it.Enclosures {
		if enc == nil || strings.TrimSpace(enc.URL) == "" {
			continue
		}
		if strings.HasPrefix(strings.ToLower(enc.Type), "audio/") || audioFileURL(enc.URL) {
			return strings.TrimSpace(enc.URL), strings.TrimSpace(enc.Type)
		}
	}
	if u := FirstAudioURL(content); u != "" {
		return u, ""
	}
	return "", ""
}

// audioFileURL is the fallback when a feed forgets the enclosure's MIME type.
func audioFileURL(raw string) bool {
	lower := strings.ToLower(raw)
	if i := strings.IndexAny(lower, "?#"); i >= 0 {
		lower = lower[:i]
	}
	for _, ext := range []string{".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".flac"} {
		if strings.HasSuffix(lower, ext) {
			return true
		}
	}
	return false
}

// parseAudioDuration reads iTunes' duration, which is either seconds ("3723")
// or colon-separated ("1:02:03"). Other formats are left at zero; the player
// fills the real duration in once the file's metadata loads.
func parseAudioDuration(it *gofeed.Item) int {
	if it.ITunesExt == nil {
		return 0
	}
	return ParseDurationSeconds(it.ITunesExt.Duration)
}

// ParseDurationSeconds converts an iTunes-style duration to whole seconds.
func ParseDurationSeconds(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	parts := strings.Split(raw, ":")
	if len(parts) > 3 {
		return 0
	}
	if len(parts) == 1 {
		seconds, err := strconv.ParseFloat(raw, 64)
		if err != nil || seconds < 0 {
			return 0
		}
		return int(seconds)
	}
	total := 0
	for _, part := range parts {
		n, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || n < 0 {
			return 0
		}
		total = total*60 + n
	}
	return total
}

// SelfTestDiscovery covers the offline parts of feed discovery: the host-twin
// retry that gets past a WAF-protected vhost, and the challenge-page detector
// that decides whether a failure deserves a browser-verification message.
func SelfTestDiscovery() error {
	cases := []struct {
		in, want string
	}{
		{"https://36kr.com/feed", "https://www.36kr.com/feed"},
		{"https://www.36kr.com/feed", "https://36kr.com/feed"},
		{"https://example.com:8443/feed?x=1", "https://www.example.com:8443/feed?x=1"},
		{"http://www.example.com:8080/a/b", "http://example.com:8080/a/b"},
		{"https://127.0.0.1/feed", ""},
		{"https://localhost/feed", ""},
	}
	for _, c := range cases {
		parsed, err := url.Parse(c.in)
		if err != nil {
			return fmt.Errorf("[discover] parse %s: %w", c.in, err)
		}
		alt := alternateHostURL(parsed)
		got := ""
		if alt != nil {
			got = alt.String()
		}
		if got != c.want {
			return fmt.Errorf("[discover] alternateHostURL(%s) = %q, want %q", c.in, got, c.want)
		}
		// The twin must be reachable in both directions, or the retry could
		// bounce between two names forever.
		if alt != nil {
			if back := alternateHostURL(alt); back == nil || back.String() != c.in {
				return fmt.Errorf("[discover] alternateHostURL is not its own inverse for %s", c.in)
			}
		}
	}

	challenges := map[string]string{
		"volcengine waf": `<script type="application/json" id="__waf_verification_challenge">{"v":1}</script>`,
		"waf copy":       `<p class="title">正在进行安全检测...</p>`,
		"cloudflare":     `<title>Just a moment...</title>`,
		"aliyun":         `<script>var aliyun_waf = {};</script>`,
	}
	for label, body := range challenges {
		if !looksLikeBotChallenge([]byte(body)) {
			return fmt.Errorf("[discover] challenge page was not detected: %s", label)
		}
	}
	for label, body := range map[string]string{
		"rss":     `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>`,
		"article": `<!doctype html><html><body><h1>Hello</h1><p>text</p></body></html>`,
	} {
		if looksLikeBotChallenge([]byte(body)) {
			return fmt.Errorf("[discover] genuine content was treated as a challenge: %s", label)
		}
	}

	// Transport errors are shown in the UI, so they must be plain Chinese
	// conclusions rather than English transport vocabulary (DESIGN.md §8).
	netCases := map[string]string{
		"dns":     "无法解析该域名，请检查地址",
		"timeout": "服务器响应超时",
		"refused": "服务器拒绝连接",
		"tls":     "无法验证该站点的证书",
		"other":   "网络请求失败",
	}
	rawErrors := map[string]string{
		"dns":     `Get "https://x.invalid/": dial tcp: lookup x.invalid: no such host`,
		"timeout": `Get "https://slow.example/": context deadline exceeded (Client.Timeout exceeded)`,
		"refused": `Get "https://x.example/": dial tcp 127.0.0.1:1: connectex: connection refused`,
		"tls":     `tls: failed to verify certificate: x509: certificate signed by unknown authority`,
		"other":   `unexpected EOF`,
	}
	for label, want := range netCases {
		if got := friendlyNetErr(errors.New(rawErrors[label])).Error(); got != want {
			return fmt.Errorf("[discover] network error %q mapped to %q, want %q", label, got, want)
		}
	}

	return nil
}

// Discover resolves a user-supplied URL to one or more candidate feeds.
//
// It accepts a direct feed URL, or an HTML page from which it extracts
// <link rel="alternate"> feed references, falling back to well-known paths.
//
// When the host does not serve the feed, the same request is retried on the
// host's www./apex twin. Sites commonly protect one vhost with a bot checkpoint
// while leaving the other open: 36kr.com answers a JavaScript challenge for
// every path, while www.36kr.com/feed serves the real RSS. This is a host
// canonicalisation retry, not a site-specific rule.
func (f *Fetcher) Discover(ctx context.Context, raw string) ([]model.DiscoveredFeed, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("请输入网站或订阅源地址")
	}
	// A username, UID, channel URL or single video is resolved by the video
	// platform itself; a plain website continues through generic discovery.
	if candidates, handled, err := f.resolveVideoDiscovery(ctx, raw); handled {
		return candidates, err
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	target, err := url.Parse(raw)
	if err != nil || target.Host == "" {
		return nil, fmt.Errorf("「%s」不是有效的地址", raw)
	}

	feeds, challenged, err := f.discoverOne(ctx, target)
	if err == nil {
		return feeds, nil
	}
	firstErr := err

	// Do not retry the twin after a timeout: the second attempt would spend the
	// same 30s again and almost always fail the same way, so the user would wait
	// twice as long for the same answer. A quick failure (no feed on this host,
	// a challenge page, a refused connection) is worth one more request.
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return nil, firstErr
	}

	if alt := alternateHostURL(target); alt != nil {
		altFeeds, altChallenged, altErr := f.discoverOne(ctx, alt)
		if altErr == nil {
			return altFeeds, nil
		}
		challenged = challenged || altChallenged
	}

	if challenged {
		// Both hosts served an anti-bot interstitial instead of a feed.
		return nil, fmt.Errorf("%s 启用了浏览器安全验证，无法直接读取", target.Host)
	}
	return nil, firstErr
}

// discoverOne runs discovery against exactly one host. It reports whether any
// response was an anti-bot challenge page, so Discover can explain the failure.
func (f *Fetcher) discoverOne(ctx context.Context, target *url.URL) ([]model.DiscoveredFeed, bool, error) {
	challenged := false

	resp, err := f.get(ctx, target.String())
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, false, fmt.Errorf("服务器返回 %d", resp.StatusCode)
	}

	body, err := readLimited(resp.Body)
	if err != nil {
		return nil, false, err
	}
	if looksLikeBotChallenge(body) {
		challenged = true
	}

	// Case 1: the URL is itself a feed.
	if looksLikeFeed(body, resp.Header.Get("Content-Type")) {
		if _, perr := f.parser.Parse(bytes.NewReader(body)); perr == nil {
			return []model.DiscoveredFeed{{
				Title:   feedTitleOf(f.parser, body, target),
				URL:     target.String(),
				Type:    "feed",
				IsFeed:  true,
				SiteURL: target.String(),
			}}, false, nil
		}
	}

	// Case 2: an HTML page advertising its feeds.
	found := discoverFromHTML(body, target)
	if len(found) > 0 {
		return found, false, nil
	}

	// Case 3: probe conventional locations.
	for _, p := range []string{"/feed", "/rss", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml", "/feed/"} {
		candidate := *target
		candidate.Path = strings.TrimSuffix(target.Path, "/") + p
		probe, err := f.get(ctx, candidate.String())
		if err != nil {
			continue
		}
		probeBody, rerr := readLimited(probe.Body)
		probe.Body.Close()
		if rerr != nil || probe.StatusCode < 200 || probe.StatusCode > 299 {
			continue
		}
		if looksLikeBotChallenge(probeBody) {
			challenged = true
			continue
		}
		if looksLikeFeed(probeBody, probe.Header.Get("Content-Type")) {
			if _, perr := f.parser.Parse(bytes.NewReader(probeBody)); perr == nil {
				return []model.DiscoveredFeed{{
					Title:   feedTitleOf(f.parser, probeBody, &candidate),
					URL:     candidate.String(),
					Type:    "feed",
					IsFeed:  true,
					SiteURL: target.String(),
				}}, false, nil
			}
		}
	}

	// Name the address that failed: the user typed it, and a bare "not found"
	// leaves them guessing which of several attempts went wrong.
	return nil, challenged, fmt.Errorf("%s 上没有找到订阅源", target.String())
}

// alternateHostURL returns the same URL on the host's www./apex twin, or nil
// when there is no sensible twin (an IP address, or a single-label host).
func alternateHostURL(u *url.URL) *url.URL {
	host := u.Hostname()
	if host == "" || net.ParseIP(host) != nil {
		return nil
	}
	var alt string
	if strings.HasPrefix(host, "www.") {
		alt = strings.TrimPrefix(host, "www.")
		if !strings.Contains(alt, ".") {
			return nil
		}
	} else {
		if !strings.Contains(host, ".") {
			return nil
		}
		alt = "www." + host
	}
	if port := u.Port(); port != "" {
		alt = net.JoinHostPort(alt, port)
	}
	twin := *u
	twin.Host = alt
	return &twin
}

// looksLikeBotChallenge reports whether a response body is an anti-bot
// interstitial rather than the page that was requested. Several WAFs in China
// and abroad serve one of these to non-browser clients.
func looksLikeBotChallenge(body []byte) bool {
	if len(body) == 0 || len(body) > 2<<20 {
		return false
	}
	head := body
	if len(head) > 16<<10 {
		head = head[:16<<10]
	}
	text := strings.ToLower(string(head))
	for _, marker := range []string{
		"__waf_verification_challenge", // 火山引擎 WAF
		"正在进行安全检测",                     // same WAF's visible copy
		"cf-challenge",                 // Cloudflare
		"just a moment...",             // Cloudflare
		"aliyun_waf",                   // Alibaba Cloud WAF
		"yunsuo",                       // 云锁
		"captcha",                      // generic
	} {
		if strings.Contains(text, marker) {
			return true
		}
	}
	return false
}

// FetchArticle runs a readability pass and returns sanitised article HTML.
func (f *Fetcher) FetchArticle(ctx context.Context, pageURL string) (string, error) {
	parsed, err := url.Parse(pageURL)
	if err != nil || parsed.Host == "" {
		return "", errors.New("这篇文章没有原文链接")
	}

	status, _, body, err := f.fetchBody(ctx, pageURL, func(ctx context.Context) (*http.Request, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", userAgent)
		req.Header.Set("Accept", "text/html,application/xhtml+xml")
		return req, nil
	})
	if err != nil {
		return "", friendlyNetErr(err)
	}
	if status < 200 || status > 299 {
		return "", fmt.Errorf("服务器返回 %d", status)
	}

	article, err := readability.FromReader(bytes.NewReader(body), parsed)
	if err != nil {
		return "", fmt.Errorf("无法提取这篇文章的正文")
	}
	content := SanitizeHTML(article.Content)
	if strings.TrimSpace(PlainText(content)) == "" {
		return "", errors.New("这篇文章没有可提取的正文")
	}
	return content, nil
}

// fetchBody performs one logical GET whose retries include reading the body.
//
// A transfer on a flaky link can stall after the headers arrive, and the only
// way to recover is to retry the whole request. This is what makes updates
// from intermittently slow sites succeed: measured against a
// Cloudflare-fronted feed, individual attempts hang in the TLS handshake or
// mid-body for 10–30s, while the next attempt answers in a few seconds. Server
// errors and 429 are retried as well; other client errors are returned at once
// so callers can report them without wasting the user's time.
func (f *Fetcher) fetchBody(
	ctx context.Context,
	label string,
	build func(context.Context) (*http.Request, error),
) (int, http.Header, []byte, error) {
	const attempts = 3
	var lastErr error

	for attempt := 0; attempt < attempts; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return 0, nil, nil, ctx.Err()
			case <-time.After(time.Duration(attempt) * 700 * time.Millisecond):
			}
		}

		req, err := build(ctx)
		if err != nil {
			return 0, nil, nil, errors.New("无法构造请求")
		}

		resp, err := f.client.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return 0, nil, nil, ctx.Err()
			}
			lastErr = err
			f.logf("request failed, will retry", "url", label, "attempt", attempt+1, "err", err.Error())
			continue
		}

		body, rerr := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
		resp.Body.Close()
		if rerr != nil {
			if ctx.Err() != nil {
				return 0, nil, nil, ctx.Err()
			}
			lastErr = errors.New("读取页面内容失败")
			f.logf("reading body failed, will retry", "url", label, "attempt", attempt+1, "err", rerr.Error())
			continue
		}

		if resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests {
			lastErr = fmt.Errorf("服务器返回 %d", resp.StatusCode)
			f.logf("server error, will retry", "url", label, "attempt", attempt+1, "status", resp.StatusCode)
			continue
		}

		return resp.StatusCode, resp.Header, body, nil
	}

	return 0, nil, nil, lastErr
}

/* --------------------------------------------------------------- helpers */

func (f *Fetcher) get(ctx context.Context, u string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8")
	resp, err := f.doRetry(req)
	if err != nil {
		return nil, friendlyNetErr(err)
	}
	return resp, nil
}

func readLimited(r io.Reader) ([]byte, error) {
	return readLimitedCap(r, maxBodyBytes)
}

// readLimitedCap reads at most maxBytes, for callers with a tighter budget
// (script bundles, JSON endpoints).
func readLimitedCap(r io.Reader, maxBytes int64) ([]byte, error) {
	if maxBytes <= 0 {
		maxBytes = maxBodyBytes
	}
	body, err := io.ReadAll(io.LimitReader(r, maxBytes))
	if err != nil {
		return nil, errors.New("读取页面内容失败")
	}
	return body, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func parseURL(raw string) *url.URL {
	u, err := url.Parse(raw)
	if err != nil {
		return nil
	}
	return u
}

func looksLikeFeed(body []byte, contentType string) bool {
	ct := strings.ToLower(contentType)
	if strings.Contains(ct, "rss") || strings.Contains(ct, "atom") ||
		strings.Contains(ct, "xml") || strings.Contains(ct, "feed+json") {
		return true
	}
	head := strings.ToLower(strings.TrimSpace(string(body)))
	if len(head) > 400 {
		head = head[:400]
	}
	return strings.HasPrefix(head, "<?xml") || strings.HasPrefix(head, "<rss") ||
		strings.HasPrefix(head, "<feed") || strings.HasPrefix(head, "{")
}

func feedTitleOf(p *gofeed.Parser, body []byte, u *url.URL) string {
	if parsed, err := p.Parse(bytes.NewReader(body)); err == nil && parsed.Title != "" {
		return strings.TrimSpace(parsed.Title)
	}
	return u.Hostname()
}

// friendlyNetErr turns low-level transport errors into something a user can act
// on. The UI is Chinese, so these are phrased as short conclusions rather than
// leaking transport vocabulary (DESIGN.md §8).
func friendlyNetErr(err error) error {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "no such host"):
		return errors.New("无法解析该域名，请检查地址")
	case strings.Contains(msg, "deadline exceeded"), strings.Contains(msg, "timeout"):
		return errors.New("服务器响应超时")
	case strings.Contains(msg, "connection refused"):
		return errors.New("服务器拒绝连接")
	case strings.Contains(msg, "certificate"):
		return errors.New("无法验证该站点的证书")
	default:
		return errors.New("网络请求失败")
	}
}
