## 1. 使用的系统与工具

ReadS 采用 **Wails v3** 作为 Go 后端与 React 前端之间的桥接框架，把两者装配成一个 Windows 桌面应用。构建链路分为前后端两段：

- 前端：Vite + TypeScript + React + TailwindCSS，通过 `frontend/package.json` 的脚本编排。
- 后端：Go（module `reads`，Go 1.26.8），使用 Wails 的绑定机制暴露方法给前端。
- 打包器：Wails CLI（由 `wails.json` 驱动）负责调用前端的安装/构建命令并把产物嵌入 Go 二进制。
- 构建入口：PowerShell 脚本 `scripts/build.ps1`，统一串联前端构建、绑定校验、icon 检查、go vet、双二进制编译以及 ASR 运行时准备。

没有 Makefile / Dockerfile / CI 配置；该仓库是单平台（Windows x64）桌面应用项目，未见跨平台或容器化配置。

## 2. 关键文件

| 文件 | 作用 |
|---|---|
| `wails.json` | Wails 工程元数据：产品名称、版本号 `1.0.0`、前端安装/构建命令指向 pnpm |
| `scripts/build.ps1` | 主构建脚本：前端构建 → 绑定检查 → icon 检查 → gofmt/go vet → 双二进制输出 |
| `scripts/check-bindings.mjs` | 在构建时扫描 `internal/service/*.go` 和 `frontend/src/lib/api.ts`，确保前端调用的 Wails 方法与 Go 导出方法名精确匹配（区分大小写） |
| `scripts/check-icons.mjs` | 对照 `DESIGN.md §7` 校验图标使用（由 `build.ps1` 触发） |
| `scripts/prepare-asr.ps1` | 下载并组装本地语音转文本运行时（whisper.cpp、FFmpeg、sherpa-onnx、模型与许可证） |
| `frontend/vite.config.ts` | Vite 配置：React 插件、`@` 别名、`outDir: 'dist'`、开发服务器端口 `34115` |
| `frontend/package.json` | 前端脚本：`dev` / `build` / `preview`，依赖版本锁定到 `pnpm-lock.yaml` |
| `go.mod` | Go module 定义，固定 `wailsapp/wails/v3 v3.0.0-beta.27` 等依赖 |

## 3. 架构与约定

### 3.1 构建流水线

`scripts/build.ps1` 的执行顺序为：

1. 进入 `frontend/` 目录执行 `pnpm run build`（先跑 `tsc --noEmit` 再 `vite build`），将静态资源产出到 `frontend/dist`。
2. 运行 `scripts/check-bindings.mjs`，校验前端对 Wails 方法的调用名与 `internal/service` 中导出的 `*Service` 方法名完全一致。
3. 运行 `scripts/check-icons.mjs`，按 `DESIGN.md §7` 校验图标语义一致性。
4. 仅对 `main.go`、`selftest.go`、`cli.go` 及 `internal/` 下的 `.go` 文件执行 `gofmt -l`，如有差异则就地重写。
5. 对 `./internal/... .` 执行 `go vet`。
6. 用 `-H windowsgui` 编译 GUI 子系统二进制 `build\bin\ReadS.exe`（双击不弹出控制台窗口，日志写入 `build/appdata/reads.log`）。
7. 同时编译一个控制台子系统副本 `ReadS-cli.exe`（去掉 `-H windowsgui`），用于 `--subscribe` / `--probe` / `--selftest` 等无头子命令。
8. 如未传 `-SkipASR`，调用 `scripts/prepare-asr.ps1` 下载 whisper.cpp、FFmpeg、sherpa-onnx、语音模型与第三方许可证，组装到 `build\bin\asr`。

可选开关：`-SkipWeb`（跳过前端构建）、`-SkipASR`（跳过 ASR 运行时准备）、`-Output <path>`（自定义输出路径）。默认输出 `build\bin\ReadS.exe`。

### 3.2 前端构建

`frontend/package.json` 的 `build` 脚本顺序为 `tsc --noEmit`（两个 tsconfig）→ `vite build`，因此类型错误会阻止 Vite 产出。

