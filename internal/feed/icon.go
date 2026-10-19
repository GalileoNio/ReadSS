package feed

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

const (
	// maxIconBytes caps how much of an icon we are willing to keep. Icons are
	// cached inline as data URIs, so this also bounds the database size. 64 KiB
	// comfortably fits a 180px PNG while rejecting full-resolution artwork.
	maxIconBytes = 64 << 10
)

// FetchIcon resolves a website's icon and returns it as a data URI.
//
// Icons are discovered the way a browser would: the page's <link rel="icon">
// declarations first, then the conventional /favicon.ico. The bytes are
// embedded rather than linked so the sidebar renders them without a network
// round trip, without depending on a third-party favicon service (which may be
// unreachable or rate-limited), and without leaking the user's subscriptions
// to that service.
func (f *Fetcher) FetchIcon(ctx context.Context, siteURL string) (string, error) {
	base := normaliseSite(siteURL)
	if base == "" {
		return "", fmt.Errorf("no site URL to fetch an icon from")
	}

	// 1. Ask the page what its icon is.
	candidates := []string{}
	if page, err := f.fetchPage(ctx, base); err == nil {
		candidates = append(candidates, iconLinks(page, base)...)
	}

	// 2. Fall back to the conventional location.
	candidates = append(candidates, base+"/favicon.ico")

	seen := map[string]bool{}
	for _, candidate := range candidates {
		if candidate == "" || seen[candidate] {
			continue
		}
		seen[candidate] = true

		dataURI, err := f.fetchIconBytes(ctx, candidate)
		if err == nil && dataURI != "" {
			return dataURI, nil
		}
	}
	return "", fmt.Errorf("no usable icon found for %s", base)
}

