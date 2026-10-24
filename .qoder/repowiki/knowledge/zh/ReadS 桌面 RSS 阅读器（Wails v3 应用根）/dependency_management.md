## 1. 使用的系统与工具

本仓库是 Go 后端 + React 前端的 Wails v3 桌面应用，依赖管理分为两个完全独立的子系统：

- **Go 后端**：使用 `go.mod` + `go.sum`（Go Modules），模块名为 `reads`，Go 版本锁定为 `1.26.8`。
- **前端**：使用 `pnpm`（v10+，见 `frontend/pnpm-workspace.yaml` 的注释）作为包管理器，依赖声明在 `frontend/package.json`，锁文件为 `frontend/pnpm-lock.yaml`。

两个子系统的依赖来源均为公共注册表（Go proxy、npm registry），仓库中未发现 GOPRIVATE、GOPROXY 自定义、npm registry、镜像源或 vendor 目录配置。

## 2. 关键文件

| 文件 | 作用 |
|---|---|
| `go.mod` | Go 模块根定义、直接依赖与间接依赖清单 |
| `go.sum` | Go 模块校验和（由工具自动生成，未手动维护） |
| `frontend/package.json` | 前端运行时与开发依赖声明 |
| `frontend/pnpm-workspace.yaml` | pnpm 工作区/行为配置（单项目 workspace） |
| `frontend/pnpm-lock.yaml` | pnpm 安装锁文件（存在但未在此快照中读取内容） |
| `scripts/bootstrap-go.mjs` | Go 环境引导脚本（仅设置环境变量，不拉取依赖） |
| `scripts/fetch-deps.ps1` | Windows 上获取外部二进制依赖的脚本（ASR 模型等，非 npm/go 包） |

## 3. 架构与约定

### Go 依赖

- 所有直接依赖均显式列出在 `require` 块中，包括：
  - UI 桥接：`github.com/wailsapp/wails/v3 v3.0.0-beta.27`
  - RSS 解析：`github.com/mmcdole/gofeed v1.5.0`
  - HTML 可读性提取：`github.com/go-shiori/go-readability`（使用带时间戳的 pseudo-version，指向 commit `5db1dc9836f0`）
  - CSS 选择器：`github.com/andybalholm/cascadia v1.3.3`
  - 本地 SQLite：`modernc.org/sqlite v1.60.1`（及其依赖 `modernc.org/libc`、`mathutil`、`memory`）
  - WebSocket：`github.com/coder/websocket v1.8.14`
  - XDG 路径 / D-Bus / go-ole：Windows GUI 平台相关间接依赖
- 间接依赖通过 `// indirect` 标注，便于区分直接引用与传递引入。
- 未发现 `replace` 指令、`GOPRIVATE` 或私有 module proxy 配置；依赖全部走官方 Go Module Proxy。
- 未发现 `vendor/` 目录，构建时直接从缓存拉取。

### 前端依赖

- 运行时依赖：`react`、`react-dom`、`zustand`、`clsx`、`lucide-react`、`@wailsio/runtime: 3.0.0-beta.27`（与 Go 端 wails 版本对齐）。
- 开发依赖：Vite 5、TypeScript 5、TailwindCSS 3、PostCSS/Autoprefixer、React 类型声明。
- 依赖版本策略：运行时依赖使用较宽松的 `^` 范围（如 `^18.3.1`、`^4.5.5`），开发依赖同样用 `^`；但 `@wailsio/runtime` 与 Go 端 wails 一样固定到 `3.0.0-beta.27`，确保前后端 ABI 一致。
- pnpm 配置（`frontend/pnpm-workspace.yaml`）做了三项重要约定：
  1. `allowBuilds.esbuild: false` — 禁用 esbuild 的 postinstall 脚本，因为 Windows DSH 沙箱会阻止其子进程验证二进制（注释明确说明）。esbuild 的可执行文件由可选依赖 `@esbuild/win32-x64` 提供。
  2. `nodeLinker: hoisted` — 使用扁平化 `node_modules`，以兼容 Vite 预打包时对裸 specifiers 的解析行为。
  3. `verifyDepsBeforeRun: false` — 不在每次 `pnpm run` 前重新校验依赖树，避免 CI 中的额外开销。

### 跨语言版本对齐

Go 端与前端都使用 Wails v3 beta 通道：
- Go：`github.com/wailsapp/wails/v3 v3.0.0-beta.27`
- 前端：`@wailsio/runtime: 3.0.0-beta.27`
二者版本号严格一致，这是保证 Wails 绑定生效的关键约束。

## 4. 约定与约束

- **描述性观察**（代码实际表现）：
  - Go 与前端各自独立管理依赖，没有共享的顶层依赖清单。
  - 所有第三方包均来自公共注册表，仓库内不包含任何 vendored 源码。
  - Go 间接依赖统一使用 `// indirect` 注释标记。
  - 前端使用 pnpm 而非 npm/yarn，并通过 `pnpm-workspace.yaml` 覆盖默认行为。
  - Wails 的前后端 runtime 版本被硬编码为相同的 `3.0.0-beta.27`。

- **可验证的规则**（由文件或实现强制）：
  - Go 构建要求 Go 版本 `1.26.8`（由 `go.mod` 的 `go 1.26.8` 行强制，`go build` 会拒绝不匹配的工具链）。
  - 前端构建前必须先运行 TypeScript 类型检查（`"build": "tsc --noEmit ... && vite build"`），否则不会产出产物。
  - 前端 `node_modules` 必须采用 hoisted 布局（`nodeLinker: hoisted`），否则 Vite 预打包的 bare specifier 解析会失败——这是由 pnpm 配置文件直接强制的行为。
  - esbuild 的 postinstall 脚本被显式禁用（`allowBuilds.esbuild: false`），该限制在 Windows DSH 沙箱下不可绕过，属于硬性约束。
  - 无私有仓库/GOPRIVATE 配置，因此无法在不修改 `go.mod`/`package.json` 的前提下引入私有模块。

- **缺失项**（经搜索未发现）：
  - 无 `GEMINI.md`/`.golangci.yml` 等依赖扫描或安全审计配置。
  - 无 Dependabot/Renovate/Probot 等自动化更新机器人配置。
  - 无 `vendor/` 目录或 `GOFLAGS=-mod=vendor` 标志。
  - 无 `.npmrc`/`.npmrc.local` 等私有 npm registry 配置。
  - 无 `go.work` 多模块工作区（Go 部分只有单一 `go.mod`）。