package feed

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"reads/internal/model"
)

// Video subscriptions resolve a human input — a username, a numeric ID, a
// channel URL or even one video — into a subscription address. YouTube
// publishes a real RSS feed per channel; Bilibili has no RSS, so its space URL
// is stored and fetchBilibiliSpace reads the videos through the API.

// NormalizeVideoPlatform maps labels a reader may type or a UI may send onto
// the two platform identifiers used everywhere else.
func NormalizeVideoPlatform(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case model.VideoPlatformBilibili, "b站", "bili", "哔哩哔哩":
		return model.VideoPlatformBilibili
	case model.VideoPlatformYouTube, "yt", "油管":
		return model.VideoPlatformYouTube
	default:
		return ""
	}
}

// SearchVideoChannels resolves a username or ID to subscribable channels.
// Bilibili search can return several same-named UP 主, so the UI shows a list
// rather than silently picking the first.
func (f *Fetcher) SearchVideoChannels(ctx context.Context, platform, query string) ([]model.VideoChannel, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, errors.New("请输入用户名或用户 ID")
	}

	switch NormalizeVideoPlatform(platform) {
	case model.VideoPlatformBilibili:
		return f.searchBilibiliChannels(ctx, query)
	case model.VideoPlatformYouTube:
		return f.searchYouTubeChannels(ctx, query)
	default:
		return nil, errors.New("暂不支持这个视频平台")
	}
}

/* ----------------------------------------------------------------- bilibili */

type videoQuery struct {
	kind  string // uid, video, text
	value string
	bvid  string
	aid   int64
}

func stripVideoPrefix(raw string, prefixes ...string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	lower := strings.ToLower(trimmed)
	for _, prefix := range prefixes {
		if strings.HasPrefix(lower, prefix) {
			return strings.TrimSpace(trimmed[len(prefix):]), true
		}
	}
	return trimmed, false
}

func bilibiliUID(raw string) (string, bool) {
	t := strings.TrimSpace(raw)
	if isDigits(t) {
		return t, true
	}
	lower := strings.ToLower(t)
	for _, prefix := range []string{"uid:", "uid=", "uid ", "uid"} {
		if strings.HasPrefix(lower, prefix) {
			rest := strings.TrimSpace(t[len(prefix):])
			if isDigits(rest) {
				return rest, true
			}
		}
	}
	return "", false
}

func parseBilibiliQuery(raw string) (videoQuery, bool) {
	raw, _ = stripVideoPrefix(raw, "bilibili:", "bili:", "b站:", "b站 ", "哔哩哔哩:")
	if mid := bilibiliSpaceID(raw); mid != "" {
		return videoQuery{kind: "uid", value: mid}, true
	}
	if bvid, aid := bilibiliVideoRef(raw); bvid != "" || aid > 0 {
		return videoQuery{kind: "video", bvid: bvid, aid: aid}, true
	}
	if mid, ok := bilibiliUID(raw); ok {
		return videoQuery{kind: "uid", value: mid}, true
	}
	if raw == "" {
		return videoQuery{}, false
	}
	// Anything URL-shaped is not a name to search for.
	if strings.Contains(raw, "://") || strings.Contains(raw, ".") || strings.ContainsAny(raw, " \t") {
		return videoQuery{}, false
	}
	return videoQuery{kind: "text", value: raw}, true
}

func (f *Fetcher) searchBilibiliChannels(ctx context.Context, query string) ([]model.VideoChannel, error) {
	if ref, ok := parseBilibiliQuery(query); ok {
		switch ref.kind {
		case "uid":
			channel, err := f.bilibiliChannel(ctx, ref.value)
			if err != nil {
				return nil, err
			}
			return []model.VideoChannel{*channel}, nil
		case "video":
			channel, err := f.bilibiliVideoOwner(ctx, ref.bvid, ref.aid)
			if err != nil {
				return nil, err
			}
			return []model.VideoChannel{*channel}, nil
		case "text":
			query = ref.value
		}
	}

	channels, err := f.bilibiliSearchUsers(ctx, query, 12)
	if err != nil {
		return nil, err
	}
	if len(channels) == 0 {
		return nil, fmt.Errorf("没有找到「%s」这个 B 站 UP 主，可以改用用户 UID 试试", query)
	}
	return channels, nil
}

