# ReadS 设计指南

这份指南把项目一开始就确立的设计语言**沉淀成可执行的规则**，用于判断「一段新 UI 是否属于这个应用」。
所有数值都来自代码事实（`frontend/src/index.css`、`frontend/tailwind.config.js`、
`frontend/src/components/primitives.tsx`），不是另行发明的一套。

设计语言源自 Folo：`frontend/src/index.css` 顶部的注释指明了这一点，token 直接对应
Folo 自己的 CSS 变量。**任何新界面都必须只用这里的 token 组合出来**；需要新 token 时，
先改 token 定义并在本文件登记，再使用。

---

## 0. 三条总原则

1. **强调色是「事件」，不是「表面」。** `accent`（#FF5C00）只用于：一个区域内的**一个**主操作、
   当前导航项标记、焦点环、未读圆点、链接。绝不用于大面积底色、头像底色、卡片底色。
2. **层级靠文字灰阶，不靠边框和底色。** 正文 `fg/85`、次要 `fg/50`、最弱 `fg/25`。
   用灰阶区分主次；边框只用来**分隔区域**，不是用来给每一行画框。
3. **交互状态只用 `item-hover` / `item-active`。** 所有可点区域（行、按钮、图标按钮）的
   hover/active 一律走这两个已混合好的颜色变量，不要自己拼 `bg-black/5` 之类的近似色。

---

## 1. Token

