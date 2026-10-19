package feed

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"unicode/utf16"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// Comment avatars are the worst case for loading images directly from the page:
//
//   - many CDNs hotlink-protect them and answer 403 unless the Referer is the
//     article's own site, which a WebView cannot supply for an <img>;
//   - the paths are often extension-less or truncated (one real example ends in
//     a bare dot) so nothing can be decided from the file name;
//   - the same path can live on one host while a neighbouring path lives on
//     another, so a single base URL per site is not enough.
//
// Fetching the bytes here, where the Referer and Accept headers are ours, and
// inlining them as data URIs makes avatars render regardless of all three. The
// bytes are stored with the comment, so this cost is paid once per article.
const (
	// maxAvatarBytes caps a single inlined image. Real avatars are a few KB;
	// this leaves generous room for animated GIFs while excluding the rare
	// multi-megabyte one (one real example is 1.2 MB), which would otherwise be
	// stored base64-encoded with every article.
	maxAvatarBytes = 128 << 10
	// maxAvatarCount caps how many distinct images one thread may inline.
	maxAvatarCount = 40
	// maxAvatarTotal caps the combined size of a thread's inlined images.
	maxAvatarTotal = 2 << 20
	// avatarWorkers bounds concurrent image fetches.
	avatarWorkers = 4
)

// InlineCommentImages replaces remote image sources in a comment fragment with
// data URIs, and removes images whose bytes cannot be obtained (a broken image
// icon is worse than no image).
func (f *Fetcher) InlineCommentImages(ctx context.Context, fragment, referer string) string {
	if fragment == "" || !strings.Contains(fragment, "<img") {
		return fragment
	}

	ctxNode := &html.Node{Type: html.ElementNode, Data: "div", DataAtom: atom.Div}
	nodes, err := html.ParseFragment(strings.NewReader(fragment), ctxNode)
	if err != nil || len(nodes) == 0 {
		return fragment
	}

	// Collect the images and the distinct sources that still need fetching.
	type target struct{ node *html.Node }
	var images []target
	sources := map[string]bool{}
	order := []string{}

	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.DataAtom == atom.Img {
			if src := attrValue(n, "src"); src != "" {
				images = append(images, target{n})
				if !strings.HasPrefix(src, "data:") && !sources[src] {
					sources[src] = true
					order = append(order, src)
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	for _, n := range nodes {
		walk(n)
	}
	if len(images) == 0 {
		return fragment
	}

	if len(order) > maxAvatarCount {
		order = order[:maxAvatarCount]
	}

	// Fetch each distinct source once; the same commenter's avatar often
	// repeats across a thread.
	resolved := f.inlineSources(ctx, order, referer)

	var total int
	keep := map[string]bool{}
	for _, src := range order {
		if uri := resolved[src]; uri != "" && total+len(uri) <= maxAvatarTotal {
			keep[src] = true
			total += len(uri)
		}
	}

	for _, img := range images {
		src := attrValue(img.node, "src")
		if strings.HasPrefix(src, "data:") {
			continue
		}
		if keep[src] {
			setAttr(img.node, "src", resolved[src])
			// srcset would still point at the unprotected remote URL, and a
			// browser prefers it over src, so it has to go.
			removeAttr(img.node, "srcset")
			continue
		}
		// No bytes available: the CDN refused us, the file was huge, or it was
		// not an image. Replace it with an initials bubble rather than leave a
		// broken-image icon or a blank gap.
		replaceWithInitials(img.node)
	}

	var b strings.Builder
	for _, n := range nodes {
		if err := html.Render(&b, n); err != nil {
			return fragment
		}
	}
	return b.String()
}

// inlineSources fetches the given URLs, returning src -> data URI for the ones
// that succeeded.
func (f *Fetcher) inlineSources(ctx context.Context, urls []string, referer string) map[string]string {
	out := make(map[string]string, len(urls))
	if len(urls) == 0 {
		return out
	}

	var mu sync.Mutex
	var wg sync.WaitGroup
	work := make(chan string)

	workers := avatarWorkers
	if len(urls) < workers {
		workers = len(urls)
	}

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for src := range work {
				uri, err := f.fetchImageAsDataURIWithReferer(ctx, src, referer, maxAvatarBytes)
				mu.Lock()
				if err == nil {
					out[src] = uri
				} else {
					f.logf("comment image not inlined", "url", truncateText(src, 90), "err", err.Error())
				}
				mu.Unlock()
			}
		}()
	}

	for _, src := range urls {
		select {
		case <-ctx.Done():
			close(work)
			wg.Wait()
			return out
		case work <- src:
		}
	}
	close(work)
	wg.Wait()
	return out
}

// avatarGradient mirrors lib/utils.ts avatarGradient exactly (same hash over
// UTF-16 code units, same hues), so a commenter's fallback avatar is coloured
// identically to the app's own feed-icon fallback. DESIGN.md §1.5.
func avatarGradient(seed string) string {
	var hash int32
	for _, unit := range utf16.Encode([]rune(seed)) {
		hash = (hash << 5) - hash + int32(unit)
	}
	hue := int(hash) % 360
	if hue < 0 {
		hue += 360
	}
	return fmt.Sprintf("linear-gradient(135deg, hsl(%d 62%% 52%%), hsl(%d 58%% 42%%))",
		hue, (hue+38)%360)
}

// initialsBubble renders an avatar placeholder: the app's deterministic
// gradient with the name's first character, matching FeedIcon's fallback.
func initialsBubble(name string) string {
	name = strings.TrimSpace(name)
	initial := "?"
	if r := []rune(name); len(r) > 0 {
		initial = string(r[0])
	}
	if name == "" {
		name = "?"
	}
	return `<span class="avatar avatar--text" data-initial="` + html.EscapeString(initial) +
		`" style="background:` + avatarGradient(name) + `"></span>`
}

// replaceWithInitials swaps an <img> for that same placeholder, using the alt
// text (the author's name) as the seed. CSS renders the character via
// content: attr(data-initial), so the fallback needs no script.
func replaceWithInitials(img *html.Node) {
	if img.Parent == nil {
		return
	}
	name := strings.TrimSpace(attrValue(img, "alt"))
	if name == "" {
		name = strings.TrimSpace(attrValue(img, "title"))
	}

	bubble := &html.Node{
		Type:     html.ElementNode,
		Data:     "span",
		DataAtom: atom.Span,
	}
	// Reuse the shared renderer so the placeholder is identical everywhere.
	parsed, err := html.ParseFragment(strings.NewReader(initialsBubble(name)), img.Parent)
	if err != nil || len(parsed) == 0 {
		return
	}
	bubble = parsed[0]
	img.Parent.InsertBefore(bubble, img)
	img.Parent.RemoveChild(img)
}

// setAttr sets or replaces an attribute value.
func setAttr(n *html.Node, key, value string) {
	for i, a := range n.Attr {
		if strings.EqualFold(a.Key, key) {
			n.Attr[i].Val = value
			return
		}
	}
	n.Attr = append(n.Attr, html.Attribute{Key: key, Val: value})
}

// removeAttr drops an attribute if present.
func removeAttr(n *html.Node, key string) {
	kept := n.Attr[:0]
	for _, a := range n.Attr {
		if !strings.EqualFold(a.Key, key) {
			kept = append(kept, a)
		}
	}
	n.Attr = kept
}

// looksLikeImage reports whether a byte slice begins with a known image header.
// Exposed for the self-test so format coverage is asserted without the network.
func looksLikeImage(data []byte) bool {
	if len(data) == 0 {
		return false
	}
	return sniffImageMime(data, "") != ""
}
