package feed

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"reads/internal/model"
)

/*
Podcast recommendations.

Shows come from the public Apple Podcasts directory, which is keyless, carries
the show's real RSS address (`feedUrl`) and is reachable from mainland China:

  - genre top charts  itunes.apple.com/<cc>/rss/toppodcasts/limit=50/genre=<id>/json
  - keyword search    itunes.apple.com/search?media=podcast&term=…
  - id lookup         itunes.apple.com/lookup?id=…   (charts carry no feed URL)

The reader's own subscriptions and reading history pick which genres and which
search words are used, so the list follows what they actually read. Every
refresh asks for a new round: the secondary genre and the search words rotate,
and shows already displayed are skipped, so "换一批" really brings new shows.
Shows whose newest episode is over a year old are dropped as inactive.
*/

const (
	podcastStore    = "cn"
	podcastChartLen = 50
	podcastCacheTTL = 6 * time.Hour
	podcastMaxAge   = 365 * 24 * time.Hour
)

type podcastTopic struct {
	Name  string
	Genre int
	// Words are both the interest vocabulary and the search terms.
	Words []string
}

// podcastTopics maps Apple Podcasts genres to how a reader's history talks
// about them. The order is also the fallback order for a reader with no history.
var podcastTopics = []podcastTopic{
	{"科技", 1318, []string{"科技", "互联网", "人工智能", "编程", "数码", "开源", "软件", "芯片", "苹果", "technology"}},
	{"商业", 1321, []string{"商业", "创业", "投资", "经济", "金融", "管理", "职场", "营销", "startup"}},
	{"社会与文化", 1324, []string{"文化", "社会", "哲学", "人文", "城市", "女性", "生活方式"}},
	{"新闻", 1489, []string{"新闻", "时事", "国际", "政治", "评论"}},
	{"科学", 1533, []string{"科学", "科普", "物理", "生物", "天文", "医学", "数学", "science"}},
	{"历史", 1487, []string{"历史", "古代", "考古", "朝代", "history"}},
	{"艺术", 1301, []string{"艺术", "设计", "文学", "阅读", "读书", "摄影", "建筑", "design"}},
	{"电视与电影", 1309, []string{"电影", "影视", "剧集", "纪录片", "动画", "film"}},
	{"教育", 1304, []string{"教育", "学习", "英语", "语言", "知识"}},
	{"健康与健身", 1512, []string{"健康", "健身", "运动", "心理", "睡眠", "饮食"}},
	{"休闲", 1502, []string{"游戏", "二次元", "旅行", "美食", "汽车", "动漫"}},
	{"喜剧", 1303, []string{"喜剧", "脱口秀", "搞笑"}},
	{"音乐", 1310, []string{"音乐", "乐队", "专辑", "歌手", "music"}},
	{"体育", 1545, []string{"体育", "足球", "篮球", "赛事"}},
}

// PodcastRequest is everything the recommender needs from the library.
type PodcastRequest struct {
	Interest   []string
	Subscribed []string
	// Exclude holds feed URLs already shown in earlier rounds.
	Exclude []string
	Round   int
	Limit   int
}

/* ---------------------------------------------------------------- topics */

type topicScore struct {
	topic *podcastTopic
	score float64
	// words are the topic's words the reader actually uses, best first.
	words []string
}

// rankTopics scores every genre against the reader's interest weights.
func rankTopics(weights map[string]float64) []topicScore {
	out := make([]topicScore, 0, len(podcastTopics))
	for i := range podcastTopics {
		t := &podcastTopics[i]
		type ws struct {
			word  string
			score float64
		}
		var hits []ws
		for _, w := range t.Words {
			ts := terms(w)
			if len(ts) == 0 {
				continue
			}
			var s float64
			for _, term := range ts {
				s += math.Log1p(weights[term])
			}
			// Averaged, so a four-character word cannot outscore a two-character
			// one just by having more bigrams.
			if s /= float64(len(ts)); s > 0 {
				hits = append(hits, ws{w, s})
			}
		}
		sort.SliceStable(hits, func(a, b int) bool { return hits[a].score > hits[b].score })
		ts := topicScore{topic: t}
		for i, h := range hits {
			if i < 3 {
				ts.score += h.score
			}
			ts.words = append(ts.words, h.word)
		}
		out = append(out, ts)
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].score > out[b].score })
	return out
}