/* ------------------------------------------------------------------ youtube */

var (
	youtubeRSSRe         = regexp.MustCompile(`https://www\.youtube\.com/feeds/videos\.xml\?channel_id=(UC[A-Za-z0-9_-]{22})`)
	youtubeChannelIDRe   = regexp.MustCompile(`"channelId":"(UC[A-Za-z0-9_-]{22})"`)
	youtubeIdentifierRe  = regexp.MustCompile(`<meta itemprop="identifier" content="(UC[A-Za-z0-9_-]{22})"`)
	youtubeOGTitleRe     = regexp.MustCompile(`<meta property="og:title" content="([^"]*)"`)
	youtubeOGImageRe     = regexp.MustCompile(`<meta property="og:image" content="([^"]*)"`)
	youtubeOGDescRe      = regexp.MustCompile(`<meta property="og:description" content="([^"]*)"`)
	youtubeCanonicalHRe  = regexp.MustCompile(`"canonicalBaseUrl":"/(@[^"]+)"`)
	youtubeChannelIDPath = regexp.MustCompile(`^UC[A-Za-z0-9_-]{22}$`)
)

func isYouTubeChannelID(raw string) bool {
	return youtubeChannelIDPath.MatchString(strings.TrimSpace(raw))
}

func youtubeFeedURL(channelID string) string {
	return "https://www.youtube.com/feeds/videos.xml?channel_id=" + url.QueryEscape(channelID)
}

type youtubeQuery struct {
	kind  string // id, handle, page, video
	value string
}

func parseYouTubeQuery(raw string) (youtubeQuery, bool) {
	trimmed, prefixed := stripVideoPrefix(raw, "youtube:", "yt:", "油管:")
	if !prefixed {
		trimmed = strings.TrimSpace(raw)
	}

	if strings.HasPrefix(trimmed, "@") && len(trimmed) > 1 {
		return youtubeQuery{kind: "handle", value: strings.TrimPrefix(trimmed, "@")}, true
	}
	if isYouTubeChannelID(trimmed) {
		return youtubeQuery{kind: "id", value: trimmed}, true
	}

	parsed, err := url.Parse(trimmed)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		// Accept a pasted address without its scheme, but only when the host
		// makes the platform unambiguous.
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "youtube.com/") || strings.HasPrefix(lower, "www.youtube.com/") ||
			strings.HasPrefix(lower, "m.youtube.com/") || strings.HasPrefix(lower, "youtu.be/") {
			parsed, err = url.Parse("https://" + trimmed)
		}
		if err != nil || parsed == nil {
			return youtubeQuery{}, false
		}
	}

	host := strings.ToLower(parsed.Hostname())
	if host == "youtu.be" {
		if id := strings.Trim(parsed.Path, "/"); id != "" {
			return youtubeQuery{kind: "video", value: id}, true
		}
		return youtubeQuery{}, false
	}
	if host != "youtube.com" && !strings.HasSuffix(host, ".youtube.com") {
		return youtubeQuery{}, false
	}

	parts := splitPath(parsed.Path)
	if len(parts) == 0 {
		return youtubeQuery{}, false
	}
	switch parts[0] {
	case "channel":
		if len(parts) > 1 && isYouTubeChannelID(parts[1]) {
			return youtubeQuery{kind: "id", value: parts[1]}, true
		}
		return youtubeQuery{kind: "page", value: parsed.String()}, true
	case "watch":
		if id := strings.TrimSpace(parsed.Query().Get("v")); id != "" {
			return youtubeQuery{kind: "video", value: id}, true
		}
		return youtubeQuery{}, false
	case "shorts", "embed", "live", "v":
		if len(parts) > 1 {
			return youtubeQuery{kind: "video", value: parts[1]}, true
		}
		return youtubeQuery{}, false
	case "c", "user":
		return youtubeQuery{kind: "page", value: parsed.String()}, true
	}
	if strings.HasPrefix(parts[0], "@") {
		return youtubeQuery{kind: "handle", value: strings.TrimPrefix(parts[0], "@")}, true
	}
	return youtubeQuery{}, false
}

