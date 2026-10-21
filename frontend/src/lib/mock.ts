/**
 * In-memory stand-in for the Go service, used only when the app runs outside
 * the Wails shell (browser development and design verification).
 *
 * It implements the same method surface as internal/service so the UI code
 * never needs to know which backend it is talking to.
 */
import fixtureArticle from './fixture-article.json';
import type {
  AppInfo,
  Bootstrap,
  Category,
  Counts,
  DiscoveredFeed,
  EntryDetail,
  EntryPage,
  Feed,
  FeedSuggestion,
  ListQuery,
  PodcastSuggestion,
  RefreshProgress,
  RefreshResult,
  Settings,
  ViewKey,
} from './types';


/** Preview-only subscription suggestions, shaped like the Go catalogue. */
const MOCK_SUGGESTIONS: FeedSuggestion[] = [
  { title: '酷壳 CoolShell', url: 'https://coolshell.cn/feed', siteUrl: 'https://coolshell.cn', description: '编程、系统与工程实践', tags: ['编程', '技术', '架构'], score: 18 },
  { title: 'Hacker News', url: 'https://news.ycombinator.com/rss', siteUrl: 'https://news.ycombinator.com', description: '技术社区热帖', tags: ['编程', '科技', '创业'], score: 15 },
  { title: '少数派', url: 'https://sspai.com/feed', siteUrl: 'https://sspai.com', description: '高效工作与数字生活', tags: ['科技', '效率', '数字生活'], score: 12 },
  { title: 'Quanta Magazine', url: 'https://www.quantamagazine.org/feed/', siteUrl: 'https://www.quantamagazine.org', description: '数学、物理与生命科学', tags: ['科学', '数学', '科普'], score: 9 },
  { title: 'PetaPixel', url: 'https://petapixel.com/feed/', siteUrl: 'https://petapixel.com', description: '摄影器材与作品', tags: ['摄影', '数码'], score: 7 },
  { title: 'Dezeen', url: 'https://www.dezeen.com/feed/', siteUrl: 'https://www.dezeen.com', description: '建筑与设计', tags: ['设计', '建筑', '创意'], score: 5 },
];

/** Preview-only podcast directory, shaped like the Apple Podcasts results. */
const MOCK_PODCASTS: PodcastSuggestion[] = [
  ['硅谷早知道', '科技', '和你常读的「科技」相关'],
  ['声东击西', '社会与文化', '播客总榜第 3 名'],
  ['商业就是这样', '商业', '「商业」榜第 2 名'],
  ['半拿铁', '历史', '「历史」榜第 1 名'],
  ['科学有故事', '科学', '和你常读的「科学」相关'],
  ['忽左忽右', '历史', '播客总榜第 7 名'],
  ['不合时宜', '新闻', '「新闻」榜第 4 名'],
  ['随机波动', '艺术', '播客总榜第 12 名'],
  ['井底之蛙', '电视与电影', '「电视与电影」榜第 5 名'],
  ['程序员的自我修养', '科技', '和你常读的「编程」相关'],
  ['无人知晓', '社会与文化', '播客总榜第 18 名'],
  ['得意忘形', '健康', '「健康」榜第 6 名'],
].map(([title, genre, reason], i) => ({
  title,
  author: `${title}主播团`,
  url: `https://podcast.example.com/${i + 1}/feed.xml`,
  pageUrl: `https://podcasts.apple.com/cn/podcast/id${100000 + i}`,
  artworkUrl: thumb((i * 47) % 360, (i * 47 + 40) % 360, title.slice(0, 1)),
  genre,
  description: `${title}：一档关于${genre}的中文播客，每周更新。`,
  episodeCount: 20 + i * 13,
  lastEpisodeAt: Date.now() - (i + 1) * 2 * 86_400_000,
  reason,
  score: 30 - i,
}));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Inline SVG thumbnail so the list renders identically with no network. */
function thumb(h1: number, h2: number, glyph: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${h1} 70% 55%)"/>
      <stop offset="1" stop-color="hsl(${h2} 65% 40%)"/>
    </linearGradient></defs>
    <rect width="160" height="160" fill="url(#g)"/>
    <text x="80" y="96" font-size="64" text-anchor="middle" fill="rgba(255,255,255,.92)"
      font-family="system-ui, sans-serif">${glyph}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

interface FeedSeed {
  id: number;
  title: string;
  url: string;
  site: string;
  categoryId: number;
  view: ViewKey;
  hue: number;
  desc: string;
}