### 1.1 颜色

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `accent` | `hsl(21.6 100% 50%)` = #FF5C00 | 同 | 主操作、当前项、焦点环、链接、未读点 |
| `background` | `0 0% 100%` | `0 0% 7.1%` (#121212) | 主内容区、模态窗、文章底色 |
| `sidebar` | `240 4.8% 95.9%` | `220 8.1% 14.5%` (#222428) | 次级栏底色（保留给分组/菜单类表面） |
| `sidebar-active` | `240 4.9% 83.9%` | `198 31.3% 6.3%` (#0B1215) | 次级选中（菜单 / 悬浮面板） |
| `fill` | `240 4.8% 95.9%` | `0 0% 14%` | 次级表面：输入框、chip、代码块、骨架 |
| `border` | `20 5.9% 90%` | `0 0% 22.1%` (#383838) | 1px 分隔线与描边 |
| `fg` | `0 0% 0%` | `0 0% 100%` | 文字，**始终带透明度使用** |
| `item-hover` | `hsl(240 4% 70% / .2)` | `hsl(0 0% 60% / .3)` | 行/按钮 hover |
| `item-active` | `hsl(240 4% 62% / .3)` | `hsl(0 0% 55% / .4)` | 行/按钮 选中与按下 |

**文字灰阶只有三档**：`text-fg/85`（正文）、`text-fg/50`（次要/元信息）、`text-fg/25`（最弱/占位）。
不要用 `/70`、`/40`、`/60` 这类中间值——它们会让同一屏出现过多灰阶。

`fill` 的透明度只用已存在的档位：`bg-fill/20`、`bg-fill/30`、`bg-fill/40`。
边框透明度只用 `border-border/70`（需要更弱的分隔时）。

### 1.2 圆角

| Class | 值 | 用途 |
| --- | --- | --- |
| `rounded-sm` | 2px | ≤24px 的小图标/头像（见 1.5 头像阶梯） |
| `rounded` (DEFAULT) | 8px | 按钮、图标按钮、输入框、行内代码块 |
| `rounded-md` | 6px | 小控件、输入框（项目中最常用） |
| `rounded-lg` | 10px | 列表行、菜单面板、卡片 |
| `rounded-xl` | 12px | 弹窗、大幅面板 |
| `rounded-full` | — | 计数徽标、圆点、滚动条、分隔条手柄 |

### 1.3 字阶（Folo 原生尺度，禁止自造字号）

| Token | size/line-height | 用途 |
| --- | --- | --- |
| `text-largeTitle` | 26/32 | 应用级标题 |
| `text-title1` | 22/26 | 页面标题 |
| `text-title2` | 17/22 | 文章标题 |
| `text-title3` | 15/20 | 面板标题、弹窗标题、区块标题 |
| `text-headline` | 13/16 | **按钮、列表行标题、标签** |
| `text-body` | 13/16 | 正文（全局默认） |
| `text-callout` | 12/15 | 说明文字、次要描述 |
| `text-subheadline` | 11/14 | 极小标注 |
| `text-footnote` | 10/13 | 计数、时间戳、元信息、快捷键 |

数字一律加 `tabular-nums`。中文正文行高用 1.7–1.75。

### 1.4 阴影与动效

- `shadow-pop`：仅浮动层（命令面板、右键菜单、悬停工具条、阅读器两侧翻页键）。
- `shadow-modal`：仅弹窗。
- **常驻区块（栏、面板、分隔条）不加阴影**，用 1px 边框分隔。
- 颜色过渡 `transition-colors duration-150`；入场动画用 `animate-fade-in`(160ms) /
  `animate-scale-in`(140ms) / `animate-slide-up`(220ms)；缓动 `cubic-bezier(.16,1,.3,1)`（`ease-folo`）。
- 智能列表与视图组的动态图标：620ms，`cubic-bezier(.16,1,.3,1)`，只在 hover / 键盘焦点 /
  选中时播放一次；`prefers-reduced-motion: reduce` 时关闭（§7.5）。

### 1.5 头像阶梯

`primitives.tsx` 的 `radiusFor` 是项目唯一的头像规则：

| 尺寸 | 圆角 |
| --- | --- |
| ≤24px | `rounded-sm` |
| ≤32px | `rounded-md` |
| ≤48px | `rounded-lg` |
| >48px | `rounded-xl` |

有图用 `<img class="object-cover">`；无图/加载失败一律用**确定性渐变色 + 首字母**：
色相 = `hash(名称) % 360`，渐变 `linear-gradient(135deg, hsl(H 62% 52%), hsl((H+38)%360 58% 42%))`，
文字白色加粗。同一个名字永远得到同一种颜色（算法见 `lib/utils.ts` 的 `avatarGradient`，
服务端同算法见 `internal/feed/avatar.go` 的 `avatarGradient`）。

---

## 2. 区域划分

- 主内容区、模态窗、文章：`bg-background`。
- 次级表面（输入框、chip、代码块）：`bg-fill/…`。
- **区域之间用 1px `border-border` 分隔，不要用阴影或加大底色差。**
- 布局是**单栏内容页 + 文章详情模态窗**：列表 / 发现占满整个窗口，点击文章后
  在居中的模态窗里阅读。窄窗口下模态窗全屏，评论变成第二个 tab。
- 栏头高度固定：列表栏 53px（`h-[53px]`），`border-b border-border`；
  模态窗内的评论列头 40px（见 4.3）。
- 分组与订阅源、搜索与设置都在**列表栏底部的悬浮切换器**里（见 7.6）。

---

## 3. 组件规范

### 3.1 按钮

| 组件 | Class | 何时用 |
| --- | --- | --- |
| 次级/默认按钮 | `btn` | 刷新、取消、次要操作（透明底，hover 变 `item-hover`） |
| 主操作按钮 | `btn btn-accent` | **一个区域内只允许一个**：获取全文、获取评论、添加订阅、确定 |
| 幽灵按钮 | `btn-ghost` | 已有容器底色的场合 |
| 图标按钮 | `.icon-btn` 或 `<IconButton>` | 工具条上的图标动作；`active` 时 `bg-item-active text-fg/85` |

规格：`gap-1.5 px-2.5 py-1.5 rounded text-headline font-medium text-fg/85`；
禁用 `opacity-40` 且不可点；图标尺寸 13–15px。**不要给按钮加边框、加阴影或改圆角。**

### 3.2 计数徽标（count chip）

```
rounded-full bg-fill px-1.5 py-0.5 text-footnote font-medium tabular-nums text-fg/50
```
用于「评论 3」「未读 12」这类纯计数，与 `Kbd` 同一套底色与文字灰阶。

### 3.3 语义徽标（badge）

用于「作者」「精选」这类状态词，等同 `.chip`：`rounded-full px-2 py-0.5 text-footnote font-medium`，
底色 `bg-accent/10`、文字 `text-accent`。一屏内这种徽标应少而醒目。

### 3.4 列表行

```
rounded-lg px-2 py-1.5 transition-colors hover:bg-item-hover
```
**行本身不画边框、不加底色**；标题 `text-headline text-fg/85`，摘要 `text-callout text-fg/50`
并用 `line-clamp-*` 截断；元信息 `text-footnote text-fg/25`。选中态 `bg-item-active`。
行与行之间靠 4–8px 间距分开，不靠分隔线。

### 3.5 空状态与加载

空状态垂直居中：图标 `text-fg/25`（24–30px）+ 说明 `text-fg/50`，
若需要操作则放**一个** `btn btn-accent`。加载用 `<Spinner>` + `text-callout text-fg/50`，
骨架用 `.skeleton`。不要在空状态里放大段教程文字。

### 3.6 输入框 / 弹窗 / 菜单

- 输入框：`inputClass`（`rounded-md border border-border bg-fill/40`，聚焦 `ring-2 ring-accent/25`）。
- 弹窗：`rounded-xl border border-border bg-background shadow-modal`，标题 `text-title3 font-semibold`。
- 菜单：`.menu-surface` + `.menu-item`（hover 时 accent 底 + 白字）。
- 焦点环统一 `.ring-accent`（`ring-2 ring-accent/40`）。

---

## 4. 评论区规范

评论区是文章详情模态窗**右侧的一列**（`frontend/src/components/CommentsPane.tsx` 的
`embedded` 形态）：左边文章、右边作者卡与评论，两列各自滚动，中间只有 1px 分隔线。
窄窗口放不下两列时，模态窗改为「文章 / 评论」两个 tab，评论占满一屏。

### 4.1 位置与宽度

- 底色 `bg-background`（与文章一致），与文章之间只有 1px 竖线；**不加阴影、不加卡片底色**。
- 桌面固定 380px，**不再支持拖拽改宽**，也不再使用 `commentPaneWidth` 设置。
- 评论列上方是**作者卡**（订阅源头像 44px + 名称 + 作者 / 域名 + 已订阅徽标 + 文章属性胶囊 +
  「查看订阅源」），下面是评论头与评论滚动区；作者卡固定，只有评论区滚动。
- 文章还在加载时，作者卡显示骨架、评论显示骨架，模态窗尺寸不跳动。
- 模态窗关闭后评论状态随文章一起卸载，不做全局保留。

### 4.2 分隔线

固定 1px `border-l border-border`，没有拖拽手柄，也没有 hover 变色。

### 4.3 面板头部（40px）

```
h-10 border-b border-border px-4
```
- 标题：`MessageSquare`(15px, `text-fg/50`) + `评论`（`text-headline font-semibold text-fg`）
  + 计数徽标（见 3.2）。
- 右侧动作**只放刷新**（`IconButton`）。关闭模态窗的按钮在模态窗右上角，不在评论头里。
- 主操作（获取评论）只出现在空状态里（见 3.5）。

### 4.4 评论行

评论**不是卡片**：不画边框、不加底色，靠间距与缩进表达层级。

```
.article-content.comments .comment { rounded-lg px-2 py-2 hover:bg-item-hover }
.article-content.comments .comment .comment { ml-2 mt-1 border-l border-border pl-3 }  /* 嵌套回复 */
```

应用自己渲染的评论（`comment--api`）额外使用**头像列布局**：头像占第一列，
作者行、正文、嵌套回复都排在第二列，长贴因此有稳定的左对齐基线：

```
.comment--api { display:grid; grid-template-columns:1.25rem minmax(0,1fr); column-gap:.5rem }
.comment--api > .comment-author, .comment--api > .comment__content, .comment--api > .comment { grid-column:2 }
```
从页面抽取的评论保留上面的通用规则——它们的内部结构属于来源站点，不能假定。

- 作者行：头像（20px，按 1.5 阶梯取 `rounded-sm`）+ 名字（`text-headline font-semibold text-fg/85`）
  + 元信息（`text-footnote text-fg/50`，`tabular-nums`，形如「36¥ · 2026-10-04 · 3 赞」）。
- 正文：`text-body`，行高 1.7，`text-fg/85`；引用块用 1px 左边线 + `text-fg/50`；
  代码块 `rounded bg-fill p-2 text-footnote`。
- 嵌套回复：左侧 1px `border-border` + 缩进，**不换背景色**。
- 头像：有图用 `<img>`；无图或抓取失败用渐变色首字母（见 1.5），
  `avatar--text` 通过 `content: attr(data-initial)` 渲染首字母。

### 4.5 评论区的按钮清单

| 位置 | 按钮 | 形式 |
| --- | --- | --- |
| 评论头 | 刷新评论 | `IconButton` |
| 模态窗右上角 | 关闭 | `IconButton` |
| 空状态/失败态 | 获取评论 | `btn btn-accent`（该区域内唯一的主操作） |
| 获取全文（对照） | 获取全文 | `btn btn-accent` |
| 已展开全文时 | 重新获取 / 清除 | `btn`（次级） |

窄窗口的「文章 / 评论」tab 是模态窗头部的分段控件，不是评论区的按钮。

### 4.6 不要出现实现细节

界面文案只说用户能做什么、发生了什么，不解释实现：

- ❌「从原文页面提取完整正文（Readability）」 ❌「正文由 Readability 提取」
- ❌「评论可能由 JavaScript 加载」 ❌「已尝试 N 个候选接口」
- ✅ 空状态一句话：「暂无评论」「这篇还没有评论」
- 技术原因写进 debug 日志（`READS_LOG_LEVEL=debug`），不写进界面。

---

## 5. 自检清单

新增或修改界面时逐条核对：

- [ ] 只用了本文档列出的 token / 字阶 / 圆角 / 阴影，没有自造数值。
- [ ] 文字灰阶只有 `/85`、`/50`、`/25` 三档（`fill` 透明度只用 `/20`、`/30`、`/40`）。
- [ ] 一个区域内 accent 主操作不超过一个。
- [ ] hover/active 走 `item-hover` / `item-active`，没有手拼近似色。
- [ ] 常驻区块没有阴影；分隔靠 1px `border-border`。
- [ ] 可点区域有 hover 反馈，禁用态 `opacity-40` 且不可点。
- [ ] 动态图标只在 hover / focus / 选中时播放一次，`prefers-reduced-motion` 下保持静止；
      静止基形与 §7.1 的原图标一致。
- [ ] 图标按钮有 `title` 或 `aria-label`；开关类有 `aria-pressed`。
- [ ] 用 `measure-dom.mjs` 确认没有引入横向溢出。
- [ ] 界面文案不含实现细节（库名、脚本、接口、候选数量等），这些只进 debug 日志。
- [ ] 没有解释性副标题：字段提示、设置说明句、空状态第二行、功能说明横幅、快捷键提示行一律不出现（§8）。

---

## 6. 远程图片

站外图片一律经过 `RemoteImage`（列表缩略图）或 `proxyRemoteImages`（正文/评论 HTML），
它们会把图片指向应用自己的 loopback 代理（`internal/imgproxy`）：

- 原因：部分 CDN 会**拒绝 Referer 不是发布站点的图片请求**，实测 `img.ithome.com`
  对应用自身来源返回 **403**，而 WebView 加载 `<img>` 时无法修改 Referer，
  于是缩略图与正文配图直接破图；`platform.theverge.com` 则不受影响。
- 做法：代理以**文章 URL 作为 Referer** 取图并原样回传（`Cache-Control: max-age=86400`）。
  不入库、不占磁盘；WebView 自己缓存。
- 已内联的图片（`data:` 前缀、评论头像）保持原样，不再绕行。

---

## 7. 图标规范

图标以 `lucide-react` 为基形；视图组与智能列表的九枚动效变体见 §7.5。三条判定标准：

1. **名要对义** —— 图标的通用隐喻必须与它标注的功能一致（`Layers` 不能表示「今天」）。
2. **一图一义** —— 同一个图标不得在不同位置表示不同概念。
3. **一义一图** —— 同一个功能在不同位置必须用同一个图标。

### 7.1 唯一映射表

| 语义 | 图标 | 说明 |
| --- | --- | --- |
| 品牌标记 | `Rss` | 启动骨架屏、悬浮切换器「所有订阅源」 |
| 视图「首页」 | `AnimatedHomeIcon`（`House` 外轮廓 + 笑脸） | 列表栏头部的视图胶囊组，见 §7.5 |
| 视图「文章」 | `AnimatedArticlesIcon`（`AlignLeft` 基形） | 动效版见 §7.5 |
| 视图「社交」 | `AnimatedSocialIcon`（`AtSign` 基形） | 动效版见 §7.5 |
| 视图「图片」 | `AnimatedPicturesIcon`（`Image` 基形） | 动效版见 §7.5 |
| 视图「视频」 | `AnimatedVideosIcon`（`Video` 基形） | 动效版见 §7.5 |
| 列表布局切换 | `LayoutGrid` / `LayoutList` | 搜索行右侧；见 §7.7 |
| 智能列表「未读」 | `SmartUnreadIcon`（`Inbox` 基形） | 列表栏头部的圆形筛选组，见 §7.5 |
| 智能列表「星标」 | `SmartStarredIcon`（`Star` 基形） | 与星标动作、角标属同一图标族；动作与角标保持静态 `Star` |
| 智能列表「稍后读」 | `SmartReadLaterIcon`（`Bookmark` 基形） | 动效版见 §7.5 |
| 智能列表「今天」 | `SmartTodayIcon`（`CalendarDays` 基形） | 动效版见 §7.5 |
| 筛选「仅显示未读」 | `CircleDot` | 列表栏头部 |
| 文章发布时间 | `Calendar` | 不是 `CalendarPlus`（那是「添加到日历」） |
| 阅读时长 | `Clock` | 只表示时长 |
| 加入稍后读（动作） | `BookmarkPlus` | |
| 已读 / 未读状态 | `CheckCircle2` / `Circle` | |
| 评论（区块、开关、空状态） | `MessageSquare` | 同一语义可共用 |
| 获取全文 | `FileText` | |
| 刷新 / 重新获取 | `RefreshCw` | 列表、全部、评论、全文共用（同一语义族） |
| 检测订阅源 | `Rss` | 与品牌同义族（都指 RSS 订阅） |

### 7.2 刻意保留的差异

方向类图标按**控件形态**区分，这不是不一致，而是层级约定：

- **带文字的按钮**用 `ArrowLeft` / `ArrowRight`（表示「跳到上一篇/下一篇」）；
- **纯图标控件**（正文两侧悬浮轨道）用 `ChevronLeft` / `ChevronRight`（表示方向）。

因此 `ArrowLeft` 只承担「返回」与「带文字的上一篇」，`Chevron*` 只承担方向与展开/收起。

### 7.3 硬性要求

- **视图页签的 `ViewGlyph` 必须为每个 `VIEWS` key 写显式 case**。曾经漏掉 `videos`，
  于是「视频」页签静默显示成收件箱图标 —— 这类 fallback 静默错配要避免。
- 同一图标在同一屏内不得出现在两个不同语义的位置。
- 纯图标按钮一律带 `title`（或 `aria-label`）。
- 尺寸沿用现状：工具条 13–15px，正文元信息 16px，视图组 12px、智能列表 13px（`strokeWidth 1.9`）。

### 7.4 防回归

`scripts/check-icons.mjs` 会在构建时校验：视图组与智能列表的映射与 7.1 一致、两组筛选只存在于列表栏头部、
每个 `VIEWS` key 都有显式 case、九个动态图标组件确实从 `AnimatedIcons.tsx` 导入并导出，
且已废除的图标（`Layers`、`CalendarPlus`）不再出现。
与 `check-bindings.mjs` 一起挂在 `build.ps1` 上。

### 7.5 列表栏头部：两个圆形筛选组

列表栏头部有**两个并排的圆形筛选组**，视图组在左、智能列表组在右。两者是同一套控件语言：
一个 `rounded-full` 容器包住一组图标，只有选中项展开显示名字。

```
[订阅源/分组标题]  ( ◯ 首页 count ) ◯ ◯ ◯ ◯   ( ◯ 未读 count ) ◯ ◯ ◯        ← 视图组 | 智能列表组
```

- **视图组**：首页 / 文章 / 社交 / 图片 / 视频（`AnimatedIcons`，12px）。
  选中项展开为 `图标 + 名字 (+ 计数)`；视图自身的识别色（`VIEWS[].color`）只染**图标**，
  文字与容器保持中性。
- **智能列表组**：未读 / 星标 / 稍后读 / 今天（`AnimatedIcons`，13px），规则见下。
- **容器**：两组都用 `rounded-full border border-border/70 bg-fill/50 p-0.5`；
  按钮 `h-5 w-5`（选中时 `px-1.5`），组内 `gap-0.5`，两组之间 `gap-2`，作为一个整体靠左。
- **只有选中项显示名字**：未选中一律纯图标（带 `title` 悬停提示），选中项底色
  `bg-background`、`shadow-sm`。名字 `text-[0.65rem]`，计数 `text-[0.6rem] tabular-nums text-fg/50`，
  且受 `settings.sidebarShowUnreadCount` 控制。
- **标题只在订阅源 / 分组时出现**：视图与智能列表的选中态已经由展开项表达，再显示标题会重复。
- **窄宽度**：两组放在一个可横向滑动的容器里（`no-scrollbar overflow-x-auto`），
  列宽 ≥ 约 420px 时全部可见且无滚动；更窄时滑动查看，不挤压右侧操作图标。
- **命中区与可访问性**：`aria-pressed` 表示选中；`data-view` / `data-smart` 是稳定选择器，
  `data-active="true"` 供动效规则使用；智能列表按钮另带 `smart-row` 类名。
- **没有侧边栏**：视图与智能列表在列表栏头部，分组与订阅源在底部悬浮面板，
  搜索与设置在悬浮条右侧；`check-icons.mjs` 只认 `EntryList.tsx` 里的这两组控件。

视图组与智能列表的九枚图标都来自 `frontend/src/components/AnimatedIcons.tsx`。
八枚沿用 §7.1 的 lucide 基形；首页是 `House` 外轮廓加笑脸的自绘变体。它们都只增加一次性的动效。

| 组 | 语义 | 组件 | 基形 | 动效语言 |
| --- | --- | --- | --- | --- |
| 视图 | 首页 | `AnimatedHomeIcon` | `House` + 笑脸 | 房子有重量地弹跳、落地眨眼、笑弧展开 |
| 视图 | 文章 | `AnimatedArticlesIcon` | `AlignLeft` | 三行文字从左侧边距依次展开 |
| 视图 | 社交 | `AnimatedSocialIcon` | `AtSign` | @ 核心弹一下，一圈信号向外扩散 |
| 视图 | 图片 | `AnimatedPicturesIcon` | `Image` | 太阳弹出，山线自左向右绘制 |
| 视图 | 视频 | `AnimatedVideosIcon` | `Video` | 镜头张开，录制点闪两下 |
| 智能列表 | 未读 | `SmartUnreadIcon` | `Inbox` | 新条目小点落入托盘，托盘承住、下沉回弹 |
| 智能列表 | 星标 | `SmartStarredIcon` | `Star` | 星星收缩再放大、内填闪一下、两粒星芒 |
| 智能列表 | 稍后读 | `SmartReadLaterIcon` | `Bookmark` | 书签落下，像悬挂物一样摆动后停稳 |
| 智能列表 | 今天 | `SmartTodayIcon` | `CalendarDays` | 装订环弹动、日期点依次脉动、今日格亮起 |

规则：

- **只在交互时播放，不循环。** 触发条件是所在按钮 hover、键盘 `:focus-visible`、或当前选中
  （`data-active="true"`，视图组另有 `aria-pressed`）；播放一次 620ms，鼠标移开不保留动效。
  `smart-row` / `view-tab` 类名是 `index.css` 动效规则的挂载点，不要删除。
- **静止必须仍是原图标。** 只在动效中出现的元素（落点、星芒、今日格、社交信号圈、录制点）
  静止时 `opacity: 0`；不得为了动效改变静止轮廓、尺寸（视图 12px / 智能列表 13px）或位置，
  也不得产生布局抖动。首页的静止形态固定为 `House` 外轮廓 + 两眼一嘴，动效只做位移与眨眼，
  不改五官位置。
- **只做位移 / 缩放 / 旋转 / 透明度。** 不改颜色，不引入 JS 定时器；动效样式统一放在
  `index.css` 的「Smart-list icon motion」与「View-tab icon motion」区块，组件只输出 SVG 结构。
- **尊重减少动效。** 所有动画规则都在 `@media (prefers-reduced-motion: no-preference)` 内；
  `reduce` 时图标保持静止，动效元素保持隐藏。
- **不扩散到动作图标。** 文章模态窗的星标 / 稍后读按钮仍使用静态 lucide 图标：同一个动作
  在工具条里反复播放动效会干扰阅读。

---

## 8. 文案规范

界面只承载三类文字：

| 类型 | 例子 | 说明 |
| --- | --- | --- |
| **标签** | 添加订阅、获取全文、订阅源地址、主题 | 控件自述其意 |
| **数据** | 12 篇未读、约 5 分钟、版本 1.0.0、xxx.com | 事实读数 |
| **状态** | 正在获取评论…、这篇没有可获取的评论 | 过程与结果 |

**凡是解释「怎么做」「为什么」的句子一律不出现。** 用户要的是做事，不是读说明。

### 8.1 禁止

- 字段下方的提示句 —— ❌「可以直接粘贴 RSS / Atom 地址，也可以只填网站域名。」
- 设置项的说明句 —— ❌「打开文章时自动将其标记为已读。」
- 空状态第二行 —— ❌「点击刷新按钮拉取最新内容」
- 功能说明横幅 —— ❌「这个订阅源只提供摘要，可以抓取原文的完整正文。」
- 快捷键提示行 —— ❌ 空状态里铺一行「J K 切换文章 · M 标记已读」
- 实现细节 —— ❌ 库名、脚本、接口名、候选数量（只进 debug 日志）
- 开发期横幅 —— ❌「浏览器预览模式…」

### 8.2 要求

- 按钮文案要能独立表达意图，不靠旁边的解释。
- 空状态只留**一行**主文案（可配一个图标），不加副标题。
- 错误只说结论，原因写日志；结论不超过一句。
- 层级靠**留白和字阶**表达，不靠解释性文字堆叠。
- 设置项只显示名称与当前值（如「正文字号 / 15px」），不写作用说明。

### 8.3 自检

**删掉这句话，功能是否仍然可理解？** 若是，就该删。
### 7.6 订阅源悬浮切换器

分组与订阅源在列表栏底部的一个悬浮条里；面板**向上展开**覆盖列表。
悬浮条同时承载**搜索**与**设置**入口，因此应用不再有侧边栏。

```
[列表滚到底部留出 pb-16]
┌ 面板（向上展开，点外部或 Esc 关闭）┐
│ 未分组 / 中文博客 …              │  ← 分组可折叠，右键有分组菜单
│   ▣ 少数派        12             │  ← 图标 / 标题 / 未读数
│   ▣ 阮一峰的日志    5             │
├─────────────────────────────────┤
│ + 添加订阅   新建分组   8 个订阅源 │
└─────────────────────────────────┘
  ▣ 少数派                        ⌃   ← 悬浮条：当前上下文 + 展开指示
```

- **位置**：`absolute inset-x-2 bottom-2`，条高 `h-9`，`rounded-full`、
  `border border-border`、`bg-background/95`、`shadow-pop backdrop-blur-md`。
- **条的文案**：当前订阅源名 / 当前分组名 / `所有订阅源`，
  不出现解释性副标题（§8）。左侧图标：订阅源用 favicon，分组用 `Folder`，其余用 `Rss`。
- **面板**：`bottom` 在条上方 `gap-1.5`，`max-h-[min(60vh,26rem)]`、`rounded-xl`、
  `border-border`、`shadow-modal`；内部列表滚动，底部操作行固定不滚动。
- **交互**：点条切换开合；展开时有一条透明背景层接收外部点击以关闭；`Esc` 关闭；
  选中订阅源 / 分组 / 「查看分组全部文章」后自动关闭并导航。
- **滚动留白**：列表滚动区底部留 `pb-16`，最后一行不会被悬浮条遮住。
- **组件**：`frontend/src/components/FeedSwitcher.tsx`（列表、分组折叠、右键菜单），
  共享动作在 `frontend/src/lib/feedActions.ts`；`data-switcher="toggle"` 是测试钩子。
### 7.7 列表布局：列表 / 瀑布流

文章列表有两种呈现方式，由设置项 `entryLayout` 持久化（默认 `list`）：

| 值 | 形态 |
| --- | --- |
| `list` | 时间线行（默认）：favicon + 标题 + 摘要 + 80px 缩略图；内容居中在 900px 阅读宽度 |
| `masonry` | 小红书式瀑布流：2–5 列自适应卡片，图片按原始比例，高度不同、互相咬合 |

- **入口**：搜索行最右侧的 `IconButton`（当前是列表时显示 `LayoutGrid`，标题「瀑布流模式」；
  当前是瀑布流时显示 `LayoutList`，标题「列表模式」），选中态用 `active`。
  放在搜索行而不是栏头，是为了不挤压栏头那两组胶囊筛选。
- **瀑布流容器**：`columns-2 gap-3 [column-fill:balance]`，每个卡片外层
  `mb-3 break-inside-avoid`，这是 CSS 多列实现的真瀑布流（顺序按列自上而下）。
  列数随视口自适应：`<640px` 两列、`≥640px` 三列、`≥900px` 四列、`≥1200px` 五列；
  **最少两列、最多五列**。
- **卡片**：`overflow-hidden rounded-lg border border-border bg-fill/20`，图片区统一用
  `CardImage`（`components/primitives.tsx`）。
- **图片框先定尺寸**：`aspectRatio` 由 `cardRatio(entry.id)` 决定（`4/3`、`1/1`、`16/9` 三档，
  按 id 取模）。盒子在图片到达之前就占好位，所以**卡片高度不随图片加载变化**；
  不要改回「图片自然撑开」。
- **模糊占位 → 清晰**：框底是该订阅源的确定性渐变（`avatarGradient`）放大 + `blur-xl`；
  图片 `opacity-0 blur-lg scale-105` → `opacity-100 blur-0 scale-100`（450ms，
  `object-cover` 裁切）。加载过程只影响清晰度，不影响布局。
- **无图卡片（文字封面）**：`imageUrl` 为空时不留空框、不用 favicon 占位，改用文字封面：
  1. 底色 = 该订阅源色相（`hueOf(seed)`）以 **14% 透明度**叠加在主题表面色上
     （浅色主题是浅米色、深色主题是暗色调，同一订阅源永远同一色）；
  2. 左上角 `Quote` 符号（同色相、34% 透明度，比底色深一档），标题**居中**、
     `17px`、`font-semibold`、`line-clamp-6`，右下角一小段横线；
  3. 标题只出现在封面里，卡片下方**不再重复标题**，只保留「订阅源 · 时间」一行；
  4. 盒子比例与有图卡片一致，瀑布流因此仍然错落但不跳动。
- **文字区** `p-2`：有图时标题 `line-clamp-3 text-headline`；无论有无图都有一行
  favicon(12px) + 订阅源 + 相对时间。
- **状态**：未读点在卡片右上角（`h-2 w-2 bg-accent` + `ring-2 ring-background`）；
  选中卡片 `border-accent/60 ring-1 ring-accent/40`；`dimRead` 时标题与元信息降灰。
- **不使用**：摘要、日期吸顶分组、行左外的未读圆点——这些属于时间线行，
  瀑布流里没有位置；分组标题无法跨多列吸顶，所以瀑布流模式不显示日期分组。
- **响应式**：页面本身占满窗口，修改列数只改变卡片密度，不改变栏头与底部悬浮条的位置。
- **图片加载**：框已预留、占位已模糊，加载只改变清晰度，不改变卡片尺寸；
  滚动区底部仍留 `pb-16` 避免被悬浮条遮住。
### 7.8 发现面板（推荐）

订阅推荐与文章推荐放在同一个「发现」面板里，替换列表栏的内容（`DiscoverPane.tsx`）。

- **入口**：列表栏底部悬浮条上的 `Compass` 图标按钮；面板头部右侧是刷新与关闭。
- **数据**：`RecommendEntries`（未读文章按已读/星标内容的词权重排序）与
  `RecommendFeeds`（内置订阅目录按订阅与历史的关键词匹配排序，已订阅的站点过滤掉）。
  点击订阅卡片走正常的 `AddFeedByURL`，之后刷新订阅列表并把卡片变成「已订阅」。
- **结构**：两个分组标题（`值得订阅` / `为你推荐`，`text-footnote uppercase text-fg/25`）：
  1. 订阅卡片：两列起、宽屏最多四列的网格，每张 `rounded-lg border border-border bg-fill/20 p-2.5`，
     顶部 favicon(28px) + 名称 + 标签，下面一句简介（`line-clamp-2`），
     底部一个胶囊按钮：未订阅 `bg-accent text-white` + `Plus`「订阅」，
     订阅中 `Spinner`，已订阅 `bg-fill text-fg/50`「已订阅」且禁用。
  2. 文章卡片：与 §7.7 瀑布流卡片同一规格（2–4 列、`break-inside-avoid`、图片原始比例），
     点击打开文章模态窗。
- **不出现**：说明性副标题、评分数字、来源解释（§8）。
- 空状态：`暂时没有可推荐的文章`；加载用卡片骨架。

### 7.9 下拉刷新

列表栏与发现面板都支持下拉刷新（`hooks/usePullToRefresh.ts`）。

- 手势：在滚动区顶部继续下拉；位移按 0.45 阻尼、上限 96px，超过 **64px** 触发。
- 指示器：滚动区顶部的一行 `text-callout text-fg/50`，高度随位移展开；
  文案只有「下拉刷新」→「松开刷新」→「正在刷新…」三态（§8：不写解释）。
- 下拉超过 8px 即视为手势，抑制随之而来的 click，避免松手时误开文章。
- 滚动区加 `touch-pan-y overscroll-contain`，不让系统级刷新介入。
- 刷新内容：列表栏刷新当前订阅（或全部）；发现面板重新取推荐。

### 7.10 文章详情模态窗

文章不再占据常驻阅读列，点击列表行 / 瀑布流卡片后以模态窗打开（`selectedEntryId` 驱动，
`components/ArticleModal.tsx`）。布局按小红书笔记详情：**左边文章，右边作者卡 + 评论区**。

- **容器**：`fixed inset-0 z-50 flex items-center justify-center`；背景遮罩
  `bg-black/50 backdrop-blur-sm` 点击关闭；窗口 `w-[min(1200px,94vw)] h-[min(92vh,920px)]`，
  `rounded-xl border border-border bg-background shadow-modal`。
- **桌面（≥1024px）**：左列 `flex-1`，右列固定 380px、`border-l border-border`；
  两列各自滚动。模态窗右上角是唯一的关闭按钮（`IconButton`）。
- **窄屏（<1024px）**：模态窗全屏、无圆角；头部是「文章 / 评论」分段控件 + 关闭按钮。
  两个面板都保持挂载，仅用 `hidden` 切换，来回切 tab 不丢文章滚动位置。
- **左列文章**（`Reader modal`）：保持小红书阅读顺序——主图、标题、正文；
  浮动工具条（已读 / 星标 / 稍后读 / 复制 / 打开原站）与「全文 / 原文」切换不变；
  作者卡与属性胶囊**移到右列**，不在文章内重复。
- **右列**：顶部作者卡（`FeedIcon` 44px + 订阅源名 + 作者/域名 + 已订阅徽标 +
  属性胶囊 + 「查看订阅源」），下方是评论列（§4）。
- **关闭与可访问性**：`role="dialog"` + `aria-modal`；Esc、遮罩、关闭按钮均可关闭；
  打开时焦点落在关闭按钮；Tab 在模态窗内循环，不会走到背后的列表。
- **翻页**：保留上一篇 / 下一篇；键盘 `j/k`、`←/→` 仍可切换当前文章。
### 7.11 卡片 → 文章模态窗：共享图片的连续形变

文章详情是模态窗（§7.10），从**被点击的卡片**张开，关闭时缩回同一张卡片
（`components/ArticleModal.tsx`）。核心不是“把窗口放大”，而是两件事同时发生：
**面板从卡片矩形展开**（不是淡入），**卡片里的那张图就是详情页的大图**——
它在固定浮层里从卡片图片框飞到详情页主图的位置。

- **记录原点**：卡片点击时把 `{ card, image, url, referer }` 写进 UI store
  （`detailOrigin`，`detailOriginOf()` 生成）：`card` 是整张卡片、`image` 是卡片图片框、
  `url` 是原图地址（供浮层重新请求同一张图）。行点击同样适用。
  卡片图片框和详情主图分别带 `data-card-image` / `data-hero-image` 锚点。
- **面板展开（打开）**：面板以左上角锚定卡片矩形（`transform-origin: top left`，
  `scale(卡片宽/面板宽)` + `translate(Δ)`），420ms 展开到最终矩形，右/下边缘扫出去；
  `opacity` 0→1 只作为避免透底的辅助，**不要只做淡入**。
- **飞行动画（打开）**：
  1. 展开开始的同一帧，浮动图片在卡片图片框位置出现；
  2. 一个 `position: fixed` 的浮动 `<div>` 以卡片图片框的矩形出现，`background-image`
     用同一个 `proxiedImageURL()`（命中缓存，不会二次下载）；
  3. 等这篇文章的主图渲染出来（`entry.id === selectedEntryId` 且存在 `[data-hero-image]`），
     把主图 `opacity: 0`，再让浮层把 **left/top/width/height** 过渡到主图矩形
     （420ms，同一缓动），圆角 8px → 主图圆角。
     **必须动画盒子而不是 `scale`**：图片是 `background-size: cover`，盒子变化会重新裁切，
     缩放会把照片拉变形。主图矩形要换算成最终坐标：面板此时还在展开，`getBoundingClientRect()`
     拿到的是缩放中的矩形，用 `DOMMatrixReadOnly(panel transform)` 的比例把主图/面板的
     相对偏移还原成局部坐标，再加展开前记录的 `panelFinalRef`。
     **不要临时清空面板 transform 再测量**——那会打断展开过渡；
  4. 落地后主图 160ms 淡入、浮层 140ms 淡出并 `display: none`（**保留 DOM**，回程要用）。
- **飞行动画（关闭）**：所有关闭入口（返回/X/Esc/遮罩）走同一个 `close()`：
  量主图当前矩形 → 浮动层放回主图位置 → 反向把盒子过渡回卡片图片矩形（360ms），
  同时面板反向收回卡片矩形，400ms 后 `openEntry(null)`；`closingRef` 防重复触发。
  落地后的清理定时器必须判断 `closingRef`，否则会在回程途中把浮动层 `display: none`。
- **没有图片的卡片**（`imageUrl` 为空）：没有共享元素，退化为**面板 FLIP**——
  面板从卡片矩形缩放展开/收回（`transform-origin: top left`，380ms/320ms），
  此时先写起始样式、`void offsetWidth` 强制一次样式刷新再写结束样式，否则浏览器
  没绘制过起始态会直接跳到终点（“突然出现”）。
- **没有卡片来源**（命令面板/键盘）：两个矩形都没有，用原有的 `animate-scale-in`。
- **降低动效**：`prefers-reduced-motion` 时不做飞行与 FLIP，主图/面板直接到位，
  浮层立即移除。