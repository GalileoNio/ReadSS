# 图标审计与修改计划

> **状态：已实施。** 映射规则已固化进 [DESIGN.md](DESIGN.md) §7「图标规范」，
> 并新增 `scripts/check-icons.mjs` 在构建时校验（已挂到 `build.ps1`）。
> 本文件保留作为审计记录：它说明了每个决定**为什么**这么定。

审计范围：`frontend/src` 全部 `.ts/.tsx`，共导入 **38** 个 lucide 图标、实际使用 **34** 个。
依赖版本 `lucide-react@0.454.0`；**下表所有建议图标都已确认存在于该版本**，无需升级依赖。

判定标准（三条）：

1. **名要对义** —— 图标的通用隐喻要与它标注的功能一致。
2. **一图一义** —— 同一个图标不能在不同位置表示不同概念。
3. **一义一图** —— 同一个功能在不同位置要用同一个图标。

---

## 一、名不对义（7 处，必修）

| # | 图标 | 位置 | 现在表示 | 为什么不合适 |
| --- | --- | --- | --- | --- |
| 1 | `CalendarPlus` | `Reader.tsx:405` | 文章发布日期 | CalendarPlus 是「添加到日历」。日期就该用日历本体 |
| 2 | `Layers` | `Sidebar.tsx:209` | 智能列表「今天」 | Layers 是图层，与「今天」毫无关系 |
| 3 | `Layers` | `Sidebar.tsx:431`（`ViewGlyph` `social`） | 视图「社交」 | 同上，图层 ≠ 社交 |
| 4 | `Star` | `Sidebar.tsx:433`（`ViewGlyph` `pictures`） | 视图「图片」 | Star 在本应用是「星标」，语义已被占用，且不等于图片 |
| 5 | `Inbox` | `Sidebar.tsx:435`（`ViewGlyph` default） | 视图「视频」 | **这是一个逻辑缺陷**：`VIEWS` 有 5 个 key，`ViewGlyph` 只写了 4 个 case，`videos` 落到 default，于是「视频」显示成收件箱 |
| 6 | `Rss` | `Sidebar.tsx:429`（`ViewGlyph` `articles`） | 视图「文章」 | `Rss` 同时是应用品牌标记（见下），不该再承担导航含义 |
| 7 | `Circle` | `EntryList.tsx:298` | 「仅显示未读」开关 | 裸圆点是**状态**符号（列表里用它表示未读），拿来当筛选开关会被读成「一个点」 |

---

## 二、重复使用：一个图标多种含义（5 组）

| 图标 | 含义 A | 含义 B | 含义 C | 处理 |
| --- | --- | --- | --- | --- |
| `Layers` | 今天 | 社交 | 仅显示未读开关 | 三处全部换掉 |
| `Inbox` | 未读（`Sidebar.tsx:206`） | 视图「全部」（`:427`） | 视图「视频」（`:435` fallback） | 保留「未读」；「全部」换掉；「视频」补 case |
| `Star` | 星标：智能列表 `:207` / 动作 `Reader.tsx:269` / 角标 `EntryList.tsx:84` | 视图「图片」`Sidebar.tsx:433` | — | 「图片」换掉，星标三处保持不变 |
| `Clock` | 稍后读（`Sidebar.tsx:208`） | 加入稍后读动作（`Reader.tsx:279`） | 阅读时长「约 N 分钟」（`Reader.tsx:410`） | 前两者改用书签族；`Clock` 只保留「时长」 |
| `Rss` | 品牌标记（`App.tsx:61`、`Sidebar.tsx:231`） | 视图「文章」（`Sidebar.tsx:429`） | 「检测订阅源」按钮（`dialogs.tsx:95`） | 品牌 + 检测**保留**（都属 RSS 语义，一处是品牌、一处是功能）；「文章」换掉 |

`RefreshCw`（刷新列表／刷新全部／刷新评论／重新获取全文）虽然出现 5 次，但都属于「重新获取」同一语义族，**不改**。

---

## 三、同一功能用了不同图标（1 处必修，1 处待定）

| 功能 | 位置 A | 位置 B | 处理 |
| --- | --- | --- | --- |
| 「仅显示未读」开关 | `EntryList.tsx:298` → `Circle` | `Sidebar.tsx:283` → `Layers` | **必修**：两处统一为 `CircleDot` |
| 上一篇 / 下一篇 | 正文底部按钮 `Reader.tsx:450/463` → `ArrowLeft/ArrowRight` | 两侧悬浮轨道 `Reader.tsx:487/501` → `ChevronLeft/ChevronRight` | **建议保留差异并写成规则**：带文字的按钮用 Arrow（表示跳转），纯图标控件用 Chevron（表示方向）。这属于刻意的层级区分，不是失误——但必须写进规范，否则以后会被当成不一致而乱改 |