// normaliseSite turns a feed or article URL into a scheme+host base URL.
func normaliseSite(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

func (f *Fetcher) fetchPage(ctx context.Context, base string) (*html.Node, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")

	resp, err := f.doRetry(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("server returned %s", resp.Status)
	}

	// The <head> is all we need, and it is always near the start.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 512<<10))
	if err != nil {
		return nil, err
	}
	return html.Parse(bytes.NewReader(body))
}

// iconLinks collects <link rel="...icon..."> hrefs, best-first, with relative
// URLs resolved against the page.
//
// "Best" targets roughly 64px: that is crisp for the 16–24px avatars the app
// draws while staying small enough to store inline. Preferring the largest
// declared icon would routinely pull in 100 KB+ artwork.
func iconLinks(doc *html.Node, base string) []string {
	type candidate struct {
		href string
		rank int
	}
	var found []candidate

	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.DataAtom == atom.Link {
			if href, rank, ok := iconCandidate(n); ok {
				if resolved := resolveRefString(base, href); resolved != "" {
					found = append(found, candidate{href: resolved, rank: rank})
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)

	// Insertion sort ascending by rank; equal ranks keep document order.
	for i := 1; i < len(found); i++ {
		for j := i; j > 0 && found[j].rank < found[j-1].rank; j-- {
			found[j], found[j-1] = found[j-1], found[j]
		}
	}

	out := make([]string, 0, len(found))
	for _, c := range found {
		out = append(out, c.href)
	}
	return out
}

// iconCandidate reports whether a <link> element declares a raster site icon,
// along with a preference rank (lower is better; 0 targets ~64px).
func iconCandidate(n *html.Node) (href string, rank int, ok bool) {
	var rel, sizes, typ string
	for _, a := range n.Attr {
		switch strings.ToLower(a.Key) {
		case "rel":
			rel = strings.ToLower(a.Val)
		case "href":
			href = strings.TrimSpace(a.Val)
		case "sizes":
			sizes = strings.ToLower(a.Val)
		case "type":
			typ = strings.ToLower(a.Val)
		}
	}

	if !strings.Contains(rel, "icon") || href == "" {
		return "", 0, false
	}
	// Skip SVG: it is frequently a full logo, and it bloats the inline cache.
	if strings.Contains(typ, "svg") || strings.HasSuffix(strings.ToLower(href), ".svg") {
		return "", 0, false
	}

	switch {
	case strings.Contains(sizes, "48"), strings.Contains(sizes, "64"):
		rank = 0
	case strings.Contains(sizes, "32"), strings.Contains(sizes, "96"):
		rank = 1
	case strings.Contains(sizes, "128"), strings.Contains(sizes, "any"):
		rank = 2
	case strings.Contains(sizes, "16"), strings.Contains(sizes, "24"):
		// Small, but usable: it is at least a real icon.
		rank = 3
	case strings.Contains(sizes, "180"), strings.Contains(sizes, "192"),
		strings.Contains(sizes, "256"), strings.Contains(sizes, "512"):
		rank = 4
	default:
		// No usable sizes attribute (very common); try it early, since a plain
		// /favicon.ico-style declaration is usually small.
		rank = 1
	}
	return href, rank, true
}

// resolveRefString resolves a possibly relative href against a base URL string.
func resolveRefString(base, href string) string {
	b, err := url.Parse(base)
	if err != nil {
		return ""
	}
	return resolveRef(b, href)
}

// InlineImage downloads an image and returns it as a data URI.
//
// It is used for images a feed advertises itself (a logo in <image>), so those
// render without a network round trip. maxBytes bounds the database cost;
// oversized images are rejected so the caller can fall back.
func (f *Fetcher) InlineImage(ctx context.Context, imageURL string, maxBytes int) (string, error) {
	if maxBytes <= 0 {
		maxBytes = maxIconBytes
	}
	if strings.TrimSpace(imageURL) == "" {
		return "", fmt.Errorf("no image URL")
	}
	return f.fetchImageAsDataURI(ctx, imageURL, maxBytes)
}

// fetchIconBytes downloads an icon within the standard icon size budget.
func (f *Fetcher) fetchIconBytes(ctx context.Context, iconURL string) (string, error) {
	return f.fetchImageAsDataURI(ctx, iconURL, maxIconBytes)
}

// fetchImageAsDataURI downloads an image and encodes it as a data URI.
func (f *Fetcher) fetchImageAsDataURI(ctx context.Context, imageURL string, maxBytes int) (string, error) {
	return f.fetchImageAsDataURIWithReferer(ctx, imageURL, "", maxBytes)
}

// fetchImageAsDataURIWithReferer is fetchImageAsDataURI with a Referer.
//
// Several CDNs used for avatars refuse requests whose Referer is not the
// article's own site (a plain 403). The WebView cannot supply that header for
// an <img>, so images are fetched here and inlined instead.
func (f *Fetcher) fetchImageAsDataURIWithReferer(ctx context.Context, imageURL, referer string, maxBytes int) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
	if referer != "" {
		req.Header.Set("Referer", referer)
	}

	resp, err := f.doRetry(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("server returned %s", resp.Status)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, int64(maxBytes)+1))
	if err != nil {
		return "", err
	}
	if len(data) == 0 {
		return "", fmt.Errorf("image was empty")
	}
	if len(data) > maxBytes {
		return "", fmt.Errorf("image exceeds the %d byte budget", maxBytes)
	}

	mime := sniffImageMime(data, resp.Header.Get("Content-Type"))
	if mime == "" {
		return "", fmt.Errorf("response was not a recognised image")
	}

	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// sniffImageMime identifies the image type from its magic bytes, falling back
// to the declared content type. This matters because icon endpoints sometimes
// serve HTML error pages with an image content type.
func sniffImageMime(data []byte, declared string) string {
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return "image/png"
	case bytes.HasPrefix(data, []byte("\xff\xd8\xff")):
		return "image/jpeg"
	case bytes.HasPrefix(data, []byte("GIF87a")), bytes.HasPrefix(data, []byte("GIF89a")):
		return "image/gif"
	case bytes.HasPrefix(data, []byte("RIFF")) && len(data) > 12 &&
		bytes.Equal(data[8:12], []byte("WEBP")):
		return "image/webp"
	case len(data) > 12 && bytes.Equal(data[4:8], []byte("ftyp")):
		// ISO base media container: AVIF and HEIC avatars are increasingly
		// common and have no other distinguishing prefix.
		brand := string(data[8:12])
		switch brand {
		case "avif", "avis":
			return "image/avif"
		case "heic", "heix", "hevc", "mif1", "msf1":
			return "image/heic"
		}
		return ""
	case bytes.HasPrefix(data, []byte("BM")) && len(data) >= 14:
		return "image/bmp"
	case bytes.HasPrefix(data, []byte("II*\x00")), bytes.HasPrefix(data, []byte("MM\x00*")):
		return "image/tiff"
	case bytes.HasPrefix(data, []byte("<svg")), bytes.HasPrefix(data, []byte("<?xml")):
		return "image/svg+xml"
	case bytes.HasPrefix(bytes.TrimSpace(data), []byte("<")):
		// An HTML document: not an image.
		return ""
	}

	declared = strings.ToLower(strings.TrimSpace(strings.Split(declared, ";")[0]))
	if strings.HasPrefix(declared, "image/") {
		return declared
	}
	// .ico files have no reliable magic beyond the 0,0,1,0 header.
	if len(data) > 4 && data[0] == 0 && data[1] == 0 && data[2] == 1 && data[3] == 0 {
		return "image/x-icon"
	}
	return ""
}