const FEED_SEEDS: FeedSeed[] = [
  {
    id: 1,
    title: '少数派',
    url: 'https://sspai.com/feed',
    site: 'https://sspai.com',
    categoryId: 1,
    view: 'articles',
    hue: 12,
    desc: '高效工作，品质生活',
  },
  {
    id: 2,
    title: '阮一峰的网络日志',
    url: 'https://www.ruanyifeng.com/blog/atom.xml',
    site: 'https://www.ruanyifeng.com/blog/',
    categoryId: 1,
    view: 'articles',
    hue: 210,
    desc: '科技爱好者周刊',
  },
  {
    id: 3,
    title: 'Hacker News',
    url: 'https://news.ycombinator.com/rss',
    site: 'https://news.ycombinator.com',
    categoryId: 2,
    view: 'articles',
    hue: 24,
    desc: 'Links for the intellectually curious',
  },
  {
    id: 4,
    title: 'The Verge',
    url: 'https://www.theverge.com/rss/index.xml',
    site: 'https://www.theverge.com',
    categoryId: 2,
    view: 'articles',
    hue: 280,
    desc: 'Technology, science, art, and culture',
  },
  {
    id: 5,
    title: 'Daring Fireball',
    url: 'https://daringfireball.net/feeds/main',
    site: 'https://daringfireball.net',
    categoryId: 2,
    view: 'articles',
    hue: 200,
    desc: 'By John Gruber',
  },
  {
    id: 6,
    title: '小林coding',
    url: 'https://xiaolincoding.com/feed.xml',
    site: 'https://xiaolincoding.com',
    categoryId: 1,
    view: 'articles',
    hue: 150,
    desc: '图解计算机基础',
  },
  {
    id: 7,
    title: 'Mastodon 精选',
    url: 'https://mastodon.social/@featured.rss',
    site: 'https://mastodon.social',
    categoryId: 3,
    view: 'social',
    hue: 265,
    desc: '联邦宇宙时间线',
  },
  {
    id: 8,
    title: '图集 · Lens',
    url: 'https://example.com/lens/feed.xml',
    site: 'https://example.com/lens',
    categoryId: 3,
    view: 'pictures',
    hue: 330,
    desc: '摄影与视觉',
  },
  {
    id: 9,
    title: '哔哩哔哩 · 影视飓风',
    url: 'https://www.bilibili.com/video/BV1xx411c7mD',
    site: 'https://www.bilibili.com',
    categoryId: 2,
    view: 'videos',
    hue: 190,
    desc: '影像技术与幕后',
  },
  {
    id: 10,
    title: '小宇宙 · 不合时宜',
    url: 'https://www.xiaoyuzhoufm.com/podcast/5e7b1f1a418a84a046b7c2f0',
    site: 'https://www.xiaoyuzhoufm.com',
    categoryId: 3,
    view: 'audio',
    hue: 340,
    desc: '播客 · 每周对谈',
  },
];

interface EntrySeed {
  feedId: number;
  title: string;
  summary: string;
  minutesAgo: number;
  read?: boolean;
  starred?: boolean;
  readLater?: boolean;
  image?: string;
  author?: string;
  body?: string;
  audioUrl?: string;
  audioDuration?: number;
}

const ACCENT_BODY = (lead: string, sections: string[]) => `
  <p>${lead}</p>
  ${sections.map((s) => `<p>${s}</p>`).join('\n')}
`;

