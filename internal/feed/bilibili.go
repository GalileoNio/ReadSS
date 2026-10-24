package feed

import (
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"reads/internal/model"
	"reads/internal/store"
)

// Bilibili is the one video platform without a public RSS feed, so this file
// speaks its web API directly: the space card identifies an UP 主, the WBI
// signed archive endpoint lists their latest videos, and both are normalised
// into the same FetchResult the RSS path produces.

const (
	bilibiliAPI = "https://api.bilibili.com"
	bilibiliWeb = "https://www.bilibili.com"

	// A plain browser UA matters here: Bilibili risk control rejects clients
	// that advertise themselves as feed readers.
	bilibiliUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
		"(KHTML, like Gecko) Chrome/124.0 Safari/537.36"

	// The signed space endpoint expects a browser fingerprint. These three
	// values describe a Chromium/ANGLE renderer; the endpoint answers -352
	// without them even when the WBI signature is correct.
	bilibiliDMImgList  = "[]"
	bilibiliDMImg      = "V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ"
	bilibiliDMCoverImg = "QU5HTEUgKE5WSURJQSwgTlZJRElBIEdlRm9yY2UgR1RYIDE2NTAgKDB4MDAwMDFGOTEpIERpcmVjdDNEMTEgdnNfNV8wIHBzXzVfMCwgRDNEMTEpR29vZ2xlIEluYy4gKE5WSURJQSkmZG1faW1nX2ludGVyPSIi"
	bilibiliDMImgInter = `{"ds":[],"wh":[0,0,0],"of":[0,0,0]}`
)

// bilibiliGate serialises requests with a small gap. Several subscriptions to
// Bilibili creators refresh concurrently (four workers), and bursts are what
// trip the platform's risk control.
var bilibiliGate struct {
	sync.Mutex
	next time.Time
}

func waitBilibili(ctx context.Context) error {
	bilibiliGate.Lock()
	defer bilibiliGate.Unlock()

	if wait := time.Until(bilibiliGate.next); wait > 0 {
		timer := time.NewTimer(wait)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
		}
	}
	bilibiliGate.next = time.Now().Add(900 * time.Millisecond)
	return nil
}

// Anonymous visitor cookies make a fresh install look like a normal browser
// session. They expire on Bilibili's side after a while, so they are renewed
// roughly every six hours (and never block a request if the probe fails).
var bilibiliSession struct {
	sync.Mutex
	header string
	at     time.Time
	nextAt time.Time
}