type chartPick struct {
	topic *podcastTopic // nil = the overall chart
	score float64
}

type searchPick struct {
	keyword string
	score   float64
}

type podcastPlan struct {
	charts   []chartPick
	searches []searchPick
}

// planPodcastRound decides which charts and searches one refresh uses.
//
// The best-matching genre is always included; the second genre and the search
// words rotate with the round, and the overall chart adds broadly popular shows.
func planPodcastRound(ranked []topicScore, round int) podcastPlan {
	if round < 0 {
		round = 0
	}
	personal := 0
	for _, t := range ranked {
		if t.score > 0 {
			personal++
		}
	}

	var plan podcastPlan
	if personal == 0 {
		n := len(podcastTopics)
		plan.charts = []chartPick{
			{topic: nil},
			{topic: &podcastTopics[(2*round)%n]},
			{topic: &podcastTopics[(2*round+1)%n]},
		}
		return plan
	}

	top := ranked[0].score
	norm := func(s float64) float64 { return s / top }
	plan.charts = append(plan.charts, chartPick{topic: ranked[0].topic, score: 1})
	if personal > 1 {
		second := ranked[1+round%(personal-1)]
		plan.charts = append(plan.charts, chartPick{topic: second.topic, score: norm(second.score)})
	}
	plan.charts = append(plan.charts, chartPick{topic: nil})

	for i := 0; i < personal && len(plan.searches) < 2; i++ {
		t := ranked[i]
		if len(t.words) == 0 {
			continue
		}
		plan.searches = append(plan.searches, searchPick{
			keyword: t.words[round%len(t.words)],
			score:   norm(t.score),
		})
	}
	return plan
}

/* ------------------------------------------------------------- directory */

type itunesItem struct {
	Kind           string   `json:"kind"`
	CollectionID   int64    `json:"collectionId"`
	CollectionName string   `json:"collectionName"`
	ArtistName     string   `json:"artistName"`
	FeedURL        string   `json:"feedUrl"`
	ViewURL        string   `json:"collectionViewUrl"`
	Artwork600     string   `json:"artworkUrl600"`
	Artwork100     string   `json:"artworkUrl100"`
	Genre          string   `json:"primaryGenreName"`
	Genres         []string `json:"genres"`
	TrackCount     int      `json:"trackCount"`
	ReleaseDate    string   `json:"releaseDate"`
}

type itunesResponse struct {
	Results []itunesItem `json:"results"`
}

type chartLabel struct {
	Label string `json:"label"`
}

type chartEntry struct {
	Name    chartLabel `json:"im:name"`
	Summary chartLabel `json:"summary"`
	ID      struct {
		Attributes struct {
			ID string `json:"im:id"`
		} `json:"attributes"`
	} `json:"id"`
}

// chartItem is one row of a top chart: the show id, its rank and the summary,
// which only the chart carries.
type chartItem struct {
	id      int64
	rank    int
	name    string
	summary string
}

// parseChart reads Apple's legacy chart JSON. A chart with a single entry
// encodes `entry` as an object rather than an array.
func parseChart(body []byte) ([]chartItem, error) {
	var doc struct {
		Feed struct {
			Entry json.RawMessage `json:"entry"`
		} `json:"feed"`
	}
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, err
	}
	raw := doc.Feed.Entry
	if len(raw) == 0 {
		return nil, nil
	}
	var entries []chartEntry
	if raw[0] == '{' {
		var one chartEntry
		if err := json.Unmarshal(raw, &one); err != nil {
			return nil, err
		}
		entries = []chartEntry{one}
	} else if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, err
	}
	out := make([]chartItem, 0, len(entries))
	for i, e := range entries {
		id, err := strconv.ParseInt(e.ID.Attributes.ID, 10, 64)
		if err != nil || id <= 0 {
			continue
		}
		out = append(out, chartItem{id: id, rank: i + 1, name: e.Name.Label, summary: e.Summary.Label})
	}
	return out, nil
}

