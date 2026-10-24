package feed

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/andybalholm/cascadia"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// commentContainerSelectors are tried in order. They cover the shapes used by
// the common self-hosted comment systems (WordPress, Ghost, Hugo themes,
// Discourse embeds), the large Chinese platforms, and generic id/class naming.
var commentContainerSelectors = []string{
	// Specific, high-confidence containers first.
	"#comments",
	"#comment-list",
	"ol.comment-list",
	".comment-list",
	".comments-area",
	".comment-section",
	".comment-tree",
	".blog_comment_body",
	".feedbackItem",
	".topic-post",
	".reply_content",
	"#disqus_thread",
	// Platform shells: present even when the items themselves are loaded by
	// script, which is what makes a precise "found but empty" diagnosis
	// possible instead of a misleading "not found".
	".post__comments",
	".comments__feed",
	"[class*=post__comments]",
	"[class*=comments__feed]",
	"[class*=community__comment]",
	// Generic fallbacks.
	".comments",
	"[id*=comment]",
	"[class*=comment-list]",
	"[class*=comment-section]",
	"[class*=comments]",
	"[data-testid*=comment]",
}

// commentItemSelectors identify individual comments, used to count them.
var commentItemSelectors = []string{
	".comment",
	".comment-item",
	".comment-body",
	"li.comment",
	"article.comment",
	".comtr",             // Hacker News comment rows
	".blog_comment_body", // cnblogs
	".topic-post",        // Discourse
	".reply_content",
	"[class*=comment-item]",
	"[class*=comment-body]",
	"[class*=comment__content]",
	"[itemprop=comment]",
}

// CommentCandidate describes one node that looks like it could hold comments.
// It exists so a failed extraction can be explained with evidence rather than
// guessed at.
type CommentCandidate struct {
	Tag        string `json:"tag"`
	Class      string `json:"class"`
	ID         string `json:"id"`
	TextLength int    `json:"textLength"`
	Children   int    `json:"children"`
	ItemCount  int    `json:"itemCount"`
	Score      int    `json:"score"`
}

// AnalyzeComments reports every element whose class or id mentions "comment",
// with the metrics the extractor scores them by. This is what distinguishes
// "the comments are not in this response" from "our selectors do not recognise
// this markup".
func AnalyzeComments(page []byte) ([]CommentCandidate, error) {
	doc, err := html.Parse(bytes.NewReader(page))
	if err != nil {
		return nil, fmt.Errorf("could not parse the page: %w", err)
	}

	var out []CommentCandidate
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			cls := attrValue(n, "class")
			id := attrValue(n, "id")
			if strings.Contains(strings.ToLower(cls+" "+id), "comment") {
				text := strings.TrimSpace(PlainText(renderChildren(n)))
				out = append(out, CommentCandidate{
					Tag:        n.Data,
					Class:      truncateText(cls, 70),
					ID:         id,
					TextLength: len([]rune(text)),
					Children:   childElementCount(n),
					ItemCount:  countComments(n),
					Score:      scoreCommentContainer(n),
				})
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)

	sort.SliceStable(out, func(i, j int) bool { return out[i].TextLength > out[j].TextLength })
	if len(out) > 25 {
		out = out[:25]
	}
	return out, nil
}

func attrValue(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if strings.EqualFold(a.Key, key) {
			return a.Val
		}
	}
	return ""
}

func childElementCount(n *html.Node) int {
	count := 0
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode {
			count++
		}
	}
	return count
}

