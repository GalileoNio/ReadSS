package feed

import (
	"net/url"
	"regexp"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// allowedTags is the allowlist of elements kept in feed-supplied HTML.
//
// Feed content is rendered inside a WebView that has access to the Go
// bindings, so untrusted markup is sanitised on the way in rather than
// trusted on the way out.
var allowedTags = map[atom.Atom]bool{
	atom.A: true, atom.Abbr: true, atom.B: true, atom.Blockquote: true,
	atom.Br: true, atom.Caption: true, atom.Cite: true, atom.Code: true,
	atom.Col: true, atom.Colgroup: true, atom.Dd: true, atom.Del: true,
	atom.Details: true, atom.Div: true, atom.Dl: true, atom.Dt: true,
	atom.Em: true, atom.Figcaption: true, atom.Figure: true, atom.H1: true,
	atom.H2: true, atom.H3: true, atom.H4: true, atom.H5: true, atom.H6: true,
	atom.Hr: true, atom.I: true, atom.Img: true, atom.Ins: true,
	atom.Kbd: true, atom.Li: true, atom.Mark: true, atom.Ol: true,
	atom.P: true, atom.Picture: true, atom.Pre: true, atom.Q: true,
	atom.S: true, atom.Samp: true, atom.Section: true, atom.Small: true,
	atom.Source: true, atom.Span: true, atom.Strong: true, atom.Sub: true,
	atom.Summary: true, atom.Sup: true, atom.Table: true, atom.Tbody: true,
	atom.Td: true, atom.Tfoot: true, atom.Th: true, atom.Thead: true,
	atom.Time: true, atom.Tr: true, atom.U: true, atom.Ul: true,
	atom.Var: true, atom.Video: true, atom.Audio: true,
}

// allowedAttrs maps each tag to the attributes that may survive sanitisation.
var allowedAttrs = map[atom.Atom]map[string]bool{
	atom.A:        {"href": true, "title": true},
	atom.Img:      {"src": true, "alt": true, "title": true, "width": true, "height": true},
	atom.Source:   {"src": true, "srcset": true, "type": true, "media": true},
	atom.Video:    {"src": true, "poster": true, "controls": true, "width": true, "height": true},
	atom.Audio:    {"src": true, "controls": true},
	atom.Time:     {"datetime": true},
	atom.Td:       {"colspan": true, "rowspan": true},
	atom.Th:       {"colspan": true, "rowspan": true},
	atom.Col:      {"span": true},
	atom.Colgroup: {"span": true},
}

// dropContent lists elements whose *contents* must also be discarded, as
// opposed to unwrapped (keeping children) or removed.
var dropContent = map[atom.Atom]bool{
	atom.Script: true, atom.Style: true, atom.Iframe: true, atom.Object: true,
	atom.Embed: true, atom.Form: true, atom.Input: true, atom.Button: true,
	atom.Select: true, atom.Textarea: true, atom.Link: true, atom.Meta: true,
	atom.Noscript: true, atom.Template: true, atom.Svg: true, atom.Canvas: true,
	atom.Map: true, atom.Area: true, atom.Base: true, atom.Title: true,
}

// allowedClasses are the class tokens that may survive sanitisation. They are
// the ones this app's own markup uses, plus the scroll wrapper the sanitiser
// inserts around wide tables, so extracted comments and articles keep the
// styling they are given without letting a feed inject arbitrary app classes.
var allowedClasses = map[string]bool{
	// Comment markup generated when comments come from a site's JSON API.
	"comment":          true,
	"comment-author":   true,
	"comment-meta":     true,
	"comment-badge":    true,
	"comment__content": true,
	"comment--api":     true,
	"avatar":           true,
	"avatar--text":     true,
	// Article helpers.
	"table-scroll": true,
}

// filterClasses keeps only the allow-listed class tokens from a class attribute.
func filterClasses(value string) string {
	fields := strings.Fields(value)
	kept := make([]string, 0, len(fields))
	for _, f := range fields {
		if allowedClasses[f] {
			kept = append(kept, f)
		}
	}
	return strings.Join(kept, " ")
}

// avatarStyleRe matches exactly the one inline style this app emits: the
// deterministic avatar gradient. Anything else — including every style a feed
// might supply — is dropped. DESIGN.md §1.5.
var avatarStyleRe = regexp.MustCompile(
	`^background:\s*linear-gradient\(135deg, hsl\([0-9]{1,3} 62% 52%\), hsl\([0-9]{1,3} 58% 42%\)\)$`)

// filterStyle keeps an inline style only when it is the avatar gradient.
func filterStyle(value string) string {
	if v := strings.TrimSpace(value); avatarStyleRe.MatchString(v) {
		return v
	}
	return ""
}

// filterInitial keeps the single-character label an avatar fallback renders via
// content: attr(data-initial). Without this the fallback would be an empty
// coloured circle, because no other data-* attribute is allowed through.
func filterInitial(value string) string {
	v := strings.TrimSpace(value)
	runes := []rune(v)
	if len(runes) == 0 || len(runes) > 4 {
		return ""
	}
	for _, r := range runes {
		if r < 0x20 || r == 0x7f || r == '"' || r == '\'' || r == '<' || r == '>' || r == '&' {
			return ""
		}
	}
	return v
}

// ResolveRelativeURLs rewrites relative src/href/poster attributes against a
// base URL.
//
// Comment APIs and article pages routinely return paths like
// `2025/01/02/avatar/abc.png` or `/uploads/x.jpg`. Left relative, they resolve
// against the app's own origin and render as broken images. This must run
// *after* sanitisation, so only already-approved URLs are rewritten.
func ResolveRelativeURLs(fragment, base string) string {
	if fragment == "" || base == "" {
		return fragment
	}
	baseURL, err := url.Parse(base)
	if err != nil || baseURL.Host == "" {
		return fragment
	}

	ctx := &html.Node{Type: html.ElementNode, Data: "div", DataAtom: atom.Div}
	nodes, err := html.ParseFragment(strings.NewReader(fragment), ctx)
	if err != nil || len(nodes) == 0 {
		return fragment
	}

	var rewrite func(*html.Node)
	rewrite = func(n *html.Node) {
		if n.Type == html.ElementNode {
			for i, a := range n.Attr {
				switch strings.ToLower(a.Key) {
				case "src", "href", "poster":
				default:
					continue
				}
				val := strings.TrimSpace(a.Val)
				if val == "" || strings.HasPrefix(val, "#") || strings.HasPrefix(val, "data:") {
					continue
				}
				ref, err := url.Parse(val)
				if err != nil || ref.IsAbs() || ref.Host != "" {
					continue
				}
				n.Attr[i].Val = baseURL.ResolveReference(ref).String()
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			rewrite(c)
		}
	}

	var b strings.Builder
	for _, n := range nodes {
		rewrite(n)
		if err := html.Render(&b, n); err != nil {
			return fragment
		}
	}
	return b.String()
}

// SanitizeHTML cleans a fragment of feed-supplied HTML.
func SanitizeHTML(input string) string {
	if strings.TrimSpace(input) == "" {
		return ""
	}

	ctx := &html.Node{Type: html.ElementNode, Data: "div", DataAtom: atom.Div}
	nodes, err := html.ParseFragment(strings.NewReader(input), ctx)
	if err != nil || len(nodes) == 0 {
		return ""
	}

	var b strings.Builder
	for _, n := range nodes {
		sanitizeNode(&b, n)
	}
	return strings.TrimSpace(b.String())
}

func sanitizeNode(b *strings.Builder, n *html.Node) {
	switch n.Type {
	case html.TextNode:
		b.WriteString(html.EscapeString(n.Data))
		return
	case html.CommentNode, html.DoctypeNode, html.ErrorNode:
		return
	case html.DocumentNode:
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			sanitizeNode(b, c)
		}
		return
	}

	if dropContent[n.DataAtom] {
		return
	}

	if !allowedTags[n.DataAtom] {
		// Unknown but harmless container: keep its children, drop the wrapper.
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			sanitizeNode(b, c)
		}
		return
	}

	// Tables are the one element whose intrinsic width a stylesheet cannot
	// reliably cap: a table refuses to shrink below its min-content width, so
	// a wide one would push the reader pane past the window. Each table is
	// therefore wrapped in a scroll container, which keeps the overflow inside
	// the article. The wrapper must open *before* <table>, not inside it.
	wrapped := n.DataAtom == atom.Table
	if wrapped {
		b.WriteString(`<div class="table-scroll">`)
	}

	tag := n.Data
	b.WriteString("<" + tag)
	allowed := allowedAttrs[n.DataAtom]
	safeURL := true
	for _, a := range n.Attr {
		key := strings.ToLower(a.Key)
		if strings.HasPrefix(key, "on") {
			continue
		}
		// `class` is handled separately: dropping it entirely would leave the
		// comment markup this app generates unstyled, while passing feed-
		// supplied classes through would let a page borrow the app's own
		// classes and disturb the layout. Only known-safe tokens survive.
		if key == "class" {
			if cls := filterClasses(a.Val); cls != "" {
				b.WriteString(` class="` + html.EscapeString(cls) + `"`)
			}
			continue
		}
		// `style` is likewise restricted to the single declaration this app
		// generates, so no feed can restyle the reader chrome.
		if key == "style" {
			if style := filterStyle(a.Val); style != "" {
				b.WriteString(` style="` + html.EscapeString(style) + `"`)
			}
			continue
		}
		// The avatar fallback's label, painted by CSS.
		if key == "data-initial" {
			if initial := filterInitial(a.Val); initial != "" {
				b.WriteString(` data-initial="` + html.EscapeString(initial) + `"`)
			}
			continue
		}
		if !allowed[key] {
			continue
		}
		val := a.Val
		if key == "href" || key == "src" || key == "poster" {
			if !isSafeURL(val) {
				safeURL = false
				continue
			}
		}
		b.WriteString(` ` + key + `="` + html.EscapeString(val) + `"`)
	}
	// Outbound links always open in the user's browser, never in the app frame.
	if n.DataAtom == atom.A && safeURL {
		b.WriteString(` target="_blank" rel="noopener noreferrer nofollow"`)
	}
	b.WriteString(">")

	if void := n.DataAtom == atom.Img || n.DataAtom == atom.Br ||
		n.DataAtom == atom.Hr || n.DataAtom == atom.Source; void {
		return
	}

	for c := n.FirstChild; c != nil; c = c.NextSibling {
		sanitizeNode(b, c)
	}
	b.WriteString("</" + tag + ">")
	if wrapped {
		b.WriteString(`</div>`)
	}
}

