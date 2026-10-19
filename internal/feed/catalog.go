package feed

import "reads/internal/model"

// Catalog is the pool of subscription suggestions shown in the discover pane.
//
// The app cannot invent feeds it has never seen, so suggestions come from this
// curated list: real, publicly readable RSS endpoints with a few tags each.
// Tagging is what makes the list feel personal — RankFeeds matches these tags
// (and the description) against the reader's own subscriptions and history.
// Anything already subscribed is filtered out at request time, so this list can
// safely include feeds the reader may already follow.
var Catalog = []model.FeedSuggestion{
	// 中文 · 科技 / 数码
	{Title: "品玩 PingWest", URL: "https://www.pingwest.com/feed", SiteURL: "https://www.pingwest.com", Description: "科技产业与互联网公司报道", Tags: []string{"科技", "互联网", "商业"}},
	{Title: "极客公园", URL: "https://www.geekpark.net/rss", SiteURL: "https://www.geekpark.net", Description: "科技产品与创业公司观察", Tags: []string{"科技", "互联网", "创业"}},
	{Title: "虎嗅", URL: "https://www.huxiu.com/rss/0.xml", SiteURL: "https://www.huxiu.com", Description: "商业资讯与产业分析", Tags: []string{"商业", "科技", "互联网"}},
	{Title: "Solidot", URL: "https://www.solidot.org/index.rss", SiteURL: "https://www.solidot.org", Description: "奇客新闻：科技与开源社区动态", Tags: []string{"科技", "开源", "linux"}},
	{Title: "机核 GCORES", URL: "https://www.gcores.com/rss", SiteURL: "https://www.gcores.com", Description: "游戏、二次元与亚文化", Tags: []string{"游戏", "二次元", "文化"}},
	{Title: "科学松鼠会", URL: "https://songshuhui.net/feed", SiteURL: "https://songshuhui.net", Description: "科普写作与科学话题", Tags: []string{"科学", "科普"}},
	{Title: "小众软件", URL: "https://www.appinn.com/feed/", SiteURL: "https://www.appinn.com", Description: "实用软件与效率工具推荐", Tags: []string{"软件", "效率", "工具"}},
	{Title: "异次元软件世界", URL: "https://www.iplaysoft.com/feed", SiteURL: "https://www.iplaysoft.com", Description: "软件、应用与效率技巧", Tags: []string{"软件", "效率", "工具"}},
	{Title: "少数派", URL: "https://sspai.com/feed", SiteURL: "https://sspai.com", Description: "高效工作与数字生活", Tags: []string{"科技", "效率", "数字生活"}},
	{Title: "数字尾巴", URL: "https://www.dgtle.com/rss/dgtle.xml", SiteURL: "https://www.dgtle.com", Description: "数码产品与生活方式", Tags: []string{"数码", "摄影", "生活方式"}},
	{Title: "爱范儿", URL: "https://www.ifanr.com/feed", SiteURL: "https://www.ifanr.com", Description: "科技产品与消费电子", Tags: []string{"科技", "数码", "消费电子"}},

	// 中文 · 编程 / 开源
	{Title: "酷壳 CoolShell", URL: "https://coolshell.cn/feed", SiteURL: "https://coolshell.cn", Description: "编程、系统与工程实践", Tags: []string{"编程", "技术", "架构"}},
	{Title: "美团技术团队", URL: "https://tech.meituan.com/feed/", SiteURL: "https://tech.meituan.com", Description: "美团技术团队工程博客", Tags: []string{"编程", "技术", "架构"}},
	{Title: "阿里云开发者社区", URL: "https://developer.aliyun.com/feed", SiteURL: "https://developer.aliyun.com", Description: "云计算与开发实践", Tags: []string{"编程", "云", "技术"}},

	// 中文 · 阅读 / 文化
	{Title: "书伴", URL: "https://bookfere.com/feed", SiteURL: "https://bookfere.com", Description: "电子书阅读与 Kindle 技巧", Tags: []string{"阅读", "电子书", "工具"}},

	// English · tech
	{Title: "Hacker News", URL: "https://news.ycombinator.com/rss", SiteURL: "https://news.ycombinator.com", Description: "程序设计、创业与技术社区热帖", Tags: []string{"编程", "科技", "创业"}},
	{Title: "The Verge", URL: "https://www.theverge.com/rss/index.xml", SiteURL: "https://www.theverge.com", Description: "科技新闻与产品评测", Tags: []string{"科技", "数码", "新闻"}},
	{Title: "Ars Technica", URL: "https://feeds.arstechnica.com/arstechnica/index", SiteURL: "https://arstechnica.com", Description: "深度科技报道", Tags: []string{"科技", "科学", "新闻"}},
	{Title: "TechCrunch", URL: "https://techcrunch.com/feed/", SiteURL: "https://techcrunch.com", Description: "创业公司与风险投资", Tags: []string{"创业", "商业", "科技"}},
	{Title: "Wired", URL: "https://www.wired.com/feed/rss", SiteURL: "https://www.wired.com", Description: "科技、文化与未来", Tags: []string{"科技", "文化", "科学"}},
	{Title: "MIT Technology Review", URL: "https://www.technologyreview.com/feed/", SiteURL: "https://www.technologyreview.com", Description: "前沿科技与产业趋势", Tags: []string{"科技", "科学", "商业"}},
	{Title: "9to5Mac", URL: "https://9to5mac.com/feed/", SiteURL: "https://9to5mac.com", Description: "苹果生态新闻", Tags: []string{"苹果", "数码", "科技"}},
	{Title: "MacRumors", URL: "https://feeds.macrumors.com/MacRumors-All", SiteURL: "https://www.macrumors.com", Description: "苹果产品传闻与新闻", Tags: []string{"苹果", "数码"}},
	{Title: "Engadget", URL: "https://www.engadget.com/rss.xml", SiteURL: "https://www.engadget.com", Description: "消费电子与数码产品", Tags: []string{"数码", "科技", "消费电子"}},

	// English · engineering
	{Title: "Go Blog", URL: "https://go.dev/blog/feed.atom", SiteURL: "https://go.dev/blog", Description: "Go 官方博客", Tags: []string{"编程", "go", "开源"}},
	{Title: "Rust Blog", URL: "https://blog.rust-lang.org/feed.xml", SiteURL: "https://blog.rust-lang.org", Description: "Rust 官方博客", Tags: []string{"编程", "rust", "开源"}},
	{Title: "Python Insider", URL: "https://pythoninsider.blogspot.com/feeds/posts/default", SiteURL: "https://pythoninsider.blogspot.com", Description: "Python 官方发布动态", Tags: []string{"编程", "python", "开源"}},
	{Title: "Simon Willison", URL: "https://simonwillison.net/atom/everything/", SiteURL: "https://simonwillison.net", Description: "Python、数据与 LLM 实践", Tags: []string{"编程", "python", "ai"}},
	{Title: "Julia Evans", URL: "https://jvns.ca/atom.xml", SiteURL: "https://jvns.ca", Description: "系统、调试与计算机原理", Tags: []string{"编程", "系统", "linux"}},
	{Title: "Dan Luu", URL: "https://danluu.com/atom.xml", SiteURL: "https://danluu.com", Description: "性能、工程与行业观察", Tags: []string{"编程", "性能", "架构"}},
	{Title: "web.dev", URL: "https://web.dev/feed.xml", SiteURL: "https://web.dev", Description: "Web 平台与前端实践", Tags: []string{"前端", "web", "编程"}},
	{Title: "Smashing Magazine", URL: "https://www.smashingmagazine.com/feed/", SiteURL: "https://www.smashingmagazine.com", Description: "前端、设计与 UX", Tags: []string{"前端", "设计", "编程"}},
	{Title: "CSS-Tricks", URL: "https://css-tricks.com/feed/", SiteURL: "https://css-tricks.com", Description: "CSS 与前端技巧", Tags: []string{"前端", "css", "编程"}},
	{Title: "dev.to", URL: "https://dev.to/feed", SiteURL: "https://dev.to", Description: "开发者社区文章", Tags: []string{"编程", "技术"}},

	// English · science / security / design
	{Title: "Quanta Magazine", URL: "https://www.quantamagazine.org/feed/", SiteURL: "https://www.quantamagazine.org", Description: "数学、物理与生命科学", Tags: []string{"科学", "数学", "科普"}},
	{Title: "Nature", URL: "https://www.nature.com/nature.rss", SiteURL: "https://www.nature.com", Description: "自然科学期刊动态", Tags: []string{"科学", "研究"}},
	{Title: "Krebs on Security", URL: "https://krebsonsecurity.com/feed/", SiteURL: "https://krebsonsecurity.com", Description: "网络安全调查报道", Tags: []string{"安全", "科技"}},
	{Title: "Schneier on Security", URL: "https://www.schneier.com/feed/atom/", SiteURL: "https://www.schneier.com", Description: "安全与隐私评论", Tags: []string{"安全", "隐私"}},
	{Title: "Dezeen", URL: "https://www.dezeen.com/feed/", SiteURL: "https://www.dezeen.com", Description: "建筑与设计", Tags: []string{"设计", "建筑", "创意"}},
	{Title: "Design Milk", URL: "https://design-milk.com/feed/", SiteURL: "https://design-milk.com", Description: "现代设计与家居", Tags: []string{"设计", "家居", "创意"}},
	{Title: "PetaPixel", URL: "https://petapixel.com/feed/", SiteURL: "https://petapixel.com", Description: "摄影器材与作品", Tags: []string{"摄影", "数码"}},
	{Title: "Polygon", URL: "https://www.polygon.com/rss/index.xml", SiteURL: "https://www.polygon.com", Description: "游戏与文化", Tags: []string{"游戏", "文化"}},
}