const ENTRY_SEEDS: EntrySeed[] = [
  {
    feedId: 1,
    title: '我把 RSS 重新捡了起来，然后每天多出了一小时',
    summary:
      '算法推荐让人疲惫。作者分享了自己用 RSS 重建信息获取流程的完整方案：订阅源的选择、分组策略、以及在桌面端与移动端之间保持同步的做法。',
    minutesAgo: 24,
    image: thumb(12, 32, 'R'),
    author: '张奕',
    body: ACCENT_BODY(
      '过去两年，我的信息获取方式几乎完全交给了推荐算法。结果是：我读得更多了，但记住的更少了。',
      [
        '<strong>为什么要回到 RSS。</strong>RSS 的核心价值不是"更多"，而是"由我决定"。订阅列表是一份契约：我只为这些来源分配注意力。',
        '<h2>订阅源的组织方式</h2><p>我把订阅分成三组：每日必读、每周浏览、长期存档。分组不是为了整齐，而是为了给不同的来源分配不同的注意力预算。</p>',
        '<blockquote>信息焦虑的来源从来不是信息量，而是失控感。</blockquote>',
        '<h2>阅读流程的三个改动</h2><ul><li>全文抓取：只在需要精读时触发，避免把时间浪费在标题党上。</li><li>已读即归档：列表里只留未读，减少重复扫视。</li><li>星标即摘录：值得回看的内容统一进星标。</li></ul>',
        '<p>这样调整之后，我的日常阅读时间从 90 分钟降到了 35 分钟，但笔记产出反而变多了。',
        '如果你也在考虑重建自己的阅读系统，建议先从"删掉一半订阅"开始。</p>',
      ],
    ),
  },
  {
    feedId: 2,
    title: '科技爱好者周刊（第 298 期）：工具的寿命',
    summary:
      '本周话题：为什么我们造的工具越来越多，而真正被长期使用的却越来越少。另有 12 条值得一看的链接与 3 个开源项目。',
    minutesAgo: 96,
    image: thumb(210, 230, '刊'),
    author: '阮一峰',
    body: ACCENT_BODY(
      '本周我想聊聊工具的寿命。',
      [
        '<h2>工具的寿命</h2><p>一个工具真正被人使用的时间，往往远远短于它被开发出来的时间。绝大多数软件的生命周期里，维护期比活跃期长得多。</p>',
        '<p>这意味着：写代码的时候，应该优先考虑"以后还能不能改"，而不是"现在能不能跑"。</p>',
        '<h2>本周链接</h2><ol><li>一篇解释 CSS <code>container queries</code> 的文章。</li><li>SQLite 的 WAL 模式详解。</li><li>关于 RSS 复兴的讨论帖。</li></ol>',
        '<h2>开源项目</h2><p>本期推荐三个项目：一个终端文件管理器、一个 Go 写的静态站点生成器、一个浏览器内的 SQLite 工具。</p>',
      ],
    ),
  },
  {
    feedId: 3,
    title: 'Show HN: I built a desktop RSS reader in Go',
    summary:
      'A native RSS reader with full-text extraction, OPML import, and a three-pane layout. ~9 MB binary, no Electron, no runtime dependencies.',
    minutesAgo: 3 * 60,
    image: thumb(24, 44, 'G'),
    author: 'hn_user',
    body: ACCENT_BODY(
      'I have been using RSS readers for about fifteen years, and I finally got tired of the web ones disappearing.',
      [
        '<h2>What it does</h2><p>It stores everything in a local SQLite database, fetches feeds with conditional requests so unchanged feeds cost almost nothing, and runs a readability pass only when a feed only publishes teasers.</p>',
        '<h2>What it does not do</h2><p>There is no sync service, no account, and no telemetry. The binary is around 9 MB and starts in well under a second.</p>',
        '<blockquote>The interesting part was realizing how much of an RSS reader is just scheduling and caching.</blockquote>',
        '<p>Feed content is sanitised before it ever reaches the webview, which matters more than I expected once I realised the reader pane shares an origin with the app bindings.</p>',
      ],
    ),
  },
  {
    feedId: 4,
    title: 'The quiet return of the personal feed reader',
    summary:
      'Once declared dead, feed readers are being rebuilt by people who want their reading list back. We look at three new desktop clients and what they get right.',
    minutesAgo: 7 * 60,
    image: thumb(280, 300, 'F'),
    author: 'Victoria Song',
    body: ACCENT_BODY(
      'For a decade the feed reader has been treated as a solved, then abandoned, problem.',
      [
        '<h2>A different kind of app</h2><p>The new wave of readers does not try to be a social network. They are closer to a personal library: local storage, keyboard-driven, and fast.</p>',
        '<h2>What changed</h2><p>Two things. Local databases got cheap enough to embed, and people got tired of algorithmic timelines that they cannot audit.</p>',
        '<p>The result is a category that looks small but is quietly growing again.</p>',
      ],
    ),
  },
  {
    feedId: 5,
    title: 'The iPad Pro Is Not a Computer, and That Is Fine',
    summary:
      'Every year someone writes the same column. The iPad is not trying to be a Mac, and judging it by that standard misses what it is actually good at.',
    minutesAgo: 11 * 60,
    author: 'John Gruber',
    body: ACCENT_BODY(
      'The genre of "the iPad is not a real computer" column is now old enough to vote.',
      [
        '<p>The argument is always the same: it cannot run a terminal, it cannot run Xcode, therefore it is not a computer.</p>',
        '<h2>The real question</h2><p>The better question is not whether a device can replace a laptop, but whether it does the things you need without getting in the way.</p>',
      ],
    ),
  },
  {
    feedId: 6,
    title: '图解 HTTP 缓存：从强缓存到协商缓存',
    summary:
      '一篇把 Cache-Control、ETag、Last-Modified 和 304 讲清楚的图解文章，附带浏览器缓存决策的完整流程图。',
    minutesAgo: 20 * 60,
    image: thumb(150, 175, 'H'),
    author: '小林',
    body: ACCENT_BODY(
      '浏览器缓存的规则看起来很多，其实核心只有两个问题：能不能直接用？需不需要问一下服务器？',
      [
        '<h2>强缓存</h2><p><code>Cache-Control: max-age</code> 告诉浏览器在多久之内不用问服务器。命中时状态码是 200，并且标注 <code>from disk cache</code>。</p>',
        '<h2>协商缓存</h2><p>强缓存过期后，浏览器带着 <code>If-None-Match</code> 或 <code>If-Modified-Since</code> 去问服务器。没变就返回 304，省下的是响应体，不是请求。</p>',
        '<blockquote>RSS 阅读器用的是同一套机制：ETag 和 Last-Modified 让未更新的订阅几乎不产生流量。</blockquote>',
      ],
    ),
  },
  {
    feedId: 1,
    title: '如何用一块旧硬盘搭一个真正属于自己的云盘',
    summary: '不依赖任何厂商，从硬件选择到内网穿透，完整记录一次自建存储的实践。',
    minutesAgo: 2 * 24 * 60,
    read: true,
    image: thumb(30, 60, 'D'),
    author: '李默',
    body: ACCENT_BODY('自建存储最大的成本不是钱，而是你愿意为它负责。', [
      '<h2>硬件</h2><p>一块旧笔记本硬盘加一个硬盘盒就够开始了。</p>',
      '<h2>软件</h2><p>关键在于备份策略，而不是软件选型。</p>',
    ]),
  },
  {
    feedId: 2,
    title: '科技爱好者周刊（第 297 期）：慢下来的勇气',
    summary: '本周话题：为什么"快速失败"在个人项目里往往是错的。',
    minutesAgo: 3 * 24 * 60,
    read: true,
    author: '阮一峰',
    body: ACCENT_BODY('本周聊聊"慢"。', [
      '<p>快速失败适合有大量试错预算的团队，不适合只有一个人和一个周末的项目。</p>',
    ]),
  },
  {
    feedId: 3,
    title: 'SQLite is not a toy database',
    summary:
      'A thorough walkthrough of WAL mode, busy timeouts, and why a single writer is usually fine for desktop applications.',
    minutesAgo: 4 * 24 * 60,
    read: true,
    starred: true,
    author: 'antirez',
    body: ACCENT_BODY(
      'The most common mistake I see in desktop apps is assuming SQLite needs the same operational care as a server database.',
      [
        '<h2>WAL mode</h2><p>Write-ahead logging lets readers proceed while a writer is active, which removes almost all contention in a single-user app.</p>',
        '<h2>One writer</h2><p>Serialising writes behind a single connection is not a limitation, it is a simplification that removes an entire class of bugs.</p>',
      ],
    ),
  },
  {
    feedId: 4,
    title: 'Inside the tiny teams rebuilding the web’s oldest protocol',
    summary:
      'RSS never died. It just moved into smaller, quieter applications built by one or two people.',
    minutesAgo: 5 * 24 * 60,
    read: true,
    image: thumb(290, 320, 'W'),
    author: 'David Pierce',
    body: ACCENT_BODY('The protocol is older than most of the companies that abandoned it.', [
      '<p>What is striking about the current wave is how small the teams are.</p>',
    ]),
  },
  {
    feedId: 5,
    title: 'On Software Longevity',
    summary: 'The software that lasts is the software that is boring to maintain.',
    minutesAgo: 6 * 24 * 60,
    read: true,
    starred: true,
    author: 'John Gruber',
    body: ACCENT_BODY('Boring is a feature.', [
      '<p>Every dependency you add is a promise to keep up with someone else schedule.</p>',
    ]),
  },
  {
    feedId: 6,
    title: '一次生产环境的死锁排查记录',
    summary: '从 goroutine dump 到定位问题，完整复盘一次数据库连接池引发的死锁。',
    minutesAgo: 8 * 24 * 60,
    read: true,
    readLater: true,
    author: '小林',
    body: ACCENT_BODY('死锁最难的部分不是修复，而是复现。', [
      '<h2>现象</h2><p>服务每隔几小时就会卡住几分钟。</p>',
      '<h2>定位</h2><p>goroutine dump 显示大量协程阻塞在等待数据库连接。</p>',
    ]),
  },
  {
    feedId: 7,
    title: '今天的联邦宇宙时间线很热闹',
    summary: '关于开源许可证、桌面应用复兴和一个小型静态站点生成器的一串讨论。',
    minutesAgo: 40,
    image: thumb(265, 285, '#'),
    author: '@someone@mastodon.social',
    body: ACCENT_BODY('一串关于开源许可证的讨论，从 MIT 到 AGPL。', [
      '<p>许可证选择本质上是在回答：你希望别人怎么使用你的工作？</p>',
    ]),
  },
  {
    feedId: 8,
    title: '城市夜景：一组关于光的照片',
    summary: '雨后街道的反光、便利店的白光、天桥下的橙色路灯。',
    minutesAgo: 5 * 60,
    image: thumb(330, 350, '◉'),
    author: 'Lens',
    body: ACCENT_BODY('这组照片的主题是"人造光"。', [
      '<p>雨后的路面是最好的反射面。</p>',
    ]),
  },
  {
    feedId: 9,
    title: '我们花了三个月，把 8K 素材压进一条 4 分钟的视频',
    summary:
      '从拍摄、剪辑到调色与编码，一条视频的后期链路完整拆解；最后附上不同码率下的画质对比。',
    minutesAgo: 3 * 60,
    image: thumb(190, 210, '▶'),
    author: '影视飓风',
    body: ACCENT_BODY('这条片子的大部分时间花在了取舍上。', [
      '<h2>拍摄</h2><p>8K 是为了后期有裁切空间，不是为了导出 8K。</p>',
      '<h2>编码</h2><p>平台会再压一次，所以我们要把细节留在压缩不容易抹掉的地方。</p>',
    ]),
  },
  {
    feedId: 10,
    title: 'Ep.142 我们为什么又回到了 RSS',
    summary: '聊算法推荐、注意力预算，以及订阅制为什么又流行起来。',
    minutesAgo: 8 * 60,
    image: thumb(340, 300, '♫'),
    author: '不合时宜',
    audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    audioDuration: 372,
    body: ACCENT_BODY('这一期我们从各自的阅读方式聊起。', [
      '<p>订阅是一种承诺：你主动决定把注意力交给谁。</p>',
      '<p>算法的问题不是推荐得不准，而是它替你做决定。</p>',
    ]),
  },
  {
    feedId: 10,
    title: 'Ep.141 注意力预算：把时间花在真正想读的东西上',
    summary: '一次关于信息节食的实验：关掉推送、删掉应用，只留下真正想读的来源。',
    minutesAgo: 4 * 24 * 60,
    image: thumb(20, 350, '♫'),
    author: '不合时宜',
    audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    audioDuration: 425,
    body: ACCENT_BODY('这期的主题是注意力预算。', [
      '<p>我们试着把每天的信息消费记了一周的账。</p>',
    ]),
  },
];