---

## 四、拟定映射（唯一事实来源）

替换后每个图标只有一个含义：

| 语义 | 现用 | 改为 | 备注 |
| --- | --- | --- | --- |
| 品牌标记 | `Rss` | `Rss` | 保持 |
| 视图「全部」 | `Inbox` | `LayoutList` | 与「未读」区分 |
| 视图「文章」 | `Rss` | `Newspaper` | |
| 视图「社交」 | `Layers` | `Users` | |
| 视图「图片」 | `Star` | `Images` | |
| 视图「视频」 | *(缺失，落到 Inbox)* | `Video` | 同时补上 `case 'videos'` |
| 智能列表「未读」 | `Inbox` | `Inbox` | 保持（收件箱＝未读，最贴切） |
| 智能列表「星标」 | `Star` | `Star` | 保持 |
| 智能列表「稍后读」 | `Clock` | `Bookmark` | 与时长解耦 |
| 智能列表「今天」 | `Layers` | `CalendarDays` | |
| 筛选「仅显示未读」 | `Circle` / `Layers` | `CircleDot` | 两处统一 |
| 发布时间 | `CalendarPlus` | `Calendar` | |
| 阅读时长 | `Clock` | `Clock` | 保持（时长） |
| 加入稍后读 | `Clock` | `BookmarkPlus` | |
| 未读／已读状态 | `Circle` / `CheckCircle2` | 不变 | |

---

## 五、实施步骤

**第 1 步 · 修逻辑缺陷（独立、零风险）**
- `Sidebar.tsx` `ViewGlyph`：新增 `case 'videos': return <Video {...common} />`，`default` 改为 `LayoutList`。
- 这一步单独提交即可解决「视频显示成收件箱」。

**第 2 步 · 语义修正**
- `Reader.tsx:405` `CalendarPlus` → `Calendar`
- `Sidebar.tsx:209` `Layers` → `CalendarDays`

**第 3 步 · 消除一图多义**
- `Sidebar.tsx:427` `Inbox` → `LayoutList`；`:429` `Rss` → `Newspaper`；`:431` `Layers` → `Users`；`:433` `Star` → `Images`
- `Sidebar.tsx:208` `Clock` → `Bookmark`；`Reader.tsx:279` `Clock` → `BookmarkPlus`
- 同步更新 `Sidebar.tsx` 顶部的 `lucide-react` 导入（`Layers` 若不再使用需移除，否则 `tsc` 会报未使用）

**第 4 步 · 统一筛选开关**
- `EntryList.tsx:298` 与 `Sidebar.tsx:283` 均改为 `CircleDot`

**第 5 步 · 固化规范**
- 在 `DESIGN.md` 新增 §7「图标规范」：收录上面的映射表、三条判定标准，
  以及「带文字按钮用 Arrow / 纯图标控件用 Chevron」这条刻意规则。

**第 6 步 · 防回归（可选）**
- 新增 `scripts/check-icons.mjs`：把视图页签与智能列表的「语义 → 图标」映射写进脚本，
  扫描 `Sidebar.tsx` 校验；同时禁止已废除的组合（如 `ViewGlyph` 里再出现 `Layers`）。
  与既有 `check-bindings.mjs` 一起挂进 `build.ps1`。

---

## 六、验收

- `tsc --noEmit` 通过（会强制清理不再使用的导入）。
- 逐个视图页签、智能列表、阅读器元信息行目视核对：图标与文字标签一致。
- 同一个图标不再出现在两个不同语义的位置：对 34 个图标复查一遍使用点即可。
- 构建 + `--selftest` 通过，界面无横向溢出（`measure-dom.mjs`）。

---

## 七、风险与说明

- 本计划**只改图标选择**，不动尺寸、颜色、间距与交互，因此不触及设计 token。
- 视图页签的图标尺寸/描边（`size={19} strokeWidth={1.9}`）保持不变，`ViewGlyph` 的调用签名不变。
- 若希望进一步降低「一图多义」风险，可考虑给视图页签改用 Folo 的分色方案已有实现
  （`VIEWS[].color`），但那是另一件事，不在本计划内。
