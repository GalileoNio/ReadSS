# ReadS

一个模仿 [Folo](https://folo.is)（原 Follow）设计的桌面 RSS 阅读器，后端 **Wails v3 + Go**，前端 **React + TypeScript + Tailwind**。

界面参数（配色、栏宽、字号、键盘映射）取自 Folo 仓库的真实源码，而非凭印象仿制：

| 项目 | 取值 | 参考来源 |
| --- | --- | --- |
| 品牌强调色 | `#FF5C00`（`--fo-a: 21.6 100% 50%`） | `packages/internal/components/assets/colors.css` |
| 深色背景 / 描边 | `#121212` / `#383838` | `tailwind.css` |
| 次级表面 | `#222428`（深色）· `#F4F4F5`（浅色） | `colors.css` |
| 文字层级 | 85% / 50% / 25% 透明度 | `tailwindcss-uikit-colors` |
| 栏宽 | 订阅栏 256px · 列表栏 450px | `settings/defaults.ts` |
| 头部高度 | 52px（带下边框 53px） | `top-header` 令牌 |
| 圆角 | 8px（`--radius: 0.5rem`） | `tailwind.css` |

![ReadS 深色主题](build/shots/desk-app-dark.png)

界面设计语言见 [DESIGN.md](DESIGN.md)：token、字阶、圆角、按钮与评论区规范都收敛在那里，新增界面先对照它的自检清单。

## 功能

- **单栏内容页 + 文章模态窗**：列表 / 瀑布流 / 发现占满窗口；点击文章弹出居中模态窗，左侧文章、右侧作者卡与评论区；窄屏切换「文章 / 评论」两个 tab。订阅源、搜索与设置在底部悬浮切换器里
- **获取全文**：用 Readability 从原文提取完整正文（少数派实测 172 字符摘要 → 17,295 字符正文）
- **获取评论区**：分层的通用抓取——先解析服务端 HTML，找不到就自动发现该站自己的公开
  评论接口并按 host 缓存配方（少数派实测自动发现并复用；阮一峰博客 51 条评论）。
- **评论区在模态窗右侧**：桌面独立成列，与文章各自滚动；窄屏变为「文章 / 评论」tab。
  评论头只保留刷新，作者卡固定在上方，评论列表独立滚动。
  手机上无法上下分区，改为标题栏按钮在「文章 / 评论」间切换。
- **头像内联**：评论头像的图片在服务端带 Referer 抓取后转成 data URI 再入库。
  这一步是必需的，不是优化——很多 CDN 对头像做防盗链（实测 `cdnfile.sspai.com`
  不带 Referer 直接返回 403），而 WebView 加载 `<img>` 时无法伪造该头。
  格式按**字节魔数**识别（PNG / JPEG / GIF / WebP / AVIF / HEIC / BMP / TIFF / SVG / ICO），
  因此没有扩展名、甚至以点结尾的文件名（实测真实存在）也能正常显示；
  超过 128 KiB 的图片（实测有 1.2 MB 的动图头像）和取不到的头像会退化成
  首字母圆形占位，而不是破图。
- **网页图标**：自动抓取站点真实图标并**以 data URI 内联缓存**，不依赖任何第三方 favicon 服务，离线也能显示
- **订阅管理**：输入网址自动发现 RSS / Atom / JSON Feed，支持分组、重命名、拖拽排序、取消订阅；分组与订阅源列表在列表栏底部的悬浮切换器里（向上展开）
- **两种列表布局**：时间线列表 / 小红书式瀑布流（2–5 列自适应卡片），搜索行右侧一键切换
- **无图卡片文字封面**：没有配图时用订阅源色调的浅底 + 引用符号 + 居中标题做成封面（标题不再重复显示）
- **卡片图片不抖动**：图片框按文章 id 预置比例（4:3 / 1:1 / 16:9），先显示该订阅源的模糊渐变占位，
  加载完成后 450ms 由模糊变清晰；卡片高度在加载前后完全一致，首页不会来回跳
- **卡片展开动画（卡片即模态窗）**：点击卡片，原卡片位置留白（不重排），模态窗从卡片矩形向右下展开（不是淡入），
  卡片里那张图飞进详情页主图的位置并放大；关闭时窗口与图片缩回卡片，动画结束后卡片才重新出现（420ms/360ms）
  （`prefers-reduced-motion` 时直接到位）
- **发现与推荐**：按已读/星标内容推荐未读文章，并按订阅兴趣推荐可订阅的 RSS 站点卡片，点击即订阅
- **下拉刷新**：列表与发现面板在顶部下拉即可刷新
- **文章模态窗**：点击文章在居中弹窗中阅读，左边文章，右边作者卡与评论区；窄窗口切换「文章 / 评论」两个 tab
- **头部筛选组**：左侧视图（首页 / 文章 / 社交 / 图片 / 视频）、右侧智能列表
  （未读 / 星标 / 稍后读 / 今天），各为一个圆形胶囊组，只有选中项展开显示名字
- **视图标签**：首页 / 文章 / 社交 / 图片 / 视频（按订阅源内容启发式归类，可手动调整）
- **OPML 导入导出**：与其他阅读器互通
- **后台自动刷新**：可配置间隔，使用 ETag / Last-Modified 条件请求
- **本地优先**：纯 Go SQLite（`modernc.org/sqlite`，无需 cgo），无账号、无遥测
- **HTML 消毒**：订阅源内容入库前按白名单清洗，剥离 `<script>`、`javascript:`、`on*` 等；宽表格自动包裹可滚动容器
- **响应式布局**：列表 / 瀑布流 / 发现面板占满窗口；瀑布流 2–5 列自适应；文章以模态窗阅读，窄屏全屏

## 键盘快捷键

| 按键 | 作用 |
| --- | --- |
| `J` / `↓`、`K` / `↑` | 下一篇 / 上一篇 |
| `M` | 标记已读 / 未读 |
| `S` | 加星标 |
| `B` | 在系统浏览器中打开原文 |
| `O` | 打开订阅源网站 |
| `R` | 刷新 |
| `U` | 仅显示未读 |
| `1`–`5` | 切换视图标签 |
| `Ctrl/Cmd + K` | 命令面板与搜索 |
| `Ctrl/Cmd + N` | 添加订阅 |
| `Shift + Ctrl/Cmd + A` | 全部标记为已读（3 秒倒计时，可撤销） |
| `Esc` | 关闭文章模态窗 |
| `?` | 快捷键说明 |

## 项目结构

```
README.md                    项目说明
DESIGN.md                    设计指南：token、字阶、组件规范、评论区规范、自检清单
main.go                      Wails v3 装配、窗口、启动流程、CLI 入口
selftest.go                  无窗口 / 无网络的端到端自检
cli.go                       --subscribe / --probe / --test-comments / --recommend 无头工具
internal/
  model/model.go             前后端共享的数据结构（含评论接口配方）
  store/store.go             SQLite 持久化与就地迁移
  feed/fetcher.go            HTTP 抓取、条件请求、瞬时失败重试、gofeed 解析
  feed/discover.go           订阅源发现与视图归类
  feed/icon.go               站点图标发现、内联缓存
  feed/comments.go           评论区提取（HTML 层）与候选诊断
  feed/commentapi.go         通用评论接口发现引擎（无站点专用代码）
  feed/sanitize.go           HTML 白名单消毒、类名白名单、表格包裹、正文摘要
  opml/opml.go               OPML 导入导出
  service/service.go         绑定给前端的服务、刷新调度、事件
frontend/
  src/components/            列表、订阅源切换器、阅读器、对话框、命令面板
  src/store/                 zustand 状态
  src/hooks/useViewport.ts   响应式断点
  src/lib/api.ts             Wails 绑定封装（浏览器下回退到内置 mock）
  src/lib/mock.ts            示例数据，供浏览器预览与设计校对
scripts/                     构建、自检、截图、窗口捕获
```

## 环境要求

- Go 1.26+（仓库内 `.toolchain/` 自带一份）
- Node.js 20+ 与 pnpm
- Windows 上的 WebView2 运行时（Win11 及已更新的 Win10 已预装）

## 构建与运行

```powershell
# 完整构建：先打包前端，再编译两个 Go 二进制（都内嵌前端资源）
pwsh -File scripts/build.ps1

# 启动桌面应用（GUI 子系统，不会弹控制台窗口）
.\build\bin\ReadS.exe

# 或者双击桌面快捷方式「ReadS」（scripts/make-shortcut.ps1 创建）
```

构建会产出两个同源二进制：

| 文件 | 子系统 | 用途 |
| --- | --- | --- |
| `build\bin\ReadS.exe` | GUI | 桌面应用；双击/快捷方式启动，不弹控制台 |
| `build\bin\ReadS-cli.exe` | 控制台 | 命令行与自检（`--selftest` 等），可看到输出 |

**数据目录**按以下顺序确定，第一个命中的生效：

1. `READS_DATA_DIR` 环境变量
2. `--data-dir` 参数
3. **便携布局**：exe 旁边的 `appdata`（`build\bin\..\appdata`）或 `build\bin\appdata` 若存在，
   直接使用 —— 因此快捷方式无需设置任何环境变量就能打开 `build\appdata` 里的库
4. 默认 `%AppData%\ReadS`

`scripts/goenv.ps1` / `scripts/pnpmenv.ps1` 会把 Go 与 Node 的缓存、pnpm store 全部指向
仓库内的 `.toolchain/`，不污染系统目录。

### 命令行参数（用 `ReadS-cli.exe`）

GUI 子系统二进制无法向终端输出，所以命令行测试走 `ReadS-cli.exe`：

```powershell
ReadS-cli.exe --selftest                  # 无窗口自检：解析、消毒、存储、OPML、搜索、评论引擎
ReadS-cli.exe --subscribe <url>[,<url>]   # 无头订阅并抓取一次
ReadS-cli.exe --probe <url>               # 实测图标 / 全文 / 评论三项抓取能力
ReadS-cli.exe --test-comments <file>      # 对保存的 HTML 跑评论提取，并列出候选容器
ReadS-cli.exe --test-comments <url>       # 对线上文章跑完整评论链路，并打印发现到的配方
ReadS-cli.exe --fetch-comments <id>       # 对真实库里的某篇文章抓取并**入库**评论（走 UI 同一条代码路径）
ReadS-cli.exe --recommend                 # 打印发现面板会显示的推荐文章与订阅推荐（只读）
ReadS-cli.exe --version
ReadS-cli.exe --data-dir D:\some\dir      # 覆盖数据目录
```

`--test-comments` 是排查评论问题的第一站：它把「抓不到页面」和「解析不出评论」分开，
并在线上模式下打印自动发现到的接口与参数名，例如：

```
recipe cached: https://sspai.com/api/v2/comment/search/page/get  idParam=article_id dataPath=data
```

环境变量：

| 变量 | 作用 |
| --- | --- |
| `READS_DATA_DIR` | 覆盖数据目录（优先于 `--data-dir`） |
| `READS_LOG_LEVEL=debug` | 打开详细日志：绑定调用、资源请求、前端视口尺寸 |

数据目录（默认 `%AppData%\ReadS`）：`reads.db`（SQLite）、`reads.log`、`webview/`（WebView2 配置）。

## 开发模式

```powershell
cd frontend
pnpm run dev            # http://localhost:34115
```

浏览器下检测不到 Wails 后端时会自动回退到 `src/lib/mock.ts` 的内存实现，无需编译 Go 即可浏览界面。
预览专用查询参数：

| 参数 | 效果 |
| --- | --- |
| `?theme=light` / `?theme=dark` | 强制主题 |
| `?list=1` | 不自动打开首篇文章（用于捕获手机端列表） |
| `?fulltext=1` | 预设「已抓取全文」，显示全文/原文切换 |
| `?comments=1` | 预设评论区内容 |

## 验收与截图

```powershell
# 生产包在真实浏览器里的渲染 + 布局溢出检测（DOM 级）
node scripts/measure-dom.mjs --width 1512 --height 950 --shot build/shots/desk.png
node scripts/measure-dom.mjs --width 390  --height 844 --extra "list=1" --shot build/shots/m-list.png
# --click 先点一下再测量：手机上评论区默认收起，需要点开才能测到它的布局
node scripts/measure-dom.mjs --width 390 --height 844 --click 评论 --shot build/shots/m-comments.png

# 捕获真实 Wails 窗口
pwsh -File scripts/capture-window.ps1 -Out build/shots/app-final.png
```

两点必须注意，否则会得出错误结论：

1. **截图必须走 CDP 或声明 DPI 感知**。Windows 会为 DPI 不感知的进程虚拟化窗口坐标：在 150% 缩放下，
   一个 2160×1350 的窗口会被报告为 1440×900，`PrintWindow` 会据此裁掉右半边，看起来就像应用布局溢出。
   `capture-window.ps1` 会先调用 `SetProcessDpiAwareness`；`measure-dom.mjs` 则用 CDP 设置视口。
   Chromium 在 Windows 上还有约 500px 的最小窗口宽度，所以 `--window-size=390` 的截图同样不可信。
2. **布局问题要用 DOM 度量而不是肉眼**。`measure-dom.mjs` 会输出视口宽度、`documentElement.scrollWidth`
   以及所有溢出元素的类名，比对着截图猜快得多。
3. **Wails 绑定名区分大小写，且只在运行时才会报错**。JS 里写 `AddFeedByUrl` 而 Go 方法是
   `AddFeedByURL` 时，编译、类型检查、打包全部通过，只有用户点下去才会得到
   `unknown bound method name`。`scripts/check-bindings.mjs` 会逐字比对前端调用名与
   Go 导出方法名（**大小写敏感**），并已接入 `build.ps1`，每次构建都会拦截，
   同时给出「did you mean AddFeedByURL?」。
   注意：PowerShell 的 `-contains`/`-eq` 默认不区分大小写，用它做这类比对会漏掉这个 bug。

## 远程图片与防盗链

部分 CDN 会拒绝 Referer 不是发布站点的图片请求：实测 `img.ithome.com` 对应用自身来源返回
**403**，而 WebView 加载 `<img>` 时无法修改 Referer，因此列表缩略图与正文配图会直接破图
（`platform.theverge.com` 这类不校验的则正常）。

应用因此自带一个**仅监听 127.0.0.1 的图片代理**（`internal/imgproxy`）：前端把站外图片指向
`<proxy>/i?u=<图片>&r=<文章地址>`，由 Go 侧以**文章地址作为 Referer** 取图后原样回传，
并带 `Cache-Control: max-age=86400` 交给 WebView 缓存。图片不入库、不落盘。

验证方式：应用启动时日志会打印 `image proxy listening base=http://127.0.0.1:<port>`，
对该地址请求一张 IT之家 图片应得到 200（而直连应用来源是 403）。

## 订阅发现与 WAF 验证页

添加订阅时会先直接解析用户给的地址；如果没有订阅源，再把**同一路径换到该域名的
`www.` / 裸域孪生主机**重试一次（保留端口与查询串）。许多站点只对其中一个 vhost
加了机器人校验：

| 地址 | 返回 |
| --- | --- |
| `https://36kr.com/feed` | 火山引擎 WAF 的 JS 验证页（约 25 KB HTML，任何 UA、任何路径都一样） |
| `https://www.36kr.com/feed` | 正常 RSS（`application/rss+xml`，163 KB，30 条） |

浏览器能通过验证（实测 headless Edge 拿到的就是 RSS），但 RSS 客户端不能，所以
`36kr.com/feed` 现在会自动落到 `www.36kr.com/feed` 并正常订阅。这是主机名规范化重试，
不含任何站点专用代码。

失败时如果响应被识别为验证页（火山引擎 `__waf_verification_challenge`、Cloudflare
`Just a moment...`、阿里云 WAF 等），会说明「该站点启用了浏览器安全验证」，而不是笼统的
「没有找到订阅源」。**超时不会触发孪生主机重试**，否则同一个 30 秒超时会被等两遍。

调试单个地址用 `scripts/probe-browser.mjs <url> [waitMs]`：它用真实浏览器打开该地址，
打印 HTTP 状态与页面内容，用来判断「是站点拦了客户端，还是这个地址根本没有订阅源」。

## 已知限制

- 视频 / 图片标签归类是启发式判断，可在右键菜单手动调整
- **评论区是分层抓取的，两层都是匿名只读请求，没有任何站点专用代码**：
  1. 先解析服务端 HTML。覆盖自建评论系统（WordPress、Ghost、Hugo 主题、Discourse 内嵌）
     与多数中文博客。实测阮一峰博客 51 条评论、43,702 字符。
  2. 如果页面只提供评论区外壳，则**发现该站自己的公开评论接口**：
     从页面与脚本中找出注释形态的接口路径与 API 前缀并组合成候选地址，
     识别文章 id 参数名（`article_id` / `newsid` / `target_id` …），
     逐个试探并校验返回的 JSON 是否真的是评论列表，成功后按 host 缓存配方。
     实测少数派：自动拼出 `https://sspai.com/api/v2/comment/search/page/get`，
     参数 `article_id`，首次发现后缓存，后续文章直接复用（4 条评论、1,678 字符）。
  3. 接口返回的图片常常是**没有域名的相对路径**（少数派返回
     `2021/12/19/abc.gif`，真实主机是 `cdnfile.sspai.com`）。应用会逐个候选主机
     实测「这个地址是否真的返回图片」，把确认可用的主机缓存进配方——
     这不是猜测，验证失败就继续试下一个。
  4. 另外三项通用机制，都是被真实站点逼出来的：
     - **动态注入的脚本也算脚本**：IT 之家的评论组件是内联 JS 里
       `loadFile(commentJsFile)` 注入的，从不写在 `<script src>` 里
     - **从 URL 字面量里读参数名与固定参数**：`"/api/webcomment/getnewscomment?sn="`
       直接给出接口路径、占位参数 `sn`，邻近字面量里的 `&appver=900` 则是接口要求的固定参数
     - **从评论容器的 data 属性里取线程键**：IT 之家用
       `<div id="post_comm" data-id="fdba899d0d39d46e">` 的 `data-id` 当 `sn`，
       而不是 URL 里的数字 id
     实测 IT 之家：自动得到 `https://cmt.ithome.com/api/webcomment/getnewscomment`，
     参数 `sn`，缓存后逐篇复用（67 条 / 133 条评论，头像全部内联）
- 接口返回的评论数组可能有**多个同形数组**，其中一些是空的
  （IT 之家同时返回 `content.topComments: []`、`content.hotComments`、
  `content.comments`）。选择逻辑会先在所有数组里找**有内容**的那个，
  只有全都为空时才接受空容器，避免把 36 条评论的文章报成「没有评论」
- 仍取不到评论的情况，都会给出**具体原因**而不是空白区：
  - 评论区由纯客户端脚本渲染且找不到公开接口（Disqus / Livefyre 等）
  - 接口需要登录或签名。接口返回合法但**空的**评论列表时不算失败，
    会明确显示「这篇还没有评论」，而不是「找不到评论区」
  - 这类站点只能靠保存登录凭据或内置无头浏览器解决，都属于另一类功能，
    且无头浏览器对登录墙同样无效
- 发现引擎有明确预算，避免拖慢打开文章：最多 10 个脚本（各 1 MiB）、
  约 40 次候选接口试探、45 秒总超时；成功后按 host 缓存配方，后续文章不再发现
- 只有白名单内的 class 会保留（`comment` / `comment-author` / `comment-meta` /
  `comment__content` / `comment-badge` / `avatar` / `avatar--text` / `table-scroll`），
  其余（含任何 `on*` 属性）一律剥除
- 头像超过 128 KiB 时内联成本过高（实测最夸张的一张头像 1.2 MB），会退化为首字母占位；
  想全部内联可调大 `internal/feed/avatar.go` 里的 `maxAvatarBytes`
- 全文搜索使用 `LIKE` 查询，尚未建立 FTS 索引
- 暂无云端同步与播客播放器