func truncateText(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

// ExtractComments finds the comment thread on an article page and returns it
// as sanitised HTML plus an approximate comment count.
//
// This is a heuristic: sites that render comments client-side (Disqus, Livefyre,
// most React comment widgets) leave nothing in the served HTML, in which case
// this reports that clearly rather than returning an empty section.
func ExtractComments(page []byte, pageURL string) (string, int, error) {
	doc, err := html.Parse(bytes.NewReader(page))
	if err != nil {
		return "", 0, fmt.Errorf("could not parse the page: %w", err)
	}

	// Short-circuit the classic client-side-only case so the user gets a
	// useful explanation instead of a silently empty section.
	if hasDisqusLoader(doc) && casadiaCount(doc, "#disqus_thread") == 0 {
		return "", 0, fmt.Errorf("这篇的评论由第三方服务加载，暂时取不到")
	}

	var (
		best      *html.Node
		bestScore int
		// The best node found by the platform-shell selectors, even when it
		// turns out to hold no comments. Its presence distinguishes "this site
		// renders comments elsewhere" from "this page has no comments at all",
		// which is logged for diagnosis even though the UI stays plain.
		shell *html.Node
	)

	for _, selector := range commentContainerSelectors {
		matcher, err := cascadia.Compile(selector)
		if err != nil {
			continue
		}
		for _, node := range cascadia.QueryAll(doc, matcher) {
			score := scoreCommentContainer(node)
			if score > bestScore {
				best, bestScore = node, score
			}
			if shell == nil && classAttr(node) != "" {
				shell = node
			}
		}
		// The first selector that yields a convincing container wins; later
		// selectors are progressively looser and would only add noise.
		if bestScore >= 40 {
			break
		}
	}

	if best != nil && bestScore >= 12 {
		// Mark the individual comments so they render with the app's styling.
		tagCommentItems(best)
		inner := renderChildren(best)
		clean := SanitizeHTML(inner)
		visible := visibleText(best)
		// A container whose rendered text is a template, or is barely there, is
		// not a thread — and rendering `{{content}}` at the reader would be
		// worse than reporting nothing.
		if strings.TrimSpace(PlainText(clean)) != "" && !looksLikeTemplateText(visible) &&
			len([]rune(visible)) >= 30 {
			// Comment markup is full of relative image and permalink paths;
			// resolve them so avatars and links actually work.
			clean = ResolveRelativeURLs(clean, pageURL)
			count := countComments(best)
			if count == 0 {
				// The container holds a real thread but this site names its
				// comment elements in a way the item selectors do not know.
				// A structural estimate keeps the content: the count is only a
				// badge, whereas returning zero used to discard the thread and
				// report "no comments".
				count = estimateCommentCount(best)
			}
			return clean, count, nil
		}
	}

	// Nothing usable. The distinction is kept for the debug log rather than the
	// UI: a page that ships a comment shell renders its comments elsewhere,
	// usually behind a login, and that is not something the reader can act on.
	if shell != nil {
		return "", 0, fmt.Errorf("这篇的评论需要登录后才能查看")
	}
	return "", 0, fmt.Errorf("这篇没有可获取的评论")
}

// estimateCommentCount counts thread entries by shape, for sites whose comment
// elements the item selectors do not recognise.
//
// It counts comment-ish elements that actually carry text — or that contain
// prose — and skips any nested inside another such element, so a wrapper and
// its children are counted once. It is deliberately conservative: one entry
// means "there is a thread here", which is what the caller needs to keep it.
func estimateCommentCount(root *html.Node) int {
	looksLikeEntry := func(n *html.Node) bool {
		hay := strings.ToLower(attrValue(n, "class") + " " + attrValue(n, "id"))
		if !strings.Contains(hay, "comment") {
			return false
		}
		// Buttons, icons and editors are chrome, not entries.
		for _, noise := range []string{"btn", "button", "like", "share", "report", "reply",
			"close", "icon", "tmpl", "editor", "form", "input", "more", "sort", "count"} {
			if strings.Contains(hay, noise) {
				return false
			}
		}
		if len([]rune(strings.TrimSpace(PlainText(renderChildren(n))))) < 20 {
			return false
		}
		// An entry usually wraps paragraphs or a block of text.
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.ElementNode && (c.DataAtom == atom.P || c.DataAtom == atom.Div) {
				return true
			}
		}
		return false
	}

	count := 0
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && looksLikeEntry(n) {
			count++
			// Do not descend: children belong to this entry.
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	for c := root.FirstChild; c != nil; c = c.NextSibling {
		walk(c)
	}
	if count == 0 {
		return 1
	}
	return count
}

// classAttr returns an element's class attribute, truncated for messages.
func classAttr(n *html.Node) string {
	for _, a := range n.Attr {
		if strings.EqualFold(a.Key, "class") {
			cls := strings.TrimSpace(a.Val)
			if len(cls) > 60 {
				cls = cls[:60] + "…"
			}
			return cls
		}
	}
	return ""
}

// scoreCommentContainer estimates how likely a node is to be the comment list.
// It rewards comment-shaped descendants and, more weakly, text volume, and it
// penalises containers that are clearly the whole page.
// visibleText returns the text a reader would actually see inside n, skipping
// non-rendered subtrees.
//
// Client-side comment templates are routinely shipped inside
// `<script type="text/html">` (数字尾巴 does exactly this). That text is not
// content: counting it inflates a container's score and, worse, can win the
// selection and render literal `{{content}}` placeholders as a "thread".
func visibleText(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(x *html.Node) {
		switch x.Type {
		case html.TextNode:
			b.WriteString(x.Data)
			return
		case html.ElementNode:
			switch x.DataAtom {
			case atom.Script, atom.Style, atom.Template, atom.Noscript, atom.Iframe:
				return
			}
		}
		for c := x.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return strings.Join(strings.Fields(b.String()), " ")
}

// looksLikeTemplateText reports whether text is a client-side template rather
// than prose.
func looksLikeTemplateText(text string) bool {
	return strings.Contains(text, "{{") && strings.Contains(text, "}}")
}

// scoreCommentContainer estimates how likely a node is to be the comment list.
// It rewards comment-shaped descendants and, more weakly, text volume, and it
// penalises containers that are clearly the whole page.
func scoreCommentContainer(n *html.Node) int {
	score := 0

	for _, selector := range commentItemSelectors {
		matcher, err := cascadia.Compile(selector)
		if err != nil {
			continue
		}
		score += len(cascadia.QueryAll(n, matcher)) * 12
	}

	// Comment-shaped class or id on the container itself.
	if attrContains(n, "id", "comment") || attrContains(n, "class", "comment") {
		score += 10
	}

	// A real comment thread has a reasonable amount of text but is not the
	// entire document. Only rendered text counts: template markup in a script
	// tag must not make an empty container look full.
	text := visibleText(n)
	textLen := len([]rune(text))
	if looksLikeTemplateText(text) {
		score -= 40
	}
	switch {
	case textLen > 40000:
		score -= 60
	case textLen > 400:
		score += 8
	case textLen < 80:
		score -= 20
	}

	return score
}

// countComments counts comment-shaped nodes, preferring leaf-most matches so a
// wrapper and its inner body are not counted twice.
// tagCommentItems marks each comment in a container with the app's own class.
//
// Sites name their comment elements inconsistently, and their own class names
// are stripped by the sanitiser, so without this the extracted thread would
// render unstyled. Marking them makes the HTML layer and the JSON-API layer
// share one look.
func tagCommentItems(root *html.Node) {
	var matchers []cascadia.Selector
	for _, selector := range commentItemSelectors {
		if m, err := cascadia.Compile(selector); err == nil {
			matchers = append(matchers, m)
		}
	}
	matchIndex := func(n *html.Node) int {
		for i, m := range matchers {
			if m.Match(n) {
				return i
			}
		}
		return -1
	}

	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			if idx := matchIndex(n); idx >= 0 {
				subPart := false
				for p := n.Parent; p != nil && p != root.Parent; p = p.Parent {
					if pIdx := matchIndex(p); pIdx >= 0 && pIdx < idx {
						subPart = true
						break
					}
				}
				if !subPart {
					setClass(n, "comment")
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(root)
}

// setClass replaces an element's class attribute.
func setClass(n *html.Node, class string) {
	for i, a := range n.Attr {
		if strings.EqualFold(a.Key, "class") {
			n.Attr[i].Val = class
			return
		}
	}
	n.Attr = append(n.Attr, html.Attribute{Key: "class", Val: class})
}

// countComments counts the comments inside a container.
//
// An element is counted when it matches a comment-item selector and no ancestor
// matched an *earlier* (more specific) selector. That single rule handles both
// shapes correctly:
//
//   - `<li class="comment"><div class="comment-body">…` is one comment: the
//     inner div matches a later selector than its ancestor, so it is skipped.
//   - a reply nested inside another `.comment` matches the same selector as its
//     ancestor, so it is counted, as is the top-level comment that holds it.
func countComments(root *html.Node) int {
	var matchers []cascadia.Selector
	for _, selector := range commentItemSelectors {
		if m, err := cascadia.Compile(selector); err == nil {
			matchers = append(matchers, m)
		}
	}

	// matchIndex reports the first selector that matches, or -1.
	matchIndex := func(n *html.Node) int {
		for i, m := range matchers {
			if m.Match(n) {
				return i
			}
		}
		return -1
	}

	count := 0
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			if idx := matchIndex(n); idx >= 0 {
				subPart := false
				for p := n.Parent; p != nil && p != root.Parent; p = p.Parent {
					if pIdx := matchIndex(p); pIdx >= 0 && pIdx < idx {
						subPart = true
						break
					}
				}
				if !subPart {
					count++
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(root)

	if count == 0 {
		// Fall back to counting direct list items, which is what most
		// hand-rolled comment lists use.
		li, _ := cascadia.Compile("li, article")
		count = len(cascadia.QueryAll(root, li))
	}
	return count
}

// FetchComments returns an article's comment thread.
//
// Two strategies, in order of cost:
//
//  1. Extract the comments from the served HTML. This is cheap and covers
//     every server-rendered comment system.
//  2. If the page only ships a comment shell, discover the site's own public
//     comment API (see commentapi.go) and read the comments from there.
//
// Both are anonymous: the app only performs plain GETs on endpoints that the
// site's own markup and scripts refer to.
func (f *Fetcher) FetchComments(ctx context.Context, pageURL string) (string, int, error) {
	if strings.TrimSpace(pageURL) == "" {
		return "", 0, fmt.Errorf("这篇没有原文链接，无法获取评论")
	}
	parsed, err := url.Parse(pageURL)
	if err != nil || parsed.Host == "" {
		return "", 0, fmt.Errorf("%q 不是有效的链接", pageURL)
	}

	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()

	// Bilibili video pages are client-rendered, so the generic HTML/API
	// discovery below would always come up empty. Read the thread from the
	// platform's own reply API instead.
	if bvid, aid := bilibiliVideoRef(pageURL); bvid != "" || aid > 0 {
		htmlText, count, err := f.fetchBilibiliComments(ctx, parsed)
		if err != nil {
			f.logf("bilibili comments failed", "url", pageURL, "err", err.Error())
			return "", 0, err
		}
		if count == 0 {
			return "", 0, nil
		}
		return f.InlineCommentImages(ctx, htmlText, pageURL), count, nil
	}

	status, _, body, err := f.fetchBody(ctx, pageURL, func(ctx context.Context) (*http.Request, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", userAgent)
		req.Header.Set("Accept", "text/html,application/xhtml+xml")
		req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
		return req, nil
	})
	if err != nil {
		return "", 0, friendlyNetErr(err)
	}
	if status < 200 || status > 299 {
		return "", 0, fmt.Errorf("服务器返回 %d", status)
	}

	htmlText, count, htmlErr := ExtractComments(body, pageURL)
	// Non-empty HTML means a thread was found, even if the count is only an
	// estimate: discarding it would report "no comments" for a page that has
	// them.
	if htmlErr == nil && strings.TrimSpace(htmlText) != "" {
		// Avatars are hotlink-protected on many sites, so the bytes are fetched
		// here — with the article as Referer — and inlined.
		return f.InlineCommentImages(ctx, htmlText, pageURL), count, nil
	}

	// The HTML had nothing usable. Try the site's own API before giving up.
	apiHTML, apiCount, apiErr := f.fetchCommentsViaAPI(ctx, parsed, body)
	if apiErr == nil {
		if apiCount > 0 {
			return f.InlineCommentImages(ctx, apiHTML, pageURL), apiCount, nil
		}
		// The API answered and the thread is genuinely empty. That is not a
		// failure: reporting "no comment section found" here would be wrong,
		// and the caller turns a zero count into "this article has no comments".
		return "", 0, nil
	}

	// Report the most informative of the two failures: an HTML diagnosis that
	// names the container tells the user more than a generic API miss.
	if htmlErr != nil {
		return "", 0, htmlErr
	}
	return "", 0, apiErr
}

/* --------------------------------------------------------------- helpers */

// renderChildren serialises the children of a node back to HTML.
func renderChildren(n *html.Node) string {
	var b strings.Builder
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if err := html.Render(&b, c); err != nil {
			return b.String()
		}
	}
	return b.String()
}

func attrContains(n *html.Node, key, needle string) bool {
	for _, a := range n.Attr {
		if strings.EqualFold(a.Key, key) && strings.Contains(strings.ToLower(a.Val), needle) {
			return true
		}
	}
	return false
}

func casadiaCount(n *html.Node, selector string) int {
	m, err := cascadia.Compile(selector)
	if err != nil {
		return 0
	}
	return len(cascadia.QueryAll(n, m))
}

// hasDisqusLoader reports whether the page defers its comments to Disqus,
// which is only rendered client-side.
func hasDisqusLoader(doc *html.Node) bool {
	found := false
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if found {
			return
		}
		if n.Type == html.ElementNode {
			if n.DataAtom == atom.Script {
				if strings.Contains(strings.ToLower(nodeText(n)), "disqus") {
					found = true
					return
				}
			}
			if attrContains(n, "id", "disqus") {
				found = true
				return
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return found
}

func nodeText(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(x *html.Node) {
		if x.Type == html.TextNode {
			b.WriteString(x.Data)
		}
		for c := x.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return b.String()
}