/* ------------------------------------------------------------ mock state */

const now = Date.now();

const feeds: Feed[] = FEED_SEEDS.map((s, index) => ({
  id: s.id,
  title: s.title,
  url: s.url,
  siteUrl: s.site,
  description: s.desc,
  iconUrl: '',
  // Preview stand-in for the icon's dominant colour; production derives it from
  // the inlined icon with feed.DominantColor.
  color: `hsl(${(s.id * 53) % 360} 62% 52%)`,
  categoryId: s.categoryId,
  view: s.view,
  unread: 0,
  error: '',
  lastFetched: now - 12 * 60_000,
  sortOrder: index,
}));

const categories: Category[] = [
  { id: 1, name: '中文博客', sortOrder: 0, unread: 0, feedCount: 0 },
  { id: 2, name: '英文科技', sortOrder: 1, unread: 0, feedCount: 0 },
  { id: 3, name: '社交与影像', sortOrder: 2, unread: 0, feedCount: 0 },
];

const entries: EntryDetail[] = ENTRY_SEEDS.map((seed, index) => {
  const feed = feeds.find((f) => f.id === seed.feedId)!;
  const publishedAt = now - seed.minutesAgo * 60_000;
  return {
    id: index + 1,
    feedId: feed.id,
    feedTitle: feed.title,
    feedIcon: feed.iconUrl,
    feedView: feed.view,
    title: seed.title,
    url: `${feed.siteUrl}/post/${index + 1}`,
    author: seed.author ?? feed.title,
    summary: seed.summary,
    imageUrl: seed.image ?? '',
    publishedAt,
    read: seed.read ?? false,
    starred: seed.starred ?? false,
    readLater: seed.readLater ?? false,
    hasContent: true,
    content: seed.body ?? `<p>${seed.summary}</p>`,
    feedContent: seed.body ?? `<p>${seed.summary}</p>`,
    fullContent: '',
    hasFullContent: false,
    comments: '',
    commentsCount: 0,
    contentSource: 'feed',
    readingMinutes: Math.max(1, Math.round(seed.summary.length / 300)),
    siteUrl: feed.siteUrl,
    audioUrl: seed.audioUrl ?? '',
    audioType: seed.audioUrl ? 'audio/mpeg' : '',
    audioDuration: seed.audioDuration ?? 0,
    audioPosition: 0,
    audioPlayed: false,
  };
});