func (f *Fetcher) bilibiliCookieHeader(ctx context.Context) string {
	bilibiliSession.Lock()
	defer bilibiliSession.Unlock()

	if time.Now().Before(bilibiliSession.nextAt) {
		return bilibiliSession.header
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, bilibiliAPI+"/x/frontend/finger/spi", nil)
	if err != nil {
		return bilibiliSession.header
	}
	req.Header.Set("User-Agent", bilibiliUserAgent)
	req.Header.Set("Referer", bilibiliWeb)
	req.Header.Set("Accept", "application/json, text/plain, */*")

	resp, err := f.client.Do(req)
	if err != nil {
		bilibiliSession.nextAt = time.Now().Add(10 * time.Minute)
		return bilibiliSession.header
	}
	defer resp.Body.Close()
	body, err := readLimitedCap(resp.Body, 1<<20)
	if err != nil {
		bilibiliSession.nextAt = time.Now().Add(10 * time.Minute)
		return bilibiliSession.header
	}

	var env struct {
		Data struct {
			B3 string `json:"b_3"`
			B4 string `json:"b_4"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err == nil && env.Data.B3 != "" {
		header := fmt.Sprintf("buvid3=%s; buvid4=%s; b_nut=%d; _uuid=%s",
			env.Data.B3, env.Data.B4, time.Now().Unix(), bilibiliUUID())
		bilibiliSession.header = header
		bilibiliSession.at = time.Now()
		bilibiliSession.nextAt = time.Now().Add(6 * time.Hour)
		return header
	}

	bilibiliSession.nextAt = time.Now().Add(10 * time.Minute)
	return bilibiliSession.header
}

// bilibiliUUID mimics the _uuid cookie the web app writes on first load.
// Risk control treats a request without it as a non-browser client.
func bilibiliUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return ""
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return strings.ToUpper(fmt.Sprintf("%x-%x-%x-%x-%x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])) + "infoc"
}

// bilibiliGet issues one API request with browser headers and the shared pace
// limiter. Callers receive the raw body because Bilibili answers some blocks
// with HTTP 200 and a JSON error code.
func (f *Fetcher) bilibiliGet(ctx context.Context, raw, referer string) (int, []byte, error) {
	if err := waitBilibili(ctx); err != nil {
		return 0, nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return 0, nil, errors.New("无法构造请求")
	}
	req.Header.Set("User-Agent", bilibiliUserAgent)
	req.Header.Set("Referer", referer)
	req.Header.Set("Origin", bilibiliOrigin(referer))
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	req.Header.Set("Sec-Fetch-Dest", "empty")
	req.Header.Set("Sec-Fetch-Mode", "cors")
	req.Header.Set("Sec-Fetch-Site", "same-site")
	if cookie := f.bilibiliCookieHeader(ctx); cookie != "" {
		req.Header.Set("Cookie", cookie)
	}

	resp, err := f.client.Do(req)
	if err != nil {
		return 0, nil, friendlyNetErr(err)
	}
	defer resp.Body.Close()

	body, err := readLimitedCap(resp.Body, 8<<20)
	if err != nil {
		return 0, nil, err
	}
	return resp.StatusCode, body, nil
}

// bilibiliOrigin derives the Origin header from the page a request pretends
// to come from; a www.bilibili.com origin on an api call made by a space page
// is one of the signals risk control looks at.
func bilibiliOrigin(referer string) string {
	u, err := url.Parse(strings.TrimSpace(referer))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return bilibiliWeb
	}
	return u.Scheme + "://" + u.Host
}

// bilibiliAPIError turns the platform's error envelope into a message a reader
// can act on. Risk-control failures are worth naming: the usual cause is a
// burst of requests, not a wrong UID.
func bilibiliAPIError(status int, code int, message string) error {
	switch {
	case status == http.StatusTooManyRequests:
		return errors.New("B 站请求过于频繁，请稍后再试")
	case status == http.StatusPreconditionFailed || code == -412:
		return errors.New("B 站拒绝了这次请求（412），请稍后再试")
	case code == -352 || code == -401:
		return errors.New("B 站触发了风控校验，请稍后再试")
	case code == -101:
		return errors.New("B 站要求登录后才能读取该 UP 主的视频")
	case code == -404:
		return errors.New("B 站上找不到这个用户")
	case code != 0:
		if strings.TrimSpace(message) == "" {
			message = fmt.Sprintf("错误码 %d", code)
		}
		return fmt.Errorf("B 站接口返回：%s", message)
	}
	if status < 200 || status > 299 {
		return fmt.Errorf("服务器返回 %d", status)
	}
	return nil
}

/* --------------------------------------------------------------- WBI sign */

// The WBI mixin table is fixed by Bilibili. It reorders the concatenated
// img_key/sub_key before the first 32 characters become the signing key.
var wbiMixinTab = []int{
	46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
	27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
	37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
	22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
}

var bilibiliWBI struct {
	sync.Mutex
	key string
	at  time.Time
}

func (f *Fetcher) bilibiliWBIKey(ctx context.Context) (string, error) {
	bilibiliWBI.Lock()
	defer bilibiliWBI.Unlock()

	if bilibiliWBI.key != "" && time.Since(bilibiliWBI.at) < 30*time.Minute {
		return bilibiliWBI.key, nil
	}

	status, body, err := f.bilibiliGet(ctx, bilibiliAPI+"/x/web-interface/nav", bilibiliWeb)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", bilibiliAPIError(status, 0, "")
	}

	var env struct {
		Code int `json:"code"`
		Data struct {
			WbiImg struct {
				ImgURL string `json:"img_url"`
				SubURL string `json:"sub_url"`
			} `json:"wbi_img"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return "", errors.New("无法读取 B 站签名密钥")
	}

	imgKey := wbiKeyName(env.Data.WbiImg.ImgURL)
	subKey := wbiKeyName(env.Data.WbiImg.SubURL)
	if imgKey == "" || subKey == "" {
		// Guests get code -101 from nav, but the WBI keys are still valid.
		// Only surface the API error when the keys themselves are missing.
		if env.Code != 0 {
			return "", bilibiliAPIError(status, env.Code, "")
		}
		return "", errors.New("无法读取 B 站签名密钥")
	}

	raw := imgKey + subKey
	var b strings.Builder
	for _, i := range wbiMixinTab {
		if i < len(raw) {
			b.WriteByte(raw[i])
		}
	}
	key := b.String()
	if len(key) > 32 {
		key = key[:32]
	}
	if key == "" {
		return "", errors.New("无法读取 B 站签名密钥")
	}

	bilibiliWBI.key = key
	bilibiliWBI.at = time.Now()
	return key, nil
}

func wbiKeyName(rawURL string) string {
	base := path.Base(rawURL)
	return strings.TrimSuffix(base, path.Ext(base))
}

// bilibiliSign appends wts and w_rid to the query. Values must be encoded the
// same way for hashing and for the request, so url.Values.Encode() is used once
// and then reused verbatim.
func bilibiliSign(params url.Values, mixin string) string {
	params.Set("wts", strconv.FormatInt(time.Now().Unix(), 10))
	query := params.Encode()
	sum := md5.Sum([]byte(query + mixin))
	return query + "&w_rid=" + hex.EncodeToString(sum[:])
}

/* ------------------------------------------------------------- resolution */

func bilibiliSpaceURL(mid string) string {
	return "https://space.bilibili.com/" + mid
}

func httpsify(raw string) string {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "//") {
		return "https:" + raw
	}
	if strings.HasPrefix(raw, "http://") {
		return "https://" + strings.TrimPrefix(raw, "http://")
	}
	return raw
}

