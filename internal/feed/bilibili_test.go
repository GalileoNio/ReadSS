package feed

import (
	"regexp"
	"strings"
	"testing"
)

func TestBilibiliOrigin(t *testing.T) {
	cases := map[string]string{
		"https://space.bilibili.com/546195/video": "https://space.bilibili.com",
		"https://www.bilibili.com":                "https://www.bilibili.com",
		"":                                        "https://www.bilibili.com",
		"not a url":                               "https://www.bilibili.com",
	}
	for referer, want := range cases {
		if got := bilibiliOrigin(referer); got != want {
			t.Errorf("bilibiliOrigin(%q) = %q, want %q", referer, got, want)
		}
	}
}

func TestBilibiliUUID(t *testing.T) {
	re := regexp.MustCompile(`^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}infoc$`)
	for i := 0; i < 8; i++ {
		if u := bilibiliUUID(); !re.MatchString(u) {
			t.Fatalf("bilibiliUUID() = %q, want v4 uuid with infoc suffix", u)
		}
	}
}

func TestBilibiliAPIError(t *testing.T) {
	cases := []struct {
		status int
		code   int
		want   string
	}{
		{412, -412, "B 站拒绝了这次请求（412），请稍后再试"},
		{200, -352, "B 站触发了风控校验，请稍后再试"},
		{200, -101, "B 站要求登录后才能读取该 UP 主的视频"},
		{200, -404, "B 站上找不到这个用户"},
	}
	for _, c := range cases {
		err := bilibiliAPIError(c.status, c.code, "")
		if err == nil || err.Error() != c.want {
			t.Errorf("bilibiliAPIError(%d, %d) = %v, want %q", c.status, c.code, err, c.want)
		}
	}
	if err := bilibiliAPIError(200, 0, ""); err != nil {
		t.Errorf("bilibiliAPIError(200, 0) = %v, want nil", err)
	}
}

func TestParseBilibiliReplies(t *testing.T) {
	body := []byte(`{"code":0,"message":"OK","data":{"page":{"num":1,"size":20,"count":89453},
	  "replies":[
	    {"rpid":1,"floor":2,"ctime":1291918239,"like":54958,
	     "member":{"uname":"碧诗","avatar":"//i2.hdslb.com/bfs/face/a.jpg"},
	     "content":{"message":"第一条 <b>不是标签</b>\n第二行"},
	     "replies":[{"rpid":11,"ctime":1291918240,"like":3,
	       "member":{"uname":"回复者","avatar":""},
	       "content":{"message":"楼中楼"}}]},
	    {"rpid":2,"floor":3,"ctime":1291918250,"like":0,
	     "member":{"uname":"路人","avatar":""},
	     "content":{"message":"带图的评论","pictures":[{"img_src":"//i0.hdslb.com/a.jpg"}]}}
	  ]}}`)

	items, err := parseBilibiliReplies(200, body)
	if err != nil {
		t.Fatalf("parseBilibiliReplies: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("parsed %d replies, want 2", len(items))
	}
	if got := countGenericComments(items); got != 3 {
		t.Errorf("comment count = %d, want 3 (including the nested reply)", got)
	}

	rendered := SanitizeHTML(renderGenericComments(items, 0))
	for _, want := range []string{
		"碧诗", "第一条", "第二行", "楼中楼", "回复者", "路人",
		`<span class="comment-floor">2</span>`,
		`<span class="comment-like">5.5万</span>`,
		`src="https://i0.hdslb.com/a.jpg"`,
	} {
		if !strings.Contains(rendered, want) {
			t.Errorf("rendered comments lost %q in %s", want, rendered)
		}
	}
	// Bilibili messages are plain text. Angle brackets must be escaped, not
	// treated as markup.
	if strings.Contains(rendered, "<b>不是标签</b>") {
		t.Errorf("comment text was not escaped: %s", rendered)
	}
}

func TestParseBilibiliRepliesTopAndErrors(t *testing.T) {
	body := []byte(`{"code":0,"message":"OK","data":{
	  "page":{"count":1},
	  "top":{"rpid":9,"ctime":1700000000,"like":1,
	    "member":{"uname":"置顶"},"content":{"message":"置顶评论"}},
	  "replies":[{"rpid":9,"ctime":1700000000,"like":1,
	    "member":{"uname":"置顶"},"content":{"message":"置顶评论"}}]}}`)
	items, err := parseBilibiliReplies(200, body)
	if err != nil {
		t.Fatalf("parseBilibiliReplies: %v", err)
	}
	if len(items) != 1 {
		t.Errorf("pinned reply was duplicated: %d items", len(items))
	}

	if _, err := parseBilibiliReplies(200, []byte(`{"code":-352,"message":"风控校验失败"}`)); err == nil {
		t.Error("an error envelope was accepted as a comment page")
	}
}