`vite.config.ts` 固定开发服务器端口为 `34115`，且 `server.strictPort: true`，避免 Wails dev watcher 因端口占用而启动失败。

Wails 通过 `wails.json` 中的 `frontend:install`、`frontend:build`、`frontend:dev:watcher`、`frontend:dev:serverUrl: auto` 来协调 pnpm 流程。

### 3.3 版本策略

- 应用版本集中在 `wails.json` 的 `info.productVersion: "1.0.0"`。
- 前端 `package.json` 也有 `version: "1.0.0"`，但被标记为 `private`，不与 Go 侧同步。
- Go 依赖通过 `go.mod` 直接 pin commit SHA（例如 `go-readability`、`wails/v3`），而非语义化版本标签。

### 3.4 ASR 运行时预置

`scripts/prepare-asr.ps1` 从多个上游源下载 whisper.cpp v1.9.0、FFmpeg、sherpa-onnx v1.13.8、pyannote 分割模型、3D-Speaker 嵌入模型，并拉取各自的 LICENSE/COPYING 文本，最终生成 `manifest.json`（含 `format`、`architecture: 'windows-x64'`、各组件版本与每个文件的 `sha256`）和 `THIRD_PARTY_NOTICES.txt`。下载缓存位于 `.toolchain\asr\downloads`，解压暂存于 `.toolchain\asr\extract`，目标产物通过临时目录 `.asr-stage-$PID` 原子移动到位。

### 3.5 绑定契约校验

`scripts/check-bindings.mjs` 用正则提取 Go 中 `func (s *Service) Xxx(` 形式的导出方法名，以及前端 `call('Xxx')` / `call<Xxx>('Xxx')` 形式的调用名，二者做集合差集比较。缺失的方法会打印建议的大小写修正并让构建失败；未使用的方法仅信息性输出。

## 4. 约定与约束

- **构建入口单一**：所有可复现的桌面构建都应通过 `pwsh -File scripts/build.ps1` 触发，它显式保证前端先于 Go 嵌入步骤构建完成（见脚本顶部注释）。
- **GUI 与 CLI 双二进制**：同一 Go 包编译出两个产物——`ReadS.exe`（`-H windowsgui`）用于双击启动，`ReadS-cli.exe`（控制台子系统）用于命令行子命令；这是 `build.ps1` 的两段 `go build` 强制约定的产物形态。
- **前端构建必须成功**：`frontend/package.json` 的 `build` 脚本先跑 `tsc --noEmit` 两个 tsconfig，类型错误即中断后续 `vite build`。
- **Wails 绑定名区分大小写**：由 `check-bindings.mjs` 在每次构建时强制执行，错误时退出码非零，使 `build.ps1` 整体失败。
- **Go 代码格式**：`build.ps1` 对 `main.go`、`selftest.go`、`cli.go` 和 `internal/**.go` 执行 `gofmt -l`，发现不一致即自动 `-w` 重写，而不是报错退出；这是一个格式化修复约定，不是 lint 拒绝。
- **Go vet 范围受限**：只检查 `./internal/... .`，不检查 vendor 或 toolchain。
- **ASR 产物不可省略（除非显式跳过）**：默认构建会调用 `prepare-asr.ps1` 下载 whisper.cpp、FFmpeg、sherpa-onnx 及其模型与许可证；`-SkipASR` 是唯一绕过方式。
- **版本来源单一**：Wails 元数据中的 `productVersion` 是 `1.0.0`，未见自动化 bump 逻辑；版本变更需手动编辑 `wails.json`。
- **仅 Windows 目标**：构建脚本全部为 PowerShell，Go 链接参数硬编码 `-H windowsgui`，未见 Linux/macOS 交叉编译入口或 CI 矩阵。
- **无容器化 / CI 配置**：仓库根未发现 `Dockerfile`、`.github/workflows`、`Makefile` 或其他 CI 配置文件；构建过程是本地手工驱动的。