/**
 * The first preview entry carries a real, awkward article captured from an
 * actual feed (a table plus fourteen images with explicit `width="500"`
 * attributes). Feed content like this is what stresses the reader layout, so
 * keeping it in the preview makes overflow regressions visible.
 */
entries[0] = {
  ...entries[0],
  title: fixtureArticle.title,
  author: fixtureArticle.author,
  url: fixtureArticle.url,
  summary: fixtureArticle.summary,
  imageUrl: '',
  content: fixtureArticle.content,
  feedContent: fixtureArticle.content,
  contentSource: 'feed',
};

/**
 * Preview flags for the states that otherwise need a click to reach:
 *   ?fulltext  show the feed/full-text toggle as if a readability pass ran
 *   ?comments  show a populated comment thread
 */
const previewParams = new URLSearchParams(window.location.search);

if (previewParams.has('fulltext')) {
  entries[0].fullContent = `${entries[0].feedContent}<p><em>（这里是从原文抓取到的全文补充段落。）</em></p>`;
  entries[0].hasFullContent = true;
  entries[0].content = entries[0].fullContent;
  entries[0].contentSource = 'readability';
  entries[0].readingMinutes = 6;
}

if (previewParams.has('comments')) {
  entries[0].comments = `
    <div class="comment"><p class="comment-author">读者甲</p>
      <p>正好也在整理自己的订阅列表，分组那一段很有共鸣。</p></div>
    <div class="comment"><p class="comment-author">读者乙</p>
      <p>全文抓取确实关键，很多源只给一句话摘要。另外表格在窄栏里能横向滚动这点做得不错。</p>
      <div class="comment"><p class="comment-author">读者丙</p>
        <p>嵌套回复也正常显示了。</p></div>
    </div>`;
  entries[0].commentsCount = 3;
}