var podcastCache = struct {
	sync.Mutex
	bodies map[string]cachedBody
	items  map[int64]cachedItem
}{bodies: map[string]cachedBody{}, items: map[int64]cachedItem{}}

type cachedBody struct {
	at   time.Time
	body []byte
}

type cachedItem struct {
	at   time.Time
	item itunesItem
}

// directoryGet fetches a directory endpoint, served from a six-hour cache:
// charts move slowly, and rotating rounds should not refetch them.
func (f *Fetcher) directoryGet(ctx context.Context, endpoint string) ([]byte, error) {
	podcastCache.Lock()
	if c, ok := podcastCache.bodies[endpoint]; ok && time.Since(c.at) < podcastCacheTTL {
		podcastCache.Unlock()
		return c.body, nil
	}
	podcastCache.Unlock()

	status, _, body, err := f.fetchBody(ctx, endpoint, func(ctx context.Context) (*http.Request, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", userAgent)
		req.Header.Set("Accept", "application/json")
		return req, nil
	})
	if err != nil {
		return nil, friendlyNetErr(err)
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("播客目录返回 %d", status)
	}
	podcastCache.Lock()
	podcastCache.bodies[endpoint] = cachedBody{at: time.Now(), body: body}
	podcastCache.Unlock()
	return body, nil
}

func chartURL(t *podcastTopic) string {
	if t == nil {
		return fmt.Sprintf("https://itunes.apple.com/%s/rss/toppodcasts/limit=%d/json", podcastStore, podcastChartLen)
	}
	return fmt.Sprintf("https://itunes.apple.com/%s/rss/toppodcasts/limit=%d/genre=%d/json", podcastStore, podcastChartLen, t.Genre)
}

func searchURL(keyword string) string {
	q := url.Values{}
	q.Set("media", "podcast")
	q.Set("entity", "podcast")
	q.Set("country", podcastStore)
	q.Set("limit", "30")
	q.Set("term", keyword)
	return "https://itunes.apple.com/search?" + q.Encode()
}

// lookupShows resolves chart ids to full show records (feed URL, last release,
// episode count), using the per-id cache first.
func (f *Fetcher) lookupShows(ctx context.Context, ids []int64) map[int64]itunesItem {
	out := make(map[int64]itunesItem, len(ids))
	var missing []int64
	podcastCache.Lock()
	for _, id := range ids {
		if c, ok := podcastCache.items[id]; ok && time.Since(c.at) < podcastCacheTTL {
			out[id] = c.item
		} else {
			missing = append(missing, id)
		}
	}
	podcastCache.Unlock()

	const batch = 60
	var wg sync.WaitGroup
	var mu sync.Mutex
	for start := 0; start < len(missing); start += batch {
		end := min(start+batch, len(missing))
		parts := make([]string, 0, end-start)
		for _, id := range missing[start:end] {
			parts = append(parts, strconv.FormatInt(id, 10))
		}
		endpoint := fmt.Sprintf("https://itunes.apple.com/lookup?entity=podcast&country=%s&id=%s",
			podcastStore, strings.Join(parts, ","))
		wg.Add(1)
		go func() {
			defer wg.Done()
			body, err := f.directoryGet(ctx, endpoint)
			if err != nil {
				f.logf("podcast lookup failed", "err", err.Error())
				return
			}
			var resp itunesResponse
			if json.Unmarshal(body, &resp) != nil {
				return
			}
			now := time.Now()
			mu.Lock()
			podcastCache.Lock()
			for _, it := range resp.Results {
				out[it.CollectionID] = it
				podcastCache.items[it.CollectionID] = cachedItem{at: now, item: it}
			}
			podcastCache.Unlock()
			mu.Unlock()
		}()
	}
	wg.Wait()
	return out
}

/* --------------------------------------------------------------- ranking */

type podcastCandidate struct {
	item       itunesItem
	summary    string
	chartRank  int           // 1-based; 0 = not from a chart
	chart      *podcastTopic // nil with chartRank > 0 = the overall chart
	keyword    string        // the search word that found it
	topicScore float64       // 0..1, how much the reader cares about its source
}

