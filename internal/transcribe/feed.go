package transcribe

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/mmcdole/gofeed"
)

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/124.0 Safari/537.36 ReadS/1.0"

// ErrNoFeedTranscript means the episode's feed item declares no usable
// transcript, so local recognition is the only way to get subtitles.
var ErrNoFeedTranscript = errors.New("节目没有自带文稿")

// Episode identifies the feed item a transcript belongs to.
type Episode struct {
	FeedURL  string
	GUID     string
	Link     string
	AudioURL string
}

type transcriptRef struct {
	url, mime string
	rank      int
}

// FeedTranscript downloads the transcript the publisher attached to the
// episode (Podcasting 2.0 <podcast:transcript>), preferring timed formats
// that carry speakers: JSON, then WebVTT, then SRT.
func FeedTranscript(ctx context.Context, client *http.Client, ep Episode) ([]Cue, error) {
	body, err := download(ctx, client, ep.FeedURL, 16<<20)
	if err != nil {
		return nil, fmt.Errorf("读取订阅源失败：%w", err)
	}
	parsed, err := gofeed.NewParser().Parse(bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("解析订阅源失败：%w", err)
	}
	item := findItem(parsed, ep)
	if item == nil {
		return nil, ErrNoFeedTranscript
	}
	refs := transcriptRefs(item, ep.FeedURL)
	if len(refs) == 0 {
		return nil, ErrNoFeedTranscript
	}
	var lastErr error = ErrNoFeedTranscript
	for _, ref := range refs {
		data, err := download(ctx, client, ref.url, 8<<20)
		if err != nil {
			lastErr = err
			continue
		}
		cues, err := Parse(data, ref.mime, ref.url)
		if err != nil {
			lastErr = err
			continue
		}
		return cues, nil
	}
	return nil, lastErr
}

func findItem(feed *gofeed.Feed, ep Episode) *gofeed.Item {
	for _, it := range feed.Items {
		if it == nil {
			continue
		}
		guid := strings.TrimSpace(it.GUID)
		link := strings.TrimSpace(it.Link)
		if ep.GUID != "" && (guid == ep.GUID || link == ep.GUID) {
			return it
		}
		if ep.Link != "" && link == ep.Link {
			return it
		}
		for _, enc := range it.Enclosures {
			if enc != nil && ep.AudioURL != "" && strings.TrimSpace(enc.URL) == ep.AudioURL {
				return it
			}
		}
	}
	return nil
}

func transcriptRefs(it *gofeed.Item, base string) []transcriptRef {
	var refs []transcriptRef
	for _, byName := range it.Extensions {
		for _, ext := range byName["transcript"] {
			raw := strings.TrimSpace(ext.Attrs["url"])
			if raw == "" {
				continue
			}
			mime := strings.ToLower(ext.Attrs["type"])
			rank := formatRank(mime, raw)
			if rank < 0 {
				continue
			}
			refs = append(refs, transcriptRef{url: resolve(base, raw), mime: mime, rank: rank})
		}
	}
	sort.SliceStable(refs, func(i, j int) bool { return refs[i].rank < refs[j].rank })
	return refs
}

func formatRank(mime, raw string) int {
	lower := strings.ToLower(raw)
	switch {
	case strings.Contains(mime, "json") || strings.HasSuffix(lower, ".json"):
		return 0
	case strings.Contains(mime, "vtt") || strings.HasSuffix(lower, ".vtt"):
		return 1
	case strings.Contains(mime, "srt") || strings.Contains(mime, "subrip") || strings.HasSuffix(lower, ".srt"):
		return 2
	}
	return -1
}

func resolve(base, ref string) string {
	b, err := url.Parse(base)
	if err != nil {
		return ref
	}
	r, err := url.Parse(ref)
	if err != nil {
		return ref
	}
	return b.ResolveReference(r).String()
}

func download(ctx context.Context, client *http.Client, u string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("服务器返回 %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, limit))
}