/**
 * The theme can be forced with `?theme=light|dark` so design screenshots can
 * capture both variants from the same bundle.
 */
const themeParam = new URLSearchParams(window.location.search).get('theme');

let settings: Settings = {
  theme: themeParam === 'light' ? 'light' : 'dark',
  accentColor: 'orange',
    entryColWidth: 450,
  sidebarShowUnreadCount: true,
  refreshIntervalMinutes: 30,
  markReadOnScroll: true,
  dimRead: false,
  groupByDate: false,
  timelineSortAsc: false,
  autoRefresh: true,
  contentFontSize: 16,
  commentPaneWidth: 380,
  entryLayout: 'list',
};

function recomputeCounts() {
  for (const f of feeds) {
    f.unread = entries.filter((e) => e.feedId === f.id && !e.read).length;
  }
  for (const c of categories) {
    const ids = feeds.filter((f) => f.categoryId === c.id).map((f) => f.id);
    c.unread = entries.filter((e) => ids.includes(e.feedId) && !e.read).length;
    c.feedCount = ids.length;
  }
}

function counts(): Counts {
  recomputeCounts();
  return {
    all: entries.length,
    unread: entries.filter((e) => !e.read).length,
    starred: entries.filter((e) => e.starred).length,
    readLater: entries.filter((e) => e.readLater).length,
    today: entries.filter((e) => now - e.publishedAt < DAY).length,
  };
}

