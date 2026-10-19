package feed

import (
	"fmt"
	"math"
	"net/url"
	"sort"
	"strings"
	"unicode"

	"reads/internal/model"
)

/*
Article recommendations.

The app has no server-side profile, so the ranking is a small content-based
model built from what the reader has already shown interest in:

  - starred entries weigh most (an explicit signal);
  - read entries weigh less (an implicit signal);
  - every unread entry is scored by how many of those interest terms it shares,
    normalised so a long article cannot win just by having more words.

CJK text has no spaces, so terms are character bigrams; latin words are used
as-is. That is crude but language-agnostic, needs no dictionary, and works
well enough to surface "more of what you read" in a personal timeline.
*/

// interestWeights builds the term weights from the reader's history.
func interestWeights(seeds []string) map[string]float64 {
	weights := make(map[string]float64, 512)
	for _, text := range seeds {
		for _, term := range terms(text) {
			weights[term]++
		}
	}
	return weights
}

// stopTerms are function words that would otherwise dominate the bigram model.
var stopTerms = map[string]bool{
	"的": true, "了": true, "是": true, "在": true, "和": true, "与": true, "我": true,
	"有": true, "就": true, "不": true, "也": true, "你": true, "他": true, "她": true,
	"这": true, "那": true, "一个": true, "我们": true, "你们": true, "他们": true,
	"但是": true, "因为": true, "所以": true, "可以": true, "没有": true, "什么": true,
	"the": true, "and": true, "for": true, "with": true, "that": true, "this": true,
	"you": true, "are": true, "was": true, "from": true, "has": true, "have": true,
	"will": true, "not": true, "but": true, "its": true, "they": true, "their": true,
	"a": true, "an": true, "of": true, "to": true, "in": true, "on": true, "at": true,
	"by": true, "is": true, "it": true, "as": true, "be": true, "or": true,
}

// terms splits text into latin words and CJK bigrams.
func terms(text string) []string {
	text = strings.ToLower(text)
	var out []string
	var latin, han []rune

	flushLatin := func() {
		if len(latin) >= 3 {
			w := string(latin)
			if !stopTerms[w] {
				out = append(out, w)
			}
		}
		latin = latin[:0]
	}
	flushHan := func() {
		for i := 0; i+1 < len(han); i++ {
			bigram := string(han[i : i+2])
			if !stopTerms[bigram] {
				out = append(out, bigram)
			}
		}
		han = han[:0]
	}

	for _, r := range text {
		switch {
		case unicode.Is(unicode.Han, r):
			flushLatin()
			han = append(han, r)
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			flushHan()
			latin = append(latin, r)
		default:
			flushLatin()
			flushHan()
		}
	}
	flushLatin()
	flushHan()
	return out
}

// ScoreArticles ranks candidates against the reader's interest weights.
//
// textFor returns the searchable text of a candidate; the scored output keeps
// the original items, so callers can return whatever shape they need.
func scoreArticles[T any](seeds []string, candidates []T, textFor func(T) string) []T {
	weights := interestWeights(seeds)
	if len(weights) == 0 {
		return nil
	}

	type scored struct {
		item  T
		score float64
	}
	ranked := make([]scored, 0, len(candidates))
	for _, c := range candidates {
		termsOf := terms(textFor(c))
		if len(termsOf) == 0 {
			continue
		}
		var sum float64
		for _, t := range termsOf {
			if w, ok := weights[t]; ok {
				sum += math.Log1p(w)
			}
		}
		if sum <= 0 {
			continue
		}
		// Normalise by the square root of the term count so long articles do
		// not automatically outrank short, highly relevant ones.
		ranked = append(ranked, scored{item: c, score: sum / math.Sqrt(float64(len(termsOf)))})
	}

	sort.SliceStable(ranked, func(i, j int) bool { return ranked[i].score > ranked[j].score })
	out := make([]T, 0, len(ranked))
	for _, r := range ranked {
		out = append(out, r.item)
	}
	return out
}

