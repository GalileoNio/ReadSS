package feed

import (
	"strings"
	"testing"

	"reads/internal/model"
)

func TestNormalizeVideoPlatform(t *testing.T) {
	cases := map[string]string{
		"bilibili": model.VideoPlatformBilibili,
		"B站":       model.VideoPlatformBilibili,
		"YT":       model.VideoPlatformYouTube,
		"油管":       model.VideoPlatformYouTube,
		"vimeo":    "",
	}
	for raw, want := range cases {
		if got := NormalizeVideoPlatform(raw); got != want {
			t.Fatalf("NormalizeVideoPlatform(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestParseBilibiliQuery(t *testing.T) {
	cases := []struct {
		raw  string
		kind string
		want string
	}{
		{"546195", "uid", "546195"},
		{"UID:546195", "uid", "546195"},
		{"uid 546195", "uid", "546195"},
		{"https://space.bilibili.com/546195", "uid", "546195"},
		{"https://space.bilibili.com/546195/video", "uid", "546195"},
		{"https://m.bilibili.com/space/546195", "uid", "546195"},
		{"bilibili:546195", "uid", "546195"},
		{"老番茄", "text", "老番茄"},
		{"B站:老番茄", "text", "老番茄"},
	}
	for _, tc := range cases {
		got, ok := parseBilibiliQuery(tc.raw)
		if !ok {
			t.Fatalf("parseBilibiliQuery(%q) not recognised", tc.raw)
		}
		if got.kind != tc.kind || got.value != tc.want {
			t.Fatalf("parseBilibiliQuery(%q) = %#v, want kind %q value %q", tc.raw, got, tc.kind, tc.want)
		}
	}
}

func TestParseBilibiliVideoRef(t *testing.T) {
	ref, ok := parseBilibiliQuery("https://www.bilibili.com/video/BV1xx411c7mD?p=1")
	if !ok || ref.kind != "video" || ref.bvid != "BV1xx411c7mD" {
		t.Fatalf("video URL parsed as %#v ok=%v", ref, ok)
	}

	ref, ok = parseBilibiliQuery("https://www.bilibili.com/video/av170001")
	if !ok || ref.kind != "video" || ref.aid != 170001 {
		t.Fatalf("av URL parsed as %#v ok=%v", ref, ok)
	}
}

func TestParseYouTubeQuery(t *testing.T) {
	cases := []struct {
		raw   string
		kind  string
		value string
	}{
		{"@MrBeast", "handle", "MrBeast"},
		{"youtube:@MrBeast", "handle", "MrBeast"},
		{"UCX6OQ3DkcsbYNE6H8uQQuVA", "id", "UCX6OQ3DkcsbYNE6H8uQQuVA"},
		{"https://www.youtube.com/@MrBeast", "handle", "MrBeast"},
		{"https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA/videos", "id", "UCX6OQ3DkcsbYNE6H8uQQuVA"},
		{"https://www.youtube.com/watch?v=abc123", "video", "abc123"},
		{"https://youtu.be/abc123", "video", "abc123"},
		{"https://www.youtube.com/shorts/abc123", "video", "abc123"},
		{"https://www.youtube.com/c/SomeName", "page", "https://www.youtube.com/c/SomeName"},
		{"https://www.youtube.com/user/SomeName", "page", "https://www.youtube.com/user/SomeName"},
	}
	for _, tc := range cases {
		got, ok := parseYouTubeQuery(tc.raw)
		if !ok {
			t.Fatalf("parseYouTubeQuery(%q) not recognised", tc.raw)
		}
		if got.kind != tc.kind || got.value != tc.value {
			t.Fatalf("parseYouTubeQuery(%q) = %#v, want kind %q value %q", tc.raw, got, tc.kind, tc.value)
		}
	}

	if _, ok := parseYouTubeQuery("MrBeast"); ok {
		t.Fatal("a plain display name must go through search, not direct resolution")
	}
	if _, ok := parseYouTubeQuery("https://example.com/@someone"); ok {
		t.Fatal("a non-YouTube host must not be treated as a channel")
	}
}

func TestParseYouTubeSearch(t *testing.T) {
	body := []byte(`<script>var ytInitialData = {"contents":{"items":[
		{"channelRenderer":{
			"channelId":"UCX6OQ3DkcsbYNE6H8uQQuVA",
			"title":{"simpleText":"MrBeast"},
			"descriptionSnippet":{"runs":[{"text":"SUBSCRIBE"},{"text":" for challenges"}]},
			"subscriberCountText":{"simpleText":"437M subscribers"},
			"thumbnail":{"thumbnails":[{"url":"https://img/small.jpg"},{"url":"https://img/large.jpg"}]}
		}},
		{"channelRenderer":{"channelId":"UCX6OQ3DkcsbYNE6H8uQQuVA","title":{"simpleText":"Duplicate"}}}
	]}};</script>`)

	channels := parseYouTubeSearch(body, 8)
	if len(channels) != 1 {
		t.Fatalf("expected one deduplicated channel, got %d", len(channels))
	}
	got := channels[0]
	if got.ID != "UCX6OQ3DkcsbYNE6H8uQQuVA" || got.Name != "MrBeast" {
		t.Fatalf("unexpected channel %#v", got)
	}
	if got.Description != "SUBSCRIBE for challenges" {
		t.Fatalf("description = %q", got.Description)
	}
	if got.Subscribers != 437_000_000 {
		t.Fatalf("subscribers = %d", got.Subscribers)
	}
	if got.AvatarURL != "https://img/large.jpg" {
		t.Fatalf("avatar = %q", got.AvatarURL)
	}
	if got.FeedURL != youtubeFeedURL(got.ID) {
		t.Fatalf("feed url = %q", got.FeedURL)
	}
}

func TestEnrichYouTubeMedia(t *testing.T) {
	body := []byte(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
  <title>Test Channel</title>
  <link rel="alternate" href="https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA"/>
  <entry>
    <id>yt:video:abc123</id>
    <title>Hello video</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
    <published>2026-01-02T03:04:05+00:00</published>
    <media:group>
      <media:title>Hello video</media:title>
      <media:description>First line
Second line</media:description>
      <media:thumbnail url="https://i.ytimg.com/vi/abc123/hqdefault.jpg" width="480" height="360"/>
    </media:group>
  </entry>
</feed>`)

	f := NewFetcher()
	res, err := f.ParseBytes(body, youtubeFeedURL("UCX6OQ3DkcsbYNE6H8uQQuVA"))
	if err != nil {
		t.Fatalf("ParseBytes: %v", err)
	}
	if len(res.Items) != 1 {
		t.Fatalf("expected one item, got %d", len(res.Items))
	}
	item := res.Items[0]
	if item.ImageURL != "https://i.ytimg.com/vi/abc123/hqdefault.jpg" {
		t.Fatalf("image = %q", item.ImageURL)
	}
	if !strings.Contains(item.Summary, "First line") {
		t.Fatalf("summary = %q", item.Summary)
	}
	if !strings.Contains(item.Content, "hqdefault.jpg") || !strings.Contains(item.Content, "Second line") {
		t.Fatalf("content = %q", item.Content)
	}
	if res.View != "videos" {
		t.Fatalf("view = %q", res.View)
	}
}

func TestParseCompactCount(t *testing.T) {
	cases := map[string]int{
		"437M subscribers": 437_000_000,
		"1.2K":             1_200,
		"3.4B":             3_400_000_000,
		"12万":              120_000,
		"1亿":               100_000_000,
		"1,234":            1234,
		"":                 0,
	}
	for raw, want := range cases {
		if got := parseCompactCount(raw); got != want {
			t.Fatalf("parseCompactCount(%q) = %d, want %d", raw, got, want)
		}
	}
}

func TestWBIKeyName(t *testing.T) {
	got := wbiKeyName("https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png")
	if got != "7cd084941338484aae1ad9425b84077c" {
		t.Fatalf("wbiKeyName = %q", got)
	}
}