func (f *Fetcher) youtubeChannel(ctx context.Context, ref youtubeQuery) (*model.VideoChannel, error) {
	switch ref.kind {
	case "id":
		return f.youtubeChannelPage(ctx, "https://www.youtube.com/channel/"+ref.value, ref.value)
	case "handle":
		return f.youtubeChannelPage(ctx, "https://www.youtube.com/@"+ref.value, "")
	case "page":
		return f.youtubeChannelPage(ctx, ref.value, "")
	case "video":
		return f.youtubeVideoOwner(ctx, ref.value)
	default:
		return nil, errors.New("无法识别这个 YouTube 频道")
	}
}

func (f *Fetcher) youtubeChannelPage(ctx context.Context, pageURL, knownID string) (*model.VideoChannel, error) {
	resp, err := f.get(ctx, pageURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, errors.New("这个 YouTube 频道不存在")
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("YouTube 返回 %d", resp.StatusCode)
	}

	body, err := readLimited(resp.Body)
	if err != nil {
		return nil, err
	}

	channelID := knownID
	if m := youtubeRSSRe.FindSubmatch(body); len(m) == 2 {
		channelID = string(m[1])
	}
	if channelID == "" {
		if m := youtubeIdentifierRe.FindSubmatch(body); len(m) == 2 {
			channelID = string(m[1])
		}
	}
	if channelID == "" {
		if m := youtubeChannelIDRe.FindSubmatch(body); len(m) == 2 {
			channelID = string(m[1])
		}
	}
	if !isYouTubeChannelID(channelID) {
		return nil, errors.New("无法从 YouTube 页面识别频道 ID")
	}

	channelURL := "https://www.youtube.com/channel/" + channelID
	channel := model.VideoChannel{
		Platform:  model.VideoPlatformYouTube,
		ID:        channelID,
		URL:       channelURL,
		FeedURL:   youtubeFeedURL(channelID),
		AvatarURL: firstSubmatchString(youtubeOGImageRe, body),
	}
	channel.Name = html.UnescapeString(firstSubmatchString(youtubeOGTitleRe, body))
	if channel.Name == "" {
		channel.Name = "YouTube 频道 " + channelID
	}
	channel.Description = html.UnescapeString(firstSubmatchString(youtubeOGDescRe, body))
	if m := youtubeCanonicalHRe.FindSubmatch(body); len(m) == 2 {
		channel.Handle = string(m[1])
	}

	return &channel, nil
}

func (f *Fetcher) youtubeVideoOwner(ctx context.Context, videoID string) (*model.VideoChannel, error) {
	watchURL := "https://www.youtube.com/watch?v=" + url.QueryEscape(videoID)
	oembed := "https://www.youtube.com/oembed?format=json&url=" + url.QueryEscape(watchURL)

	resp, err := f.get(ctx, oembed)
	if err == nil {
		defer resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode <= 299 {
			if body, rerr := readLimitedCap(resp.Body, 1<<20); rerr == nil {
				var meta struct {
					AuthorName string `json:"author_name"`
					AuthorURL  string `json:"author_url"`
				}
				if json.Unmarshal(body, &meta) == nil && meta.AuthorURL != "" {
					if ref, ok := parseYouTubeQuery(meta.AuthorURL); ok {
						channel, cerr := f.youtubeChannel(ctx, ref)
						if cerr == nil {
							return channel, nil
						}
					}
				}
			}
		}
	} else {
		f.logf("youtube oembed failed", "video", videoID, "err", err.Error())
	}

	// oEmbed is unavailable for some videos (age-restricted, live); the watch
	// page still names the owner.
	page, perr := f.get(ctx, watchURL)
	if perr != nil {
		return nil, perr
	}
	defer page.Body.Close()
	body, rerr := readLimited(page.Body)
	if rerr != nil {
		return nil, rerr
	}
	if m := youtubeChannelIDRe.FindSubmatch(body); len(m) == 2 {
		return f.youtubeChannelPage(ctx, "https://www.youtube.com/channel/"+string(m[1]), string(m[1]))
	}
	return nil, errors.New("无法识别这个 YouTube 视频的作者")
}

