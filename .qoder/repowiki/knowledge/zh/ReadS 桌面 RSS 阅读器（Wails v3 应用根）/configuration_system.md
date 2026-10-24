## 概述

ReadS 是一个基于 Wails v3 的桌面应用，其“配置”由三个层次组成：
- **构建期配置**：`wails.json`（Wails 自身配置）。
- **启动期配置**：Go `flag` 解析的命令行参数与 `os.Getenv` 读取的环境变量。
- **运行时持久化配置**：位于数据目录下的 `transcribe.json`（JSON），用于本地语音转写引擎的设置。

仓库内没有统一的配置框架（如 Viper、YAML/TOML 全局配置），也没有 `.env` 文件或 feature flag 机制；每个子系统各自负责自己的配置加载。

## 关键文件

| 文件 | 作用 |
|---|---|
| `wails.json` | Wails 应用元信息、前端脚本、产品名/版本等构建配置 |
| `main.go` | 命令行标志解析、数据目录定位、日志级别、Wails 应用初始化 |
| `internal/transcribe/config.go` | 本地 ASR 引擎的 `LoadConfig` / `SaveConfig` / `Detect`，读写 `transcribe.json` |
| `internal/transcribe/config_test.go` | 对 `withDefaults` 的测试（覆盖语言默认值、线程数、路径清理） |

## 架构与约定

### 1. Wails 构建配置（`wails.json`）

采用官方 schema `https://wails.io/schemas/config.v2.json`，声明了产品名称 `ReadS`、输出文件名、前端安装/构建命令、作者、`info.productVersion` 等。该文件不参与运行时行为，仅被 Wails CLI 使用。

### 2. 启动期配置：命令行参数 + 环境变量

`main.go` 通过标准库 `flag` 定义无头子命令入口：
- `-data-dir`：覆盖应用数据目录
- `-subscribe`、`-probe`、`-test-comments`、`-fetch-comments`、`-colors`、`-recommend`、`-selftest`、`-version`

环境变量优先级规则在 `resolveDataDir` 中明确实现（注释即规范）：

```
READS_DATA_DIR > -data-dir > 可执行文件旁 appdata/..appdata > OS UserConfigDir/ReadS
```

另外，`logLevel()` 检查 `READS_LOG_LEVEL=debug` 以开启 Wails 调试日志（绑定方法调用、资源请求），其余情况为 `slog.LevelInfo`。

日志写入 `reads.log`（`dataDir/reads.log`），不可写时回退到 `os.Stderr`。

### 3. 运行时持久化配置：`transcribe.json`

`internal/transcribe/config.go` 定义了 ASR（自动语音识别）引擎的用户配置模型（`model.TranscribeConfig`），保存在数据目录下的 `transcribe.json`（常量 `configFile = "transcribe.json"`）。

- `LoadConfig(dataDir)`：读取并填充默认值；文件不存在时返回带默认值的空结构。
- `SaveConfig(dataDir, cfg)`：以 `0o644` 权限写入 `json.MarshalIndent(cfg, "", "  ")`。
- `withDefaults(cfg)`：填充默认值——`Language` 缺省为 `"auto"`；`Speakers` 超出 `[0,20]` 归零；`Threads` 缺省为 `min(max(runtime.NumCPU()-1, 1), 8)`；去除 FFmpeg/Whisper/Diarizer/各模型路径首尾空白和引号。
- `Detect(dataDir, cfg)`：解析出实际可用的工具链，按以下顺序选择每个二进制/模型路径（`pick(explicit, found, onPath)`）：
  1. 显式配置的绝对/相对路径（存在且非目录）→ 使用
  2. PATH 中同名命令 → 使用
  3. 已扫描到的 bundled/user 目录中的匹配项 → 使用
  4. 回退到 `exec.LookPath(base)` 的结果（可能为空）

扫描根目录顺序：`bundledDir()`（可执行文件同级 `asr/`）→ 用户数据目录 `asr/`。`scanRoots` 去重（大小写不敏感，Windows 下全小写 key）。

扫描规则（`scan`）：
- 递归但限制深度 ≥ 4 层直接跳过
- 最多遍历 20000 个条目后停止
- 二进制名：`ffmpeg`、`whisper-cli`、`sherpa-onnx-offline-speaker-diarization`（Windows 自动加 `.exe`）
- Whisper 模型：`ggml-*.bin`，排除含 `silero` 的文件
- Segmentation 模型：`.onnx` 且路径含 `segmentation`
- Embedding 模型：`.onnx` 且文件名包含 `speaker`/`eres2net`/`campplus`/`wespeaker`/`titanet`/`3dspeaker`/`speakernet` 之一

`bestWhisperModel` 按固定质量排名选择：`large-v3-turbo > large-v3 > large-v2 > large > medium > small > base > tiny`，含 `.en` 的英文专用模型降级处理。

最终 `TranscribeEngine.Ready` 为 true 当且仅当 ffmpeg、whisper、whisper model 三者均不为空；`CanDiarize` 还需要 diarizer + segmentation + embedding。

## 约定与约束

1. **应用数据目录唯一来源**：所有运行时产物（`reads.db`、`webview/`、`asr/`、`reads.log`、`transcribe.json`）都位于 `resolveDataDir` 返回的同一目录下，使应用“完全自包含且易于重置”。
2. **配置优先级**：`READS_DATA_DIR` 环境变量始终优先于 `-data-dir` 标志，再由便携式布局或 OS 配置目录兜底（`main.go` 中 `resolveDataDir` 的注释即规范）。
3. **日志级别开关**：仅支持 `READS_LOG_LEVEL=debug` 打开 debug，其他值视为 info（`main.go` 中 `logLevel`）。
4. **ASR 配置格式**：`transcribe.json` 是纯 JSON，字段包括 `Language`、`Speakers`、`Threads`、`FFmpeg`、`Whisper`、`WhisperModel`、`Diarizer`、`SegmentationModel`、`EmbeddingModel`；缺失字段由 `withDefaults` 补全（`internal/transcribe/config.go`）。
5. **ASR 二进制发现顺序**：显式路径 → PATH → bundled `asr/` → 用户 `asr/` → PATH fallback（`internal/transcribe/config.go` 中 `pick` / `Detect`）。
6. **Wails 前端缓存策略**：`/index.html` 强制 `no-store, must-revalidate`，以避免 WebView2 缓存旧构建壳（`main.go` 中 `noStoreIndexHTML`）。
7. **WebView 用户数据位置**：`WebviewUserDataPath` 指向 `dataDir/webview`，与数据库同目录（`main.go`）。

## 未实现的部分

- 没有全局 YAML/TOML/INI 配置文件。
- 没有 `.env` 文件加载。
- 没有运行时 feature flag 系统。
- 没有 secrets 管理（外部二进制路径作为字符串存储，未做加密）。