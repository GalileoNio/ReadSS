// Package imgproxy serves remote article images to the WebView.
//
// Some CDNs hotlink-protect article images: they answer 403 unless the Referer
// is the publishing site. A WebView cannot set that header for an <img>, so the
// images render broken — measured on img.ithome.com, which returns 403 for the
// app's own origin while platform.theverge.com does not care.
//
// The app therefore serves the bytes itself from a loopback-only HTTP server:
// it fetches the image with the article as Referer (the context the image is
// being shown in) and streams it back, so the WebView never talks to the CDN
// directly. Responses are cacheable, and nothing is stored in the database, so
// a list of a hundred thumbnails costs no disk.
package imgproxy

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	// maxImageBytes bounds one proxied image.
	maxImageBytes = 12 << 20
	// fetchTimeout bounds a single upstream request.
	fetchTimeout = 30 * time.Second
	// cacheSeconds tells the WebView how long it may reuse the response.
	cacheSeconds = 86400
)

// Server is a loopback image proxy.
type Server struct {
	http     *http.Server
	listener net.Listener
	client   *http.Client
	base     string
}

// Start binds the proxy to a random loopback port and starts serving.
func Start() (*Server, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("image proxy listen: %w", err)
	}

	s := &Server{
		listener: ln,
		client: &http.Client{
			Timeout: fetchTimeout,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 5 {
					return fmt.Errorf("too many redirects")
				}
				return nil
			},
		},
	}
	s.base = "http://" + ln.Addr().String()

	mux := http.NewServeMux()
	mux.HandleFunc("/i", s.handleImage)
	s.http = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() { _ = s.http.Serve(ln) }()
	return s, nil
}

// Base returns the proxy's origin, e.g. http://127.0.0.1:54321.
func (s *Server) Base() string {
	if s == nil {
		return ""
	}
	return s.base
}

// URL builds a proxied URL for an image displayed on `referer`.
func (s *Server) URL(imageURL, referer string) string {
	if s == nil || s.base == "" || imageURL == "" {
		return imageURL
	}
	q := url.Values{}
	q.Set("u", imageURL)
	if referer != "" {
		q.Set("r", referer)
	}
	return s.base + "/i?" + q.Encode()
}

// Close stops the server.
func (s *Server) Close() error {
	if s == nil || s.http == nil {
		return nil
	}
	return s.http.Close()
}

func (s *Server) handleImage(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("u")
	target, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.Host == "" {
		http.Error(w, "bad image url", http.StatusBadRequest)
		return
	}
	// Only the local app talks to this, but keep it from being a general
	// fetcher for anything but images.
	referer := strings.TrimSpace(r.URL.Query().Get("r"))
	if ref, err := url.Parse(referer); err != nil || (ref.Scheme != "http" && ref.Scheme != "https") {
		referer = ""
	}
	// A sensible fallback: the image's own site root.
	if referer == "" {
		referer = target.Scheme + "://" + target.Host + "/"
	}

	ctx, cancel := context.WithTimeout(r.Context(), fetchTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
	req.Header.Set("Referer", referer)

	resp, err := s.client.Do(req)
	if err != nil {
		http.Error(w, "upstream error", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		http.Error(w, "upstream status", resp.StatusCode)
		return
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType != "" && !strings.HasPrefix(strings.ToLower(contentType), "image/") {
		http.Error(w, "not an image", http.StatusUnsupportedMediaType)
		return
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", fmt.Sprintf("private, max-age=%d", cacheSeconds))
	if length := resp.Header.Get("Content-Length"); length != "" {
		w.Header().Set("Content-Length", length)
	}
	// 200 with a length cap; a truncated image is better than none.
	_, _ = io.Copy(w, io.LimitReader(resp.Body, maxImageBytes))
}

// userAgent identifies the app when fetching upstream images.
var userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 ReadS/1.0"