func (f *Fetcher) searchYouTubeChannels(ctx context.Context, query string) ([]model.VideoChannel, error) {
	query, _ = stripVideoPrefix(query, "youtube:", "yt:", "油管:")
	if ref, ok := parseYouTubeQuery(query); ok {
		channel, err := f.youtubeChannel(ctx, ref)
		if err == nil {
			return []model.VideoChannel{*channel}, nil
		}
		if ref.kind == "video" || ref.kind == "id" {
			return nil, err
		}
		// A handle or custom URL may have moved; fall through to search.
	}
	query = strings.TrimPrefix(strings.TrimSpace(query), "@")

	searchURL := "https://www.youtube.com/results?search_query=" +
		url.QueryEscape(query) + "&sp=EgIQAg%253D%253D"
	resp, err := f.get(ctx, searchURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("YouTube 返回 %d", resp.StatusCode)
	}
	body, err := readLimited(resp.Body)
	if err != nil {
		return nil, err
	}

	channels := parseYouTubeSearch(body, 8)
	if len(channels) == 0 {
		return nil, fmt.Errorf("没有找到「%s」这个 YouTube 频道", query)
	}
	return channels, nil
}

/* --------------------------------------------------------- YouTube parsing */

func firstSubmatchString(re *regexp.Regexp, body []byte) string {
	if m := re.FindSubmatch(body); len(m) == 2 {
		return strings.TrimSpace(string(m[1]))
	}
	return ""
}

// extractInitialData decodes the ytInitialData JSON blob embedded in a results
// page. A JSON decoder stops after the first complete value, so the trailing
// script text does not need to be stripped.
func extractInitialData(body []byte) (any, bool) {
	for _, marker := range [][]byte{
		[]byte("var ytInitialData = "),
		[]byte("ytInitialData = "),
	} {
		if idx := bytes.Index(body, marker); idx >= 0 {
			dec := json.NewDecoder(bytes.NewReader(body[idx+len(marker):]))
			var root any
			if err := dec.Decode(&root); err == nil {
				return root, true
			}
		}
	}
	return nil, false
}

func parseYouTubeSearch(body []byte, limit int) []model.VideoChannel {
	root, ok := extractInitialData(body)
	if !ok {
		return nil
	}

	var out []model.VideoChannel
	seen := map[string]bool{}
	var walk func(any)
	walk = func(value any) {
		switch node := value.(type) {
		case map[string]any:
			if raw, ok := node["channelRenderer"]; ok {
				if renderer, ok := raw.(map[string]any); ok {
					channel := youtubeChannelFromRenderer(renderer)
					if channel.ID != "" && !seen[channel.ID] {
						seen[channel.ID] = true
						out = append(out, channel)
					}
				}
			}
			for _, child := range node {
				walk(child)
			}
		case []any:
			for _, child := range node {
				walk(child)
			}
		}
	}
	walk(root)

	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}

func youtubeChannelFromRenderer(renderer map[string]any) model.VideoChannel {
	id, _ := renderer["channelId"].(string)
	if !isYouTubeChannelID(id) {
		return model.VideoChannel{}
	}

	channel := model.VideoChannel{
		Platform:    model.VideoPlatformYouTube,
		ID:          id,
		URL:         "https://www.youtube.com/channel/" + id,
		FeedURL:     youtubeFeedURL(id),
		Name:        textOf(renderer["title"]),
		Description: textOf(renderer["descriptionSnippet"]),
		Subscribers: parseCompactCount(textOf(renderer["subscriberCountText"])),
		AvatarURL:   thumbnailOf(renderer["thumbnail"]),
	}
	if channel.Name == "" {
		channel.Name = "YouTube 频道 " + id
	}
	return channel
}

