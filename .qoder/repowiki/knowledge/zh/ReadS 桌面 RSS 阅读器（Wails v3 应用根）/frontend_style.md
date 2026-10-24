## 1. 采用的体系

ReadS 的前端（位于 `frontend/`，Wails v3 应用）使用 **Tailwind CSS v3** 作为唯一的样式框架，搭配 **PostCSS + Autoprefixer**。没有引入任何组件库（如 shadcn、Radix 等），也没有 SCSS/Sass——所有样式均写在 `.css` 文件中。Dark mode 通过 Tailwind 的 `darkMode: 'class'` 模式实现，由 `.dark` 根类切换。

## 2. 关键文件

- `frontend/tailwind.config.js`：主题扩展（颜色、圆角、字体、字号、间距、动画、阴影）的唯一入口。
- `frontend/src/index.css`：全局设计令牌（CSS custom properties）、基础层（base）、组件层（components）、工具层（utilities）以及文章阅读器的排版规则。
- `frontend/postcss.config.js`：启用 tailwindcss 与 autoprefixer。
- `frontend/src/components/primitives.tsx`、`ArticleModal.tsx`、`PodcastPlayer.tsx`、`overlays.tsx`、`dialogs.tsx`：少量直接使用 CSS 变量（`--fo-*`、`--r-*`、`--w-*`、`--h-*`）的组件。

## 3. 架构与设计令牌

### 3.1 设计令牌 = CSS 自定义属性

`index.css` 在 `@layer base :root` 下定义浅色主题的所有令牌，并在 `.dark` 中覆盖为深色主题。令牌分为四类：

| 类别 | 变量前缀 | 示例 | 用途 |
|---|---|---|---|
| 品牌色 | `--fo-a` | `21.6 100% 50%`（#FF5C00） | 强调色 |
| 表面色 | `--fo-background / sidebar / item / fill / border / fg` | 背景、侧栏、内容区、边框、前景色 | 语义化配色 |
| 几何尺寸 | `--r-control/card/panel`、`--h-header`、`--w-rail`、`--w-col`、`--w-dialog`、`--modal-w`、`--modal-h` | 圆角、列宽、模态框尺寸 | 布局尺寸 |
| 状态色 | `--fo-item-hover`、`--fo-item-active` | 预混合透明度的 HSL | hover/active 背景 |

这些值是 **HSL 三元组**（不含 alpha），以便 Tailwind 的 `<alpha-value>` 机制（如 `bg-accent/90`）能动态叠加透明度。

### 3.2 Tailwind 扩展映射到令牌

`tailwind.config.js` 通过 `theme.extend` 将令牌暴露给 Tailwind 工具类：

- 颜色：`accent`、`background`、`sidebar`、`fill`、`border`、`fg` 等直接映射到 `hsl(var(--fo-*) / <alpha-value>)`。
- 圆角：`control` (8px)、`card` (10px)、`panel` (12px)，注释明确标注「DESIGN-REVIEW §3.1」。
- 字体族：主栈为 `SN Pro → Inter → -apple-system → ... → PingFang SC → Noto Sans CJK SC`，等宽字体为 `JetBrains Mono`。
- 字号：采用 Folo 的 macOS 风格类型刻度（largeTitle/title1/.../footnote/read），其中 `read` 是阅读器正文专用字号。
- 间距：`feedcol`、`entrycol`、`header`、`rail`、`col`、`dialog`、`modal`、`modal-h` 等全部委托给 CSS 变量。
- 动画：`fade-in`、`slide-up`、`scale-in`、`shimmer`、`spin-slow`，缓动函数统一用自定义的 `folo: cubic-bezier(.16,1,.3,1)`。
- 阴影：`pop`（菜单）、`modal`（模态框）。

### 3.3 组件级样式约定

`index.css` 的 `@layer components` 定义了可复用的原子组件类：

- `btn` / `btn-accent` / `btn-ghost`：按钮基类 + 变体。
- `icon-btn`：7×7 尺寸的图标按钮。
- `chip`：胶囊标签。
- `menu-surface` / `menu-item`：下拉菜单容器与项。
- `skeleton`：带 shimmer 动画的占位骨架屏。
- `scrollbar-thin`：macOS 风格的细滚动条（宽度 8px，悬停加深）。
- `drag-region` / `no-drag`：Wails 桌面应用的拖拽区域标记。
- `ring-accent`：统一的焦点环。

### 3.4 文章渲染隔离

文章内容的样式被严格限定在 `.article-content` 选择器下，并强制：

```css
.article-content {
  word-break: break-word;
  overflow-x: auto;
  max-width: 100%;
  min-width: 0;
}
```

这是为了防止 RSS 源中的内联宽元素（图片、表格、代码块）撑开阅读器列宽。表格通过 `.table-scroll` 包裹并横向滚动；图片居中显示且 `rounded-lg`；标题按语义级别映射到固定字号；链接使用 accent 色 + 装饰线。

### 3.5 暗色主题策略

通过 Tailwind 的 `darkMode: 'class'`，只需在根节点添加 `.dark` 类即可切换完整主题。所有颜色变量在 `.dark` 中被重新赋值，前景色从黑变为白（`--fo-fg: 0 0% 100%`），背景从纯白变为 `#121212`，hover/active 状态也对应调整为深色半透明值。

## 4. 约定与约束

- **所有颜色必须通过 Tailwind 暴露的语义化类名（`bg-background`、`text-fg/85`、`border-border`）或 CSS 变量引用，禁止在组件中使用硬编码十六进制颜色。** 这一约定由 `tailwind.config.js` 中 `colors.*` 只映射 `var(--fo-*)` 的方式间接保证。
- **圆角按角色三档区分：控制 8px、卡片 10px、面板 12px。** 来源：`tailwind.config.js` 中 `borderRadius` 扩展及注释「DESIGN-REVIEW §3.1」。
- **字号遵循 Folo 的类型刻度（largeTitle→footnote + read），不在组件里写死字号。** 来源：`tailwind.config.js` 的 `fontSize` 扩展。
- **暗色模式通过 `.dark` 类切换，不使用媒体查询。** 来源：`tailwind.config.js` 的 `darkMode: 'class'`。
- **文章内容由 `.article-content` 子选择器隔离，禁止泄漏到应用 chrome。** 来源：`index.css` 中的注释与 scoped 规则。
- **组件样式集中在 `index.css` 的 `@layer components`，不在组件 TSX 中写行内样式。** 观察到的组件类（`btn`、`icon-btn`、`chip`、`menu-surface`、`skeleton`）均在此处定义。
- **用户输入控件（input、textarea、[contenteditable]、`.selectable`、`.article-content`）显式开启 `user-select: text`，其余默认禁用文本选择以模拟桌面应用体验。** 来源：`index.css` base 层规则。
- **无第三方 UI 组件库。** 仓库未安装任何 UI kit（如 @radix-ui/themes、shadcn/ui），所有交互原语均为手写。
- **PostCSS 仅启用 tailwindcss 与 autoprefixer，无其他预处理链。** 来源：`postcss.config.js`。

## 5. 总结

该项目的样式体系可以概括为：**Tailwind CSS + CSS 自定义属性设计令牌 + 单文件组件样式 + 文档驱动的尺寸规范（DESIGN-REVIEW）**。设计令牌集中管理于 `index.css`，Tailwind 配置仅做薄桥接；组件级样式集中在 `index.css` 的 `@layer components`；文章渲染通过严格的 CSS 作用域隔离，确保外部 RSS 内容不会破坏应用布局。暗色主题通过 `.dark` 类切换，所有颜色均以 HSL 三元组形式提供 alpha 支持。