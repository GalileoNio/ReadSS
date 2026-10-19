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
	"pixelfed.", "lemmy.", "reddit.com", "micro.blog", "bilibili.com",
	"zhihu.com", "douban.com",
}

// Classify decides which timeline tab a feed belongs to. The heuristics are
// deliberately conservative: anything ambiguous stays in "Articles".
func Classify(feedURL string, items []store.FeedItem) string {
	lower := strings.ToLower(feedURL)
	for _, h := range socialHosts {
		if strings.Contains(lower, h) {
			return model.ViewSocial
		}
	}
	if len(items) == 0 {
		return model.ViewArticles
	}

	mediaOnly, hasVideo := 0, 0
	for _, it := range items {
		content := strings.ToLower(it.Content)
		textLen := len([]rune(PlainText(it.Content)))
		if strings.Contains(content, "<img") && textLen < 140 {
			mediaOnly++
		}
		if strings.Contains(content, "<video") || strings.Contains(content, "<audio") {
			hasVideo++
		}
	}

	if hasVideo*2 >= len(items) {
		return model.ViewVideos
	}
	if mediaOnly*2 >= len(items) {
		return model.ViewPictures
	}
	return model.ViewArticles
}