// textOf reads YouTube's two text shapes: {"simpleText": ...} and
// {"runs": [{"text": ...}, ...]}.
func textOf(value any) string {
	node, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	if text, ok := node["simpleText"].(string); ok {
		return strings.TrimSpace(text)
	}
	runs, ok := node["runs"].([]any)
	if !ok {
		return ""
	}
	var b strings.Builder
	for _, raw := range runs {
		run, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if text, ok := run["text"].(string); ok {
			b.WriteString(text)
		}
	}
	return strings.TrimSpace(b.String())
}

func thumbnailOf(value any) string {
	node, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	thumbs, ok := node["thumbnails"].([]any)
	if !ok || len(thumbs) == 0 {
		return ""
	}
	// YouTube orders thumbnails small to large; the last one is the avatar.
	last, ok := thumbs[len(thumbs)-1].(map[string]any)
	if !ok {
		return ""
	}
	urlValue, _ := last["url"].(string)
	return urlValue
}

// parseCompactCount reads YouTube's "437M subscribers" / "1.2K" labels.
func parseCompactCount(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	fields := strings.Fields(raw)
	if len(fields) == 0 {
		return 0
	}
	number := strings.ReplaceAll(fields[0], ",", "")
	multiplier := 1.0
	switch {
	case strings.HasSuffix(number, "K"):
		multiplier, number = 1_000, strings.TrimSuffix(number, "K")
	case strings.HasSuffix(number, "M"):
		multiplier, number = 1_000_000, strings.TrimSuffix(number, "M")
	case strings.HasSuffix(number, "B"):
		multiplier, number = 1_000_000_000, strings.TrimSuffix(number, "B")
	case strings.HasSuffix(number, "万"):
		multiplier, number = 10_000, strings.TrimSuffix(number, "万")
	case strings.HasSuffix(number, "亿"):
		multiplier, number = 100_000_000, strings.TrimSuffix(number, "亿")
	}
	value, err := strconv.ParseFloat(number, 64)
	if err != nil {
		return 0
	}
	return int(value * multiplier)
}

/* ------------------------------------------------------------ feed parsing */

func isYouTubeFeedURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return (host == "youtube.com" || strings.HasSuffix(host, ".youtube.com")) &&
		strings.Contains(u.Path, "/feeds/videos.xml")
}

// youtubeChannelIDFromURL reads the channel ID from the native feed address or
// from a channel page stored by an older build / OPML import.
func youtubeChannelIDFromURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	if isYouTubeFeedURL(raw) {
		return strings.TrimSpace(u.Query().Get("channel_id"))
	}
	if ref, ok := parseYouTubeQuery(raw); ok && ref.kind == "id" {
		return ref.value
	}
	return ""
}

// enrichYouTubeMedia fills what the Atom parser leaves behind. gofeed does not
// understand media:group, which is where YouTube puts the thumbnail and
// description; without this the video tab would only show titles.
func enrichYouTubeMedia(body []byte, res *FetchResult) {
	type mediaEntry struct {
		ID    string `xml:"id"`
		Group struct {
			Title       string `xml:"title"`
			Description string `xml:"description"`
			Thumbnail   struct {
				URL string `xml:"url,attr"`
			} `xml:"thumbnail"`
		} `xml:"group"`
	}
	var doc struct {
		Entries []mediaEntry `xml:"entry"`
	}
	if err := xml.Unmarshal(body, &doc); err != nil {
		return
	}

	type media struct{ description, thumbnail string }
	byID := make(map[string]media, len(doc.Entries))
	for _, entry := range doc.Entries {
		id := strings.TrimPrefix(strings.TrimSpace(entry.ID), "yt:video:")
		if id == "" {
			continue
		}
		byID[id] = media{
			description: strings.TrimSpace(entry.Group.Description),
			thumbnail:   strings.TrimSpace(entry.Group.Thumbnail.URL),
		}
	}

	for i := range res.Items {
		id := strings.TrimPrefix(res.Items[i].GUID, "yt:video:")
		m, ok := byID[id]
		if !ok {
			continue
		}
		if res.Items[i].ImageURL == "" {
			res.Items[i].ImageURL = m.thumbnail
		}
		if res.Items[i].Summary == "" {
			res.Items[i].Summary = Truncate(m.description, 300)
		}
		if res.Items[i].Content == "" && (m.thumbnail != "" || m.description != "") {
			var b strings.Builder
			if m.thumbnail != "" {
				b.WriteString(`<p><img src="`)
				b.WriteString(html.EscapeString(m.thumbnail))
				b.WriteString(`" alt=""></p>`)
			}
			if m.description != "" {
				b.WriteString("<p>")
				b.WriteString(strings.ReplaceAll(html.EscapeString(m.description), "\n", "<br>"))
				b.WriteString("</p>")
			}
			res.Items[i].Content = b.String()
		}
	}
}

