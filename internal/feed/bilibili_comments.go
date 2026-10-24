package feed

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/url"
	"strconv"
	"strings"
)

// Bilibili's video page is a single-page app: the served HTML never contains
// the thread, so the generic page scraper cannot read it. The platform's own
// public reply endpoint does answer anonymously, and that is what this file
// reads. A BV id is resolved to the numeric aid through the view endpoint,
// which is the identifier the reply endpoint expects.

// bilibiliReplyPageSize is the endpoint's maximum page size.
const bilibiliReplyPageSize = 20

// bilibiliReply mirrors the fields of one reply that the reader renders.
// Replies nest one level deep (the endpoint returns the first few direct
// answers under their parent), hence the recursive slice.
type bilibiliReply struct {
	RPID   int64 `json:"rpid"`
	Floor  int   `json:"floor"`
	Ctime  int64 `json:"ctime"`
	Like   int   `json:"like"`
	Member struct {
		UName  string `json:"uname"`
		Avatar string `json:"avatar"`
	} `json:"member"`
	Content struct {
		Message  string `json:"message"`
		Pictures []struct {
			ImgSrc string `json:"img_src"`
		} `json:"pictures"`
	} `json:"content"`
	Replies []bilibiliReply `json:"replies"`
}

// fetchBilibiliComments reads the hot replies of one video.
func (f *Fetcher) fetchBilibiliComments(ctx context.Context, pageURL *url.URL) (string, int, error) {
	bvid, aid := bilibiliVideoRef(pageURL.String())
	if aid <= 0 && bvid == "" {
		return "", 0, errors.New("无法识别这个 B 站视频")
	}
	referer := pageURL.String()

	if aid <= 0 {
		viewURL := bilibiliAPI + "/x/web-interface/view?bvid=" + url.QueryEscape(bvid)
		status, body, err := f.bilibiliGet(ctx, viewURL, referer)
		if err != nil {
			return "", 0, err
		}
		var env struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
			Data    struct {
				Aid int64 `json:"aid"`
			} `json:"data"`
		}
		if err := json.Unmarshal(body, &env); err != nil {
			if apiErr := bilibiliAPIError(status, 0, ""); apiErr != nil {
				return "", 0, apiErr
			}
			return "", 0, errors.New("无法解析 B 站视频信息")
		}
		if err := bilibiliAPIError(status, env.Code, env.Message); err != nil {
			return "", 0, err
		}
		aid = env.Data.Aid
	}
	if aid <= 0 {
		return "", 0, errors.New("这个 B 站视频没有评论编号")
	}

	// sort=2 is "hot", which is what a reader opening a video expects to see;
	// nohot=0 keeps pinned comments in the payload.
	endpoint := fmt.Sprintf("%s/x/v2/reply?type=1&oid=%d&sort=2&nohot=0&ps=%d&pn=1",
		bilibiliAPI, aid, bilibiliReplyPageSize)
	status, body, err := f.bilibiliGet(ctx, endpoint, referer)
	if err != nil {
		return "", 0, err
	}
	items, err := parseBilibiliReplies(status, body)
	if err != nil {
		return "", 0, err
	}
	if len(items) == 0 {
		return "", 0, nil
	}
	rendered := SanitizeHTML(renderGenericComments(items, 0))
	if strings.TrimSpace(PlainText(rendered)) == "" {
		return "", 0, nil
	}
	return rendered, countGenericComments(items), nil
}

// parseBilibiliReplies decodes one reply page and flattens it into the generic
// comment shape the shared renderer understands. The pinned "top" reply is
// merged in, and skipped when the list already contains it.
func parseBilibiliReplies(status int, body []byte) ([]map[string]any, error) {
	var env struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			Page struct {
				Count int `json:"count"`
			} `json:"page"`
			Replies []bilibiliReply `json:"replies"`
			Top     *bilibiliReply  `json:"top"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		if apiErr := bilibiliAPIError(status, 0, ""); apiErr != nil {
			return nil, apiErr
		}
		return nil, errors.New("无法解析 B 站评论")
	}
	if err := bilibiliAPIError(status, env.Code, env.Message); err != nil {
		return nil, err
	}

	replies := env.Data.Replies
	if top := env.Data.Top; top != nil && top.RPID != 0 {
		seen := false
		for _, r := range replies {
			if r.RPID == top.RPID {
				seen = true
				break
			}
		}
		if !seen {
			replies = append([]bilibiliReply{*top}, replies...)
		}
	}
	return bilibiliReplyMaps(replies), nil
}

// bilibiliReplyMaps converts replies into the renderer's generic model.
//
// The message is plain text, not HTML, so it is escaped here: the renderer
// inserts a comment body verbatim to preserve site-provided markup.
func bilibiliReplyMaps(replies []bilibiliReply) []map[string]any {
	if len(replies) == 0 {
		return nil
	}
	out := make([]map[string]any, 0, len(replies))
	for _, r := range replies {
		body := strings.TrimSpace(r.Content.Message)
		var b strings.Builder
		if body != "" {
			b.WriteString(strings.ReplaceAll(html.EscapeString(body), "\n", "<br>"))
		}
		for _, pic := range r.Content.Pictures {
			src := httpsify(pic.ImgSrc)
			if src == "" || !isSafeURL(src) {
				continue
			}
			if b.Len() > 0 {
				b.WriteString(" ")
			}
			b.WriteString(`<img src="` + html.EscapeString(src) + `" alt="" loading="lazy">`)
		}

		children := bilibiliReplyMaps(r.Replies)
		if b.Len() == 0 && len(children) == 0 {
			continue
		}
		// The renderer reads generic maps decoded from JSON, where numbers are
		// float64 and arrays are []any; keep the same shape here.
		replies := make([]any, 0, len(children))
		for _, child := range children {
			replies = append(replies, child)
		}
		item := map[string]any{
			"comment": b.String(),
			"user": map[string]any{
				"nickname": r.Member.UName,
				"avatar":   httpsify(r.Member.Avatar),
			},
			"likes":   float64(r.Like),
			"ctime":   float64(r.Ctime),
			"replies": replies,
		}
		if r.Floor > 0 {
			item["floor"] = strconv.Itoa(r.Floor) + "楼"
		}
		out = append(out, item)
	}
	return out
}