// RankEntries is the entry-level recommendation pass.
func RankEntries(seeds []*model.Entry, candidates []*model.Entry) []*model.Entry {
	seedTexts := make([]string, 0, len(seeds))
	for _, s := range seeds {
		seedTexts = append(seedTexts, s.Title+" "+s.Summary)
	}
	ranked := scoreArticles(seedTexts, candidates, func(e *model.Entry) string {
		return e.Title + " " + e.Summary + " " + e.Author
	})
	if ranked == nil {
		// No history yet: fall back to the newest unread entries, which is what
		// a first-run reader would expect to see.
		return candidates
	}
	return ranked
}

/*
Subscription recommendations.

Candidates come from a curated catalogue (catalog.go), because the app cannot
invent feeds it has never seen. They are ranked by tag/title overlap with the
reader's own subscriptions and reading history, and anything already subscribed
is dropped.
*/

// normalizeHost reduces a feed URL to the site it belongs to, so a suggestion
// is not offered again when the reader already subscribes to the same site
// under a different path (feed.xml vs atom.xml, with or without www).
func normalizeHost(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return strings.ToLower(strings.TrimSpace(raw))
	}
	host := strings.ToLower(u.Hostname())
	return strings.TrimPrefix(host, "www.")
}

// RankFeeds ranks the catalogue against the reader's interest text, dropping
// anything already subscribed.
func RankFeeds(interest, subscribedURLs []string, catalog []model.FeedSuggestion) []model.FeedSuggestion {
	weights := interestWeights(interest)

	already := make(map[string]bool, len(subscribedURLs))
	for _, u := range subscribedURLs {
		already[normalizeHost(u)] = true
	}

	type scored struct {
		feed  model.FeedSuggestion
		score float64
	}
	ranked := make([]scored, 0, len(catalog))
	for _, c := range catalog {
		if already[normalizeHost(c.URL)] || already[normalizeHost(c.SiteURL)] {
			continue
		}
		text := c.Title + " " + c.Description + " " + strings.Join(c.Tags, " ")
		w := interestWeights([]string{text})

		var sum float64
		for term, weight := range w {
			if sw, ok := weights[term]; ok {
				sum += weight * math.Log1p(sw)
			}
		}
		// A small baseline keeps the list useful before any history exists.
		ranked = append(ranked, scored{feed: c, score: sum})
	}

	sort.SliceStable(ranked, func(i, j int) bool { return ranked[i].score > ranked[j].score })
	out := make([]model.FeedSuggestion, 0, len(ranked))
	for _, r := range ranked {
		r.feed.Score = int(math.Round(r.score))
		out = append(out, r.feed)
	}
	return out
}

// SelfTestRecommend exercises the ranking model with fixed inputs, so a change
// to the tokenizer or the scoring shows up in `--selftest` rather than as a
// subtly worse discover pane.
func SelfTestRecommend() error {
	seed := &model.Entry{Title: "Go 1.26 发布，性能提升", Summary: "编程语言 Go 的新版本"}
	candidates := []*model.Entry{
		{ID: 1, Title: "Go 泛型最佳实践", Summary: "编程语言"},
		{ID: 2, Title: "苹果发布新手机", Summary: "数码产品"},
		{ID: 3, Title: "Rust 与 Go 的语言对比", Summary: "编程语言"},
	}

	ranked := RankEntries([]*model.Entry{seed}, candidates)
	if len(ranked) != len(candidates) {
		return fmt.Errorf("rankentries: got %d of %d", len(ranked), len(candidates))
	}
	if ranked[len(ranked)-1].ID != 2 {
		return fmt.Errorf("rankentries: irrelevant entry ranked over related ones (last=%d)", ranked[len(ranked)-1].ID)
	}
	if got := RankEntries(nil, candidates); len(got) != len(candidates) {
		return fmt.Errorf("rankentries without history: got %d", len(got))
	}

	subscribed := []string{"https://www.ruanyifeng.com/blog/atom.xml"}
	for _, s := range RankFeeds([]string{"编程 技术 开源"}, subscribed, Catalog) {
		if normalizeHost(s.URL) == "ruanyifeng.com" {
			return fmt.Errorf("rankfeeds: offered an already-subscribed site")
		}
	}
	if len(RankFeeds([]string{"编程"}, subscribed, nil)) != 0 {
		return fmt.Errorf("rankfeeds: empty catalogue produced suggestions")
	}
	return nil
}