// podcastFeedKey compares feed URLs the way subscriptions are deduplicated:
// scheme, "www.", host case and a trailing slash do not matter. Unlike
// normalizeHost it keeps the path, because hosting platforms put thousands of
// shows on one host.
func podcastFeedKey(raw string) string {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return strings.ToLower(strings.TrimRight(raw, "/"))
	}
	key := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.") + strings.TrimRight(u.EscapedPath(), "/")
	if u.RawQuery != "" {
		key += "?" + u.RawQuery
	}
	return key
}

func releaseTime(raw string) time.Time {
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}
	}
	return t
}

func trimRunes(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

// rankPodcasts filters and orders the merged candidates. Shows in exclude are
// only used to top the list up once fresh ones run out, so the list never
// shrinks after many refreshes.
func rankPodcasts(cands []*podcastCandidate, weights map[string]float64, subscribed, exclude []string, limit int, now time.Time) []model.PodcastSuggestion {
	subs := make(map[string]bool, len(subscribed))
	for _, u := range subscribed {
		subs[podcastFeedKey(u)] = true
	}
	shown := make(map[string]bool, len(exclude))
	for _, u := range exclude {
		shown[podcastFeedKey(u)] = true
	}

	type scored struct {
		c      *podcastCandidate
		score  float64
		source string
		seen   bool
	}
	var list []scored
	var maxText float64
	texts := make([]float64, len(cands))
	for i, c := range cands {
		ts := terms(c.item.CollectionName + " " + c.item.ArtistName + " " + strings.Join(c.item.Genres, " ") + " " + c.summary)
		var sum float64
		for _, t := range ts {
			sum += math.Log1p(weights[t])
		}
		if len(ts) > 0 {
			texts[i] = sum / math.Sqrt(float64(len(ts)))
		}
		maxText = math.Max(maxText, texts[i])
	}

	seenKeys := map[string]bool{}
	for i, c := range cands {
		it := c.item
		key := podcastFeedKey(it.FeedURL)
		if it.FeedURL == "" || subs[key] || seenKeys[key] {
			continue
		}
		if it.Kind != "" && it.Kind != "podcast" {
			continue
		}
		if it.TrackCount > 0 && it.TrackCount < 3 {
			continue
		}
		released := releaseTime(it.ReleaseDate)
		if !released.IsZero() && now.Sub(released) > podcastMaxAge {
			continue
		}
		seenKeys[key] = true

		score := c.topicScore
		if maxText > 0 {
			score += 1.2 * texts[i] / maxText
		}
		if c.chartRank > 0 {
			score += 1 - float64(c.chartRank-1)/podcastChartLen
		}
		if c.keyword != "" {
			score += 0.4
		}
		switch age := now.Sub(released); {
		case released.IsZero():
			score -= 0.2
		case age <= 14*24*time.Hour:
			score += 0.6
		case age <= 60*24*time.Hour:
			score += 0.3
		case age > 180*24*time.Hour:
			score -= 0.4
		}
		if it.TrackCount >= 20 {
			score += 0.2
		}

		source := "search:" + c.keyword
		if c.keyword == "" {
			source = "chart:"
			if c.chart != nil {
				source += c.chart.Name
			}
		}
		list = append(list, scored{c: c, score: score, source: source, seen: shown[key]})
	}
	sort.SliceStable(list, func(a, b int) bool {
		if list[a].seen != list[b].seen {
			return !list[a].seen
		}
		return list[a].score > list[b].score
	})

	// No single chart or search may fill the whole list.
	perSource := max(2, (limit+1)/2)
	picked := make([]scored, 0, limit)
	used := map[int]bool{}
	counts := map[string]int{}
	for pass := 0; pass < 2 && len(picked) < limit; pass++ {
		for i, s := range list {
			if len(picked) >= limit {
				break
			}
			if used[i] || (pass == 0 && counts[s.source] >= perSource) {
				continue
			}
			used[i] = true
			counts[s.source]++
			picked = append(picked, s)
		}
	}

	out := make([]model.PodcastSuggestion, 0, len(picked))
	for _, s := range picked {
		it := s.c.item
		art := it.Artwork600
		if art == "" {
			art = it.Artwork100
		}
		art = strings.Replace(art, "600x600bb", "300x300bb", 1)
		var last int64
		if t := releaseTime(it.ReleaseDate); !t.IsZero() {
			last = t.UnixMilli()
		}
		reason := ""
		switch {
		case s.c.keyword != "":
			reason = "和你常读的「" + s.c.keyword + "」相关"
		case s.c.chart != nil:
			reason = fmt.Sprintf("「%s」榜第 %d 名", s.c.chart.Name, s.c.chartRank)
		case s.c.chartRank > 0:
			reason = fmt.Sprintf("播客总榜第 %d 名", s.c.chartRank)
		}
		out = append(out, model.PodcastSuggestion{
			Title:         strings.TrimSpace(it.CollectionName),
			Author:        strings.TrimSpace(it.ArtistName),
			URL:           it.FeedURL,
			PageURL:       it.ViewURL,
			ArtworkURL:    art,
			Genre:         it.Genre,
			Description:   trimRunes(s.c.summary, 120),
			EpisodeCount:  it.TrackCount,
			LastEpisodeAt: last,
			Reason:        reason,
			Score:         int(math.Round(s.score * 10)),
		})
	}
	return out
}

// RecommendPodcasts runs one round: plan, fetch the charts and searches in
// parallel, resolve feed URLs, then rank.
func (f *Fetcher) RecommendPodcasts(ctx context.Context, req PodcastRequest) ([]model.PodcastSuggestion, error) {
	if req.Limit <= 0 {
		req.Limit = 8
	}
	weights := interestWeights(req.Interest)
	plan := planPodcastRound(rankTopics(weights), req.Round)

	type chartResult struct {
		pick  chartPick
		items []chartItem
	}
	charts := make([]chartResult, len(plan.charts))
	searches := make([][]itunesItem, len(plan.searches))
	var failures int
	var mu sync.Mutex
	var wg sync.WaitGroup
	fail := func(what string, err error) {
		mu.Lock()
		failures++
		mu.Unlock()
		f.logf("podcast directory request failed", "what", what, "err", err.Error())
	}
	for i, p := range plan.charts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			body, err := f.directoryGet(ctx, chartURL(p.topic))
			if err == nil {
				var items []chartItem
				if items, err = parseChart(body); err == nil {
					charts[i] = chartResult{pick: p, items: items}
					return
				}
			}
			fail("chart", err)
		}()
	}
	for i, s := range plan.searches {
		wg.Add(1)
		go func() {
			defer wg.Done()
			body, err := f.directoryGet(ctx, searchURL(s.keyword))
			if err == nil {
				var resp itunesResponse
				if err = json.Unmarshal(body, &resp); err == nil {
					searches[i] = resp.Results
					return
				}
			}
			fail("search "+s.keyword, err)
		}()
	}
	wg.Wait()
	if failures == len(plan.charts)+len(plan.searches) {
		return nil, errors.New("暂时连不上播客目录（Apple Podcasts），请稍后再试")
	}

	var cands []*podcastCandidate
	byID := map[int64]*podcastCandidate{}
	var ids []int64
	for _, cr := range charts {
		for _, ci := range cr.items {
			if byID[ci.id] != nil {
				continue
			}
			c := &podcastCandidate{
				item:       itunesItem{CollectionID: ci.id, CollectionName: ci.name},
				summary:    ci.summary,
				chartRank:  ci.rank,
				chart:      cr.pick.topic,
				topicScore: cr.pick.score,
			}
			byID[ci.id] = c
			cands = append(cands, c)
			ids = append(ids, ci.id)
		}
	}
	if len(ids) > 0 {
		shows := f.lookupShows(ctx, ids)
		for id, it := range shows {
			if c := byID[id]; c != nil {
				c.item = it
			}
		}
	}
	for i, results := range searches {
		for _, it := range results {
			if c := byID[it.CollectionID]; c != nil {
				// Found by both: the search word is the more personal reason.
				c.keyword = plan.searches[i].keyword
				c.topicScore = math.Max(c.topicScore, plan.searches[i].score)
				continue
			}
			c := &podcastCandidate{item: it, keyword: plan.searches[i].keyword, topicScore: plan.searches[i].score}
			byID[it.CollectionID] = c
			cands = append(cands, c)
		}
	}

	return rankPodcasts(cands, weights, req.Subscribed, req.Exclude, req.Limit, time.Now()), nil
}