func bilibiliSpaceID(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	switch {
	case host == "space.bilibili.com":
		if parts := splitPath(u.Path); len(parts) > 0 && isDigits(parts[0]) {
			return parts[0]
		}
	case host == "m.bilibili.com", host == "www.bilibili.com":
		parts := splitPath(u.Path)
		for i, p := range parts {
			if p == "space" && i+1 < len(parts) && isDigits(parts[i+1]) {
				return parts[i+1]
			}
		}
	}
	return ""
}

// bilibiliVideoRef extracts a video identifier from a video URL.
func bilibiliVideoRef(raw string) (bvid string, aid int64) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || !strings.Contains(strings.ToLower(u.Hostname()), "bilibili.com") {
		return "", 0
	}
	parts := splitPath(u.Path)
	for i, p := range parts {
		if p != "video" || i+1 >= len(parts) {
			continue
		}
		id := parts[i+1]
		upper := strings.ToUpper(id)
		if strings.HasPrefix(upper, "BV") {
			return id, 0
		}
		if strings.HasPrefix(upper, "AV") {
			n, _ := strconv.ParseInt(id[2:], 10, 64)
			return "", n
		}
	}
	return "", 0
}

func splitPath(p string) []string {
	p = strings.Trim(p, "/")
	if p == "" {
		return nil
	}
	return strings.Split(p, "/")
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

type cachedBilibiliChannel struct {
	channel model.VideoChannel
	at      time.Time
}

var bilibiliChannelCache = struct {
	sync.Mutex
	items map[string]cachedBilibiliChannel
}{items: make(map[string]cachedBilibiliChannel)}

// bilibiliChannel resolves an UP 主 by numeric mid. Card data changes slowly
// (name, avatar, follower count), so it is cached briefly: refreshes should not
// spend a risk-control budget on metadata that has not moved.
func (f *Fetcher) bilibiliChannel(ctx context.Context, mid string) (*model.VideoChannel, error) {
	mid = strings.TrimSpace(mid)
	if !isDigits(mid) {
		return nil, errors.New("B 站用户 ID 应该是数字")
	}

	bilibiliChannelCache.Lock()
	if hit, ok := bilibiliChannelCache.items[mid]; ok && time.Since(hit.at) < time.Hour {
		bilibiliChannelCache.Unlock()
		channel := hit.channel
		return &channel, nil
	}
	bilibiliChannelCache.Unlock()

	status, body, err := f.bilibiliGet(ctx, bilibiliAPI+"/x/web-interface/card?mid="+url.QueryEscape(mid), bilibiliSpaceURL(mid))
	if err != nil {
		return nil, err
	}

	var env struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			ArchiveCount int `json:"archive_count"`
			Card         struct {
				Mid      string `json:"mid"`
				Name     string `json:"name"`
				Face     string `json:"face"`
				Fans     int    `json:"fans"`
				Sign     string `json:"sign"`
				Official struct {
					Type int    `json:"type"`
					Desc string `json:"desc"`
				} `json:"Official"`
				OfficialVerify struct {
					Type int    `json:"type"`
					Desc string `json:"desc"`
				} `json:"official_verify"`
			} `json:"card"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		if apiErr := bilibiliAPIError(status, 0, ""); apiErr != nil {
			return nil, apiErr
		}
		return nil, errors.New("无法解析 B 站用户信息")
	}
	if err := bilibiliAPIError(status, env.Code, env.Message); err != nil {
		return nil, err
	}

	name := strings.TrimSpace(env.Data.Card.Name)
	if name == "" {
		name = "B站 UP主 " + mid
	}
	description := strings.TrimSpace(env.Data.Card.Sign)
	verified := strings.TrimSpace(env.Data.Card.Official.Desc) != "" ||
		strings.TrimSpace(env.Data.Card.OfficialVerify.Desc) != ""

	channel := model.VideoChannel{
		Platform:    model.VideoPlatformBilibili,
		ID:          mid,
		Name:        PlainText(name),
		AvatarURL:   httpsify(env.Data.Card.Face),
		Description: description,
		URL:         bilibiliSpaceURL(mid),
		FeedURL:     bilibiliSpaceURL(mid),
		Subscribers: env.Data.Card.Fans,
		Videos:      env.Data.ArchiveCount,
		Verified:    verified,
	}

	bilibiliChannelCache.Lock()
	bilibiliChannelCache.items[mid] = cachedBilibiliChannel{channel: channel, at: time.Now()}
	bilibiliChannelCache.Unlock()

	return &channel, nil
}

// bilibiliSearchUsers finds users by name, which is how a reader can type
// "老番茄" instead of remembering a numeric UID.
func (f *Fetcher) bilibiliSearchUsers(ctx context.Context, query string, limit int) ([]model.VideoChannel, error) {
	raw := bilibiliAPI + "/x/web-interface/search/type?search_type=bili_user&page=1&keyword=" + url.QueryEscape(query)
	status, body, err := f.bilibiliGet(ctx, raw, "https://search.bilibili.com")
	if err != nil {
		return nil, err
	}

	var env struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			Result []struct {
				Mid            int64  `json:"mid"`
				Uname          string `json:"uname"`
				Usign          string `json:"usign"`
				Fans           int    `json:"fans"`
				Videos         int    `json:"videos"`
				Upic           string `json:"upic"`
				OfficialVerify struct {
					Type int    `json:"type"`
					Desc string `json:"desc"`
				} `json:"official_verify"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		if apiErr := bilibiliAPIError(status, 0, ""); apiErr != nil {
			return nil, apiErr
		}
		return nil, errors.New("无法解析 B 站用户搜索")
	}
	if err := bilibiliAPIError(status, env.Code, env.Message); err != nil {
		return nil, err
	}

	out := make([]model.VideoChannel, 0, len(env.Data.Result))
	seen := map[int64]bool{}
	for _, r := range env.Data.Result {
		if r.Mid <= 0 || seen[r.Mid] {
			continue
		}
		seen[r.Mid] = true
		mid := strconv.FormatInt(r.Mid, 10)
		name := PlainText(strings.TrimSpace(r.Uname))
		if name == "" {
			name = "B站 UP主 " + mid
		}
		out = append(out, model.VideoChannel{
			Platform:    model.VideoPlatformBilibili,
			ID:          mid,
			Name:        name,
			AvatarURL:   httpsify(r.Upic),
			Description: strings.TrimSpace(r.Usign),
			URL:         bilibiliSpaceURL(mid),
			FeedURL:     bilibiliSpaceURL(mid),
			Subscribers: r.Fans,
			Videos:      r.Videos,
			Verified:    strings.TrimSpace(r.OfficialVerify.Desc) != "",
		})
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out, nil
}

// bilibiliVideoOwner turns a video URL into the UP 主 who published it, so
// pasting a Bilibili video also works as a subscription input.
func (f *Fetcher) bilibiliVideoOwner(ctx context.Context, bvid string, aid int64) (*model.VideoChannel, error) {
	raw := bilibiliAPI + "/x/web-interface/view?"
	if bvid != "" {
		raw += "bvid=" + url.QueryEscape(bvid)
	} else if aid > 0 {
		raw += "aid=" + strconv.FormatInt(aid, 10)
	} else {
		return nil, errors.New("无法识别这个 B 站视频")
	}

	status, body, err := f.bilibiliGet(ctx, raw, bilibiliWeb)
	if err != nil {
		return nil, err
	}
	var env struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			Title string `json:"title"`
			Owner struct {
				Mid  int64  `json:"mid"`
				Name string `json:"name"`
				Face string `json:"face"`
			} `json:"owner"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		if apiErr := bilibiliAPIError(status, 0, ""); apiErr != nil {
			return nil, apiErr
		}
		return nil, errors.New("无法解析 B 站视频信息")
	}
	if err := bilibiliAPIError(status, env.Code, env.Message); err != nil {
		return nil, err
	}
	if env.Data.Owner.Mid <= 0 {
		return nil, errors.New("这个 B 站视频没有作者信息")
	}

	mid := strconv.FormatInt(env.Data.Owner.Mid, 10)
	channel, cardErr := f.bilibiliChannel(ctx, mid)
	if cardErr == nil {
		return channel, nil
	}
	name := strings.TrimSpace(env.Data.Owner.Name)
	if name == "" {
		name = "B站 UP主 " + mid
	}
	return &model.VideoChannel{
		Platform:  model.VideoPlatformBilibili,
		ID:        mid,
		Name:      PlainText(name),
		AvatarURL: httpsify(env.Data.Owner.Face),
		URL:       bilibiliSpaceURL(mid),
		FeedURL:   bilibiliSpaceURL(mid),
	}, nil
}

/* ------------------------------------------------------------------ fetch */

// fetchBilibiliSpace lists the newest videos of one UP 主. It is called from
// Fetcher.Fetch when the stored feed URL is a space page.
func (f *Fetcher) fetchBilibiliSpace(ctx context.Context, feedURL, mid string) (*FetchResult, error) {
	key, err := f.bilibiliWBIKey(ctx)
	if err != nil {
		return nil, err
	}

	params := url.Values{}
	params.Set("mid", mid)
	params.Set("ps", "30")
	params.Set("pn", "1")
	params.Set("order", "pubdate")
	params.Set("dm_img_list", bilibiliDMImgList)
	params.Set("dm_img_str", bilibiliDMImg)
	params.Set("dm_cover_img_str", bilibiliDMCoverImg)
	params.Set("dm_img_inter", bilibiliDMImgInter)
	signed := bilibiliSign(params, key)

	status, body, err := f.bilibiliGet(ctx, bilibiliAPI+"/x/space/wbi/arc/search?"+signed, bilibiliSpaceURL(mid))
	if err != nil {
		return nil, err
	}

	var env struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			List struct {
				VList []struct {
					AID         int64  `json:"aid"`
					BVID        string `json:"bvid"`
					Title       string `json:"title"`
					Description string `json:"description"`
					Pic         string `json:"pic"`
					PubDate     int64  `json:"pubdate"`
					Author      string `json:"author"`
					Mid         int64  `json:"mid"`
				} `json:"vlist"`
			} `json:"list"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		if apiErr := bilibiliAPIError(status, 0, ""); apiErr != nil {
			return nil, apiErr
		}
		return nil, errors.New("无法解析 B 站视频列表")
	}
	if err := bilibiliAPIError(status, env.Code, env.Message); err != nil {
		return nil, err
	}

	// Card metadata is best-effort: the video list already carries the author
	// name, so a metadata hiccup must not fail the whole refresh.
	channel, _ := f.bilibiliChannel(ctx, mid)

	title := ""
	description := ""
	icon := ""
	if channel != nil {
		title = channel.Name
		description = channel.Description
		icon = channel.AvatarURL
	}
	if title == "" && len(env.Data.List.VList) > 0 {
		title = PlainText(env.Data.List.VList[0].Author)
	}
	if title == "" {
		title = "B站 UP主 " + mid
	}

	items := make([]store.FeedItem, 0, len(env.Data.List.VList))
	for _, v := range env.Data.List.VList {
		videoTitle := PlainText(strings.TrimSpace(v.Title))
		if videoTitle == "" {
			continue
		}

		link := ""
		guid := ""
		switch {
		case strings.TrimSpace(v.BVID) != "":
			link = bilibiliWeb + "/video/" + strings.TrimSpace(v.BVID)
			guid = "bilibili:" + strings.TrimSpace(v.BVID)
		case v.AID > 0:
			link = bilibiliWeb + "/video/av" + strconv.FormatInt(v.AID, 10)
			guid = "bilibili:av" + strconv.FormatInt(v.AID, 10)
		default:
			continue
		}

		pic := httpsify(v.Pic)
		desc := strings.TrimSpace(v.Description)
		var content strings.Builder
		if pic != "" {
			content.WriteString(`<p><img src="`)
			content.WriteString(html.EscapeString(pic))
			content.WriteString(`" alt=""></p>`)
		}
		if desc != "" {
			content.WriteString("<p>")
			content.WriteString(strings.ReplaceAll(html.EscapeString(desc), "\n", "<br>"))
			content.WriteString("</p>")
		}

		items = append(items, store.FeedItem{
			GUID:        guid,
			Title:       videoTitle,
			URL:         link,
			Author:      title,
			Summary:     Truncate(desc, 300),
			Content:     content.String(),
			ImageURL:    pic,
			PublishedAt: v.PubDate * 1000,
		})
	}

	return &FetchResult{
		Title:       title,
		SiteURL:     firstNonEmpty(bilibiliSpaceURL(mid), feedURL),
		Description: Truncate(description, 240),
		IconURL:     icon,
		Items:       items,
		View:        model.ViewVideos,
	}, nil
}
