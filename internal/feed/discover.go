package feed

import (
	"bytes"
	"net/url"
	"strings"

	"reads/internal/model"
	"reads/internal/store"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// discoverFromHTML extracts feed references from a page's <link rel="alternate">
// elements, which is how virtually every site advertises its feeds.
func discoverFromHTML(body []byte, base *url.URL) []model.DiscoveredFeed {
	doc, err := html.Parse(bytes.NewReader(body))
	if err != nil {
		return nil
	}

	var out []model.DiscoveredFeed
	seen := map[string]bool{}

	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.DataAtom == atom.Link {
			var rel, typ, href, title string
			for _, a := range n.Attr {
				switch strings.ToLower(a.Key) {
				case "rel":
					rel = strings.ToLower(a.Val)
				case "type":
					typ = strings.ToLower(strings.TrimSpace(a.Val))
				case "href":
					href = strings.TrimSpace(a.Val)
				case "title":
					title = strings.TrimSpace(a.Val)
				}
			}
			isAlternate := false
			for _, part := range strings.Fields(rel) {
				if part == "alternate" {
					isAlternate = true
				}
			}
			if isAlternate && isFeedType(typ) && href != "" {
				if resolved := resolveRef(base, href); resolved != "" && !seen[resolved] {
					seen[resolved] = true
					if title == "" {
						title = base.Hostname()
					}
					out = append(out, model.DiscoveredFeed{
						Title:   title,
						URL:     resolved,
						Type:    typ,
						IsFeed:  true,
						SiteURL: base.String(),
					})
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return out
}

func isFeedType(typ string) bool {
	switch {
	case strings.Contains(typ, "rss"),
		strings.Contains(typ, "atom"),
		strings.Contains(typ, "feed+json"),
		strings.Contains(typ, "jsonfeed"):
		return true
	}
	return false
}

// resolveRef turns a possibly relative href into an absolute URL.
func resolveRef(base *url.URL, href string) string {
	ref, err := url.Parse(href)
	if err != nil {
		return ""
	}
	abs := base.ResolveReference(ref)
	if abs.Scheme != "http" && abs.Scheme != "https" {
		return ""
	}
	return abs.String()
}

// socialHosts are domains whose feeds are conversational rather than
// article-shaped, so their entries belong in the "Social" tab.
var socialHosts = []string{
	"twitter.com", "x.com", "nitter.", "mastodon.", "misskey.", "pleroma.",
	"bsky.app", "bluesky", "weibo.com", "threads.net", "tumblr.com",
	"pixelfed.", "lemmy.", "reddit.com", "micro.blog",
	"zhihu.com", "douban.com",
}

// videoHosts publish clips rather than articles: their feeds belong in the
// "Videos" tab even when an entry's text reads like a blog post. Bilibili is the
// case asked for most often.
var videoHosts = []string{
	"bilibili.com", "b23.tv", "youtube.com", "youtu.be", "vimeo.com",
	"douyin.com", "tiktok.com", "nicovideo.jp", "twitch.tv",
}

// audioHosts are podcast platforms: their feeds are shows, so the "Audio" tab.
var audioHosts = []string{
	"podcasts.apple.com", "anchor.fm", "xiaoyuzhoufm.com", "ximalaya.com",
	"podcasts.google.com", "overcast.fm", "castbox.fm", "pca.st",
	"spotify.com/show", "podbean.com", "buzzsprout.com", "libsyn.com",
	"fireside.fm", "transistor.fm", "captivate.fm",
}

func matchesAnyHost(lower string, hosts []string) bool {
	for _, h := range hosts {
		if strings.Contains(lower, h) {
			return true
		}
	}
	return false
}

// ClassifyURL returns the tab implied by the feed's own address, or "" when the
// address says nothing useful.
//
// It exists separately from Classify so subscriptions saved before a rule
// existed can be reclassified at startup without refetching them.
func ClassifyURL(feedURL string) string {
	lower := strings.ToLower(feedURL)
	switch {
	case matchesAnyHost(lower, videoHosts):
		return model.ViewVideos
	case matchesAnyHost(lower, audioHosts):
		return model.ViewAudio
	case matchesAnyHost(lower, socialHosts):
		return model.ViewSocial
	default:
		return ""
	}
}

// Classify decides which timeline tab a feed belongs to. The heuristics are
// deliberately conservative: anything ambiguous stays in "Articles".
func Classify(feedURL string, items []store.FeedItem) string {
	if byURL := ClassifyURL(feedURL); byURL != "" {
		return byURL
	}
	if len(items) == 0 {
		return model.ViewArticles
	}

	mediaOnly, videos, audio := 0, 0, 0
	for _, it := range items {
		content := strings.ToLower(it.Content)
		textLen := len([]rune(PlainText(it.Content)))
		if strings.Contains(content, "<img") && textLen < 140 {
			mediaOnly++
		}
		if strings.Contains(content, "<video") {
			videos++
		}
		if it.AudioURL != "" || strings.Contains(content, "<audio") {
			audio++
		}
	}

	// Audio before video: podcast show notes often embed a player, while a
	// podcast feed is recognisable by its <audio> elements.
	if audio*2 >= len(items) {
		return model.ViewAudio
	}
	if videos*2 >= len(items) {
		return model.ViewVideos
	}
	if mediaOnly*2 >= len(items) {
		return model.ViewPictures
	}
	return model.ViewArticles
}