// isSafeURL permits http(s), mailto and inline images only.
func isSafeURL(raw string) bool {
	v := strings.TrimSpace(strings.ToLower(raw))
	if v == "" {
		return false
	}
	switch {
	case strings.HasPrefix(v, "http://"),
		strings.HasPrefix(v, "https://"),
		strings.HasPrefix(v, "mailto:"),
		strings.HasPrefix(v, "data:image/"):
		return true
	// Relative URLs are fine; the WebView resolves them against the document.
	case strings.HasPrefix(v, "/"), strings.HasPrefix(v, "#"),
		strings.HasPrefix(v, "./"), strings.HasPrefix(v, "../"):
		return true
	default:
		// Blocks javascript:, vbscript:, data:text/html, etc.
		return !strings.Contains(v, ":")
	}
}

// PlainText strips tags and collapses whitespace, for list summaries.
func PlainText(s string) string {
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
	// Decode the handful of entities that survive stripping.
	out := html.UnescapeString(b.String())
	return strings.Join(strings.Fields(out), " ")
}

// Truncate shortens s to at most n runes, appending an ellipsis when cut.
func Truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return strings.TrimSpace(string(r[:n])) + "…"
}

// FirstImageURL returns the first usable <img src> in a fragment.
func FirstImageURL(fragment string) string {
	nodes, err := html.ParseFragment(strings.NewReader(fragment),
		&html.Node{Type: html.ElementNode, Data: "div", DataAtom: atom.Div})
	if err != nil {
		return ""
	}
	var found string
	var walk func(*html.Node) bool
	walk = func(n *html.Node) bool {
		if n.Type == html.ElementNode && n.DataAtom == atom.Img {
			for _, a := range n.Attr {
				if strings.EqualFold(a.Key, "src") && isSafeURL(a.Val) {
					found = a.Val
					return true
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if walk(c) {
				return true
			}
		}
		return false
	}
	for _, n := range nodes {
		if walk(n) {
			break
		}
	}
	return found
}