function matches(e: EntryDetail, q: ListQuery): boolean {
  if (q.scope === 'feed' && e.feedId !== q.feedId) return false;
  if (q.scope === 'category') {
    const ids = feeds.filter((f) => f.categoryId === q.categoryId).map((f) => f.id);
    if (!ids.includes(e.feedId)) return false;
  }
  if (q.scope === 'starred' && !e.starred) return false;
  if (q.scope === 'readLater' && !e.readLater) return false;
  if (q.scope === 'unread' && e.read) return false;
  if (q.scope === 'today' && now - e.publishedAt >= DAY) return false;
  if (q.view && q.view !== 'all' && e.feedView !== q.view) return false;
  if (q.unreadOnly && e.read) return false;
  if (q.starredOnly && !e.starred) return false;
  if (q.search) {
    const needle = q.search.toLowerCase();
    const hay = `${e.title} ${e.summary} ${e.feedTitle}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

function listEntries(q: ListQuery): EntryPage {
  const limit = q.limit && q.limit > 0 ? q.limit : 100;
  const offset = q.offset ?? 0;
  const all = entries
    .filter((e) => matches(e, q))
    .sort((a, b) =>
      q.sortAsc ? a.publishedAt - b.publishedAt : b.publishedAt - a.publishedAt,
    );
  const page = all.slice(offset, offset + limit);
  return {
    // The list view does not need the article body.
    entries: page.map(({ content, ...rest }) => ({ ...rest, hasContent: content.length > 0 })),
    total: all.length,
    hasMore: offset + page.length < all.length,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ dispatcher */

const handlers: Record<string, (args: unknown[]) => unknown> = {
  AppInfo: (): AppInfo => ({
    name: 'ReadS',
    version: '1.0.0-mock',
    dataDir: '(browser mock)',
    platform: 'browser',
  }),

  Bootstrap: (): Bootstrap => {
    recomputeCounts();
    return {
      categories: JSON.parse(JSON.stringify(categories)),
      feeds: JSON.parse(JSON.stringify(feeds)),
      counts: counts(),
      settings: { ...settings },
    };
  },

  Counts: () => counts(),

  GetSettings: () => ({ ...settings }),

  SaveSettings: (args) => {
    settings = { ...settings, ...(args[0] as Settings) };
    return null;
  },

  ListEntries: (args) => listEntries(args[0] as ListQuery),

  /* Discovery: same shapes as the Go service, derived from the sample data so
     the browser preview can exercise the discover pane. */
  RecommendEntries: (args) => {
    const limit = (args[0] as number) || 24;
    return entries.filter((e) => !e.read).slice(0, limit);
  },

  RecommendFeeds: (args) => {
    const limit = (args[0] as number) || 12;
    const subscribed = new Set(feeds.map((f) => f.url));
    return MOCK_SUGGESTIONS.filter((s) => !subscribed.has(s.url)).slice(0, limit);
  },

  RecommendPodcasts: async (args) => {
    await sleep(500);
    const [limit = 8, , exclude = []] = args as [number, number, string[]];
    const open = MOCK_PODCASTS.filter((p) => !feeds.some((f) => f.url === p.url));
    // Like the backend: unseen shows first, already shown ones only as filler.
    const seen = new Set(exclude);
    return [...open.filter((p) => !seen.has(p.url)), ...open.filter((p) => seen.has(p.url))].slice(0, limit);
  },

  GetEntry: (args) => {
    const id = args[0] as number;
    const found = entries.find((e) => e.id === id);
    if (!found) throw new Error(`entry ${id} not found`);
    return JSON.parse(JSON.stringify(found));
  },

  MarkRead: (args) => {
    const [ids, read] = args as [number[], boolean];
    for (const e of entries) if (ids.includes(e.id)) e.read = read;
    return null;
  },

  SavePlayback: (args) => {
    const [id, positionMs, durationSec, completed] = args as [number, number, number, boolean];
    const e = entries.find((x) => x.id === id);
    if (!e) return null;
    e.audioPosition = Math.max(0, Math.round(positionMs));
    if (durationSec > 0 && e.audioDuration <= 0) e.audioDuration = durationSec;
    if (completed || (durationSec > 0 && positionMs >= durationSec * 1000 - 2000)) {
      e.audioPlayed = true;
      e.read = true;
    }
    return null;
  },

  MarkAllRead: (args) => {
    const [q, read] = args as [ListQuery, boolean];
    let n = 0;
    for (const e of entries) {
      if (matches(e, q)) {
        e.read = read;
        n++;
      }
    }
    return n;
  },

  ToggleStar: (args) => {
    const e = entries.find((x) => x.id === (args[0] as number))!;
    e.starred = !e.starred;
    return e.starred;
  },

  ToggleReadLater: (args) => {
    const e = entries.find((x) => x.id === (args[0] as number))!;
    e.readLater = !e.readLater;
    return e.readLater;
  },

  FetchFullContent: async (args) => {
    await sleep(500);
    const e = entries.find((x) => x.id === (args[0] as number))!;
    // Stand in for a readability pass: keep the feed body and add a longer one.
    e.fullContent =
      `${e.feedContent}<p><em>（这里是抓取到的全文补充段落。）</em></p>` +
      `<p>Readability 提取出的正文通常比订阅源提供的摘要长得多，段落结构也更完整。</p>`;
    e.hasFullContent = true;
    e.content = e.fullContent;
    e.contentSource = 'readability';
    e.readingMinutes = Math.max(1, Math.round(e.fullContent.length / 900));
    return JSON.parse(JSON.stringify(e));
  },

  ClearFullContent: (args) => {
    const e = entries.find((x) => x.id === (args[0] as number))!;
    e.fullContent = '';
    e.hasFullContent = false;
    e.content = e.feedContent;
    e.contentSource = 'feed';
    return JSON.parse(JSON.stringify(e));
  },

  FetchComments: async (args) => {
    await sleep(600);
    const e = entries.find((x) => x.id === (args[0] as number))!;
    const html = `
      <div class="comment"><p class="comment-author">读者甲</p>
        <div class="comment__content">正好也在整理自己的订阅列表，分组那一段很有共鸣。</div></div>
      <div class="comment"><p class="comment-author">读者乙</p>
        <div class="comment__content">全文抓取功能确实关键，很多源只给一句话摘要。</div>
        <div class="comment"><p class="comment-author">读者丙 <span class="comment-meta">2 赞</span></p>
          <div class="comment__content">同感，有些源连摘要都不给。</div></div>
      </div>`;
    e.comments = html;
    e.commentsCount = 3;
    return { count: 3, html, message: '已获取 3 条评论' };
  },

  // Kept in step with the real service so the browser preview can exercise the
  // comment pipeline without the desktop bridge.
  FetchCommentsByURL: async (args) => {
    await sleep(400);
    const url = String(args[0] ?? '');
    if (!url.trim()) throw new Error('没有原文链接，无法获取评论');
    return { count: 0, html: '', message: '这篇还没有评论' };
  },

  ReportViewport: () => null,

  FetchFeedIcon: async (args) => {
    await sleep(300);
    const f = feeds.find((x) => x.id === (args[0] as number))!;
    f.iconUrl = thumb(f.id * 37 % 360, (f.id * 37 + 30) % 360, f.title.slice(0, 1));
    return f.iconUrl;
  },

  RefreshAllFeedIcons: async () => {
    await sleep(400);
    return feeds.length;
  },

  Discover: async (args): Promise<DiscoveredFeed[]> => {
    await sleep(350);
    const url = String(args[0] ?? '');
    if (!url.trim()) throw new Error('请输入网站或订阅源地址');
    return [
      { title: '发现的主订阅源', url: `${url.replace(/\/$/, '')}/feed`, type: 'rss', isFeed: true, siteUrl: url },
      { title: '评论订阅源', url: `${url.replace(/\/$/, '')}/comments/feed`, type: 'rss', isFeed: true, siteUrl: url },
    ];
  },

  AddFeedByURL: async (args) => {
    await sleep(400);
    const [url, categoryId, view] = args as [string, number, ViewKey | ''];
    const existing = feeds.find((f) => f.url === url);
    if (existing) return existing;
    const known = [...MOCK_SUGGESTIONS, ...MOCK_PODCASTS].find((s) => s.url === url);
    const host = (() => {
      try {
        return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
      } catch {
        return url;
      }
    })();
    const id = Math.max(...feeds.map((f) => f.id)) + 1;
    const feed: Feed = {
      id,
      title: known?.title ?? host,
      url,
      siteUrl: `https://${host}`,
      description: '刚刚订阅的订阅源',
      iconUrl: '',
      color: `hsl(${(id * 53) % 360} 62% 52%)`,
      categoryId: categoryId || 0,
      view: view || 'articles',
      unread: 0,
      error: '',
      lastFetched: Date.now(),
      sortOrder: feeds.length,
    };
    feeds.push(feed);
    // Give the new feed something to show.
    const seed = ENTRY_SEEDS[entries.length % ENTRY_SEEDS.length];
    entries.push({
      ...entries[0],
      id: Math.max(0, ...entries.map((e) => e.id)) + 1,
      feedId: id,
      feedTitle: feed.title,
      title: seed.title,
      summary: seed.summary,
      imageUrl: seed.image ?? '',
      publishedAt: Date.now() - 5 * 60_000,
      read: false,
      starred: false,
      readLater: false,
      content: seed.body ?? `<p>${seed.summary}</p>`,
    });
    recomputeCounts();
    return feed;
  },

  RemoveFeed: (args) => {
    const id = args[0] as number;
    for (let i = feeds.length - 1; i >= 0; i--) if (feeds[i].id === id) feeds.splice(i, 1);
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].feedId === id) entries.splice(i, 1);
    recomputeCounts();
    return null;
  },

  UpdateFeed: (args) => {
    const [id, title, categoryId, view] = args as [number, string, number, string];
    const f = feeds.find((x) => x.id === id);
    if (f) {
      if (title) f.title = title;
      f.categoryId = categoryId;
      if (view) f.view = view as ViewKey;
    }
    return null;
  },

  MoveFeed: (args) => {
    const [id, categoryId] = args as [number, number];
    const f = feeds.find((x) => x.id === id);
    if (f) f.categoryId = categoryId;
    return null;
  },

  SetFeedView: (args) => {
    const [id, view] = args as [number, string];
    const f = feeds.find((x) => x.id === id);
    if (f) f.view = view as ViewKey;
    return null;
  },

  ReorderFeeds: () => null,

  CreateCategory: (args) => {
    const name = String(args[0]);
    const id = Math.max(0, ...categories.map((c) => c.id)) + 1;
    const cat: Category = { id, name, sortOrder: categories.length, unread: 0, feedCount: 0 };
    categories.push(cat);
    return cat;
  },

  RenameCategory: (args) => {
    const [id, name] = args as [number, string];
    const c = categories.find((x) => x.id === id);
    if (c) c.name = name;
    return null;
  },

  DeleteCategory: (args) => {
    const id = args[0] as number;
    const idx = categories.findIndex((c) => c.id === id);
    if (idx >= 0) categories.splice(idx, 1);
    for (const f of feeds) if (f.categoryId === id) f.categoryId = 0;
    return null;
  },

  RefreshAll: async (): Promise<RefreshResult> => {
    await sleep(600);
    return { updated: feeds.length, new: 3, failed: 0, errors: [], durationMs: 612 };
  },

  Refresh: async (): Promise<RefreshResult> => {
    await sleep(400);
    return { updated: 1, new: 0, failed: 0, errors: [], durationMs: 380 };
  },

  ExportOPMLContent: () =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>ReadS Subscriptions</title></head>\n  <body>\n${feeds
      .map((f) => `    <outline text="${f.title}" type="rss" xmlUrl="${f.url}"/>`)
      .join('\n')}\n  </body>\n</opml>`,

  ImportOPMLContent: async (): Promise<RefreshResult> => {
    await sleep(300);
    return { updated: 0, new: 0, failed: 0, errors: [], durationMs: 300 };
  },

  ImportOPML: async (): Promise<RefreshResult> => {
    await sleep(300);
    return { updated: 0, new: 0, failed: 0, errors: [], durationMs: 300 };
  },

  ExportOPML: () => feeds.length,
};

export function invoke(method: string, args: unknown[]): unknown {
  const handler = handlers[method];
  if (!handler) {
    throw new Error(`mock backend has no handler for ${method}`);
  }
  return handler(args);
}

/** Lets development tooling inspect the mock's refresh-progress shape. */
export const sampleProgress: RefreshProgress = {
  done: 2,
  total: 8,
  current: '少数派',
  new: 1,
};

recomputeCounts();