// SelfTestPodcasts checks the offline half of the recommender: chart parsing,
// topic choice, round rotation and filtering. `--recommend` exercises the
// network half against the real directory.
func SelfTestPodcasts() error {
	chart := []byte(`{"feed":{"entry":[
		{"im:name":{"label":"硅谷101"},"summary":{"label":"科技"},"id":{"label":"x","attributes":{"im:id":"1"}}},
		{"im:name":{"label":"声东击西"},"id":{"label":"y","attributes":{"im:id":"2"}}}]}}`)
	items, err := parseChart(chart)
	if err != nil || len(items) != 2 || items[1].id != 2 || items[1].rank != 2 {
		return fmt.Errorf("podcasts: chart parse got %+v, %v", items, err)
	}
	one, err := parseChart([]byte(`{"feed":{"entry":{"im:name":{"label":"a"},"id":{"attributes":{"im:id":"7"}}}}}`))
	if err != nil || len(one) != 1 || one[0].id != 7 {
		return fmt.Errorf("podcasts: single-entry chart got %+v, %v", one, err)
	}

	weights := interestWeights([]string{"Go 编程 开源 软件 编程 互联网", "创业 投资"})
	ranked := rankTopics(weights)
	if ranked[0].topic.Name != "科技" {
		return fmt.Errorf("podcasts: programming reader ranked %q first", ranked[0].topic.Name)
	}
	p0, p1 := planPodcastRound(ranked, 0), planPodcastRound(ranked, 1)
	if p0.charts[0].topic.Name != "科技" || len(p0.searches) == 0 {
		return fmt.Errorf("podcasts: plan lost the main topic: %+v", p0)
	}
	if p0.searches[0].keyword == p1.searches[0].keyword {
		return fmt.Errorf("podcasts: search word did not rotate between rounds")
	}
	if cold := planPodcastRound(rankTopics(nil), 0); len(cold.charts) != 3 || cold.charts[0].topic != nil || len(cold.searches) != 0 {
		return fmt.Errorf("podcasts: cold-start plan %+v", cold)
	}

	now := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	fresh := now.Add(-72 * time.Hour).Format(time.RFC3339)
	cands := []*podcastCandidate{
		{item: itunesItem{CollectionID: 1, CollectionName: "编程随想", FeedURL: "https://feed.example.com/a", TrackCount: 40, ReleaseDate: fresh}, chartRank: 1},
		{item: itunesItem{CollectionID: 2, CollectionName: "已订阅", FeedURL: "http://www.feed.example.com/b/", TrackCount: 40, ReleaseDate: fresh}, chartRank: 2},
		{item: itunesItem{CollectionID: 3, CollectionName: "停更", FeedURL: "https://feed.example.com/c", TrackCount: 40, ReleaseDate: "2023-01-01T00:00:00Z"}, chartRank: 3},
		{item: itunesItem{CollectionID: 4, CollectionName: "没有订阅源"}, chartRank: 4},
		{item: itunesItem{CollectionID: 5, CollectionName: "看过的", FeedURL: "https://feed.example.com/e", TrackCount: 40, ReleaseDate: fresh}, chartRank: 5},
	}
	got := rankPodcasts(cands, weights, []string{"https://feed.example.com/b"}, []string{"https://feed.example.com/e"}, 5, now)
	if len(got) != 2 || got[0].Title != "编程随想" || got[1].Title != "看过的" {
		return fmt.Errorf("podcasts: filtering got %+v", got)
	}
	if got[0].Reason != "播客总榜第 1 名" {
		return fmt.Errorf("podcasts: reason %q", got[0].Reason)
	}
	return nil
}