/* -------------------------------------------------------------- discovery */

// resolveVideoDiscovery recognises channel/video inputs before the generic
// website discovery runs. handled is false when the input is an ordinary site,
// so Discover can continue as usual.
func (f *Fetcher) resolveVideoDiscovery(ctx context.Context, raw string) (candidates []model.DiscoveredFeed, handled bool, err error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, false, nil
	}

	lower := strings.ToLower(trimmed)
	explicitBilibili := strings.HasPrefix(lower, "bilibili:") || strings.HasPrefix(lower, "bili:") ||
		strings.HasPrefix(lower, "b站:") || strings.HasPrefix(lower, "哔哩哔哩:")
	explicitYouTube := strings.HasPrefix(lower, "youtube:") || strings.HasPrefix(lower, "yt:") ||
		strings.HasPrefix(lower, "油管:")

	if explicitBilibili {
		channels, err := f.searchBilibiliChannels(ctx, trimmed)
		if err != nil {
			return nil, true, err
		}
		return channelsToDiscovered(channels), true, nil
	}
	if explicitYouTube {
		channels, err := f.searchYouTubeChannels(ctx, trimmed)
		if err != nil {
			return nil, true, err
		}
		return channelsToDiscovered(channels), true, nil
	}

	if mid := bilibiliSpaceID(trimmed); mid != "" {
		channel, err := f.bilibiliChannel(ctx, mid)
		if err != nil {
			return nil, true, err
		}
		return channelsToDiscovered([]model.VideoChannel{*channel}), true, nil
	}
	if bvid, aid := bilibiliVideoRef(trimmed); bvid != "" || aid > 0 {
		channel, err := f.bilibiliVideoOwner(ctx, bvid, aid)
		if err != nil {
			return nil, true, err
		}
		return channelsToDiscovered([]model.VideoChannel{*channel}), true, nil
	}
	// A bare number is a Bilibili UID. A bare domain is not: that may be a
	// hostname without dots only in local networks, where generic discovery is
	// still the better answer.
	if isDigits(trimmed) {
		channel, err := f.bilibiliChannel(ctx, trimmed)
		if err != nil {
			return nil, true, err
		}
		return channelsToDiscovered([]model.VideoChannel{*channel}), true, nil
	}
	if mid, ok := bilibiliUID(trimmed); ok {
		channel, err := f.bilibiliChannel(ctx, mid)
		if err != nil {
			return nil, true, err
		}
		return channelsToDiscovered([]model.VideoChannel{*channel}), true, nil
	}

	if ref, ok := parseYouTubeQuery(trimmed); ok {
		channel, err := f.youtubeChannel(ctx, ref)
		if err != nil {
			// A pasted handle or video is an explicit request; report the
			// failure instead of falling back to "no feed on this page".
			return nil, true, err
		}
		return channelsToDiscovered([]model.VideoChannel{*channel}), true, nil
	}

	return nil, false, nil
}

func channelsToDiscovered(channels []model.VideoChannel) []model.DiscoveredFeed {
	out := make([]model.DiscoveredFeed, 0, len(channels))
	for _, channel := range channels {
		out = append(out, model.DiscoveredFeed{
			Title:   channel.Name,
			URL:     channel.FeedURL,
			Type:    channel.Platform,
			IsFeed:  true,
			SiteURL: channel.URL,
		})
	}
	return out
}
