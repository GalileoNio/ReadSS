## 1. 使用的系统与框架

- 后端使用 Go 标准库 `log/slog`（结构化日志），未引入第三方日志库。
- 通过 Wails v3 的 `application.Options.Logger` 和 `LogLevel` 字段把应用级日志接入 Wails 自身的系统日志通道；同时前端也通过 Wails 的 logger 暴露进行诊断输出。
- 无自定义 sink、无 JSON 格式化器，统一使用 `slog.NewTextHandler` 文本格式。

## 2. 关键文件

- `main.go`：日志初始化、级别控制、Wails 集成点、CLI 错误输出。
- `internal/service/service.go`：业务 Service 持有 `*slog.Logger`，通过 `SetLogger` 注入并转发到 `feed.Fetcher`。
- `internal/feed/fetcher.go`：网络层日志，提供 `SetLogger` + `logf` 包装（nil-safe）。其它 feed/ service/ transcribe 子包依赖上述注入。

## 3. 架构与约定

### 3.1 日志初始化流程（`main.go`）

```text
newLogger(dataDir)
 ├─ 创建 dataDir（不存在则 MkdirAll）
 ├─ 尝试打开 dataDir/reads.log（CREATE|APPEND|WRONLY, 0644）
 │   └─ 失败 → 回退到 os.Stderr
 └─ slog.New(slog.NewTextHandler(file_or_stderr, opts))
```

- GUI 模式：日志写入 `<data-dir>/reads.log`。
- CLI / headless 模式（如 `--selftest`、`--subscribe` 等子命令）：由于没有控制台窗口，日志同样落盘到 `reads.log`；若数据目录不可写则回退到 `os.Stderr`。
- Wails 应用启动时，同一 logger 实例同时传给 `application.Options.Logger`，从而让 Wails 内部日志（绑定调用、资源请求等）也进入同一个文件。

### 3.2 日志级别策略

- 默认级别：`slog.LevelInfo`。
- 环境变量 `READS_LOG_LEVEL=debug` 时提升到 `slog.LevelDebug`。注释明确说明这是用于诊断绑定名称问题（"binding-name problems are diagnosed"）。
- 该变量名被直接读取为 `logLevel()` 返回给 Wails，因此它也控制 Wails 自身日志的 verbosity。

### 3.3 注入式日志传播

- `service.Service` 在 `New` 中用 `slog.New(slog.NewTextHandler(io.Discard, nil))` 初始化空实现，避免零指针；之后由 `SetLogger` 替换。
- `Service.SetLogger` 不仅替换自身字段，还调用 `s.fetcher.SetLogger(logger)`，将同一 logger 传播到 HTTP 抓取层。
- `Fetcher.SetLogger` 设置内部 `*slog.Logger`，所有网络日志通过 `logf` 包装方法发出，该方法在 logger 为 nil 时静默跳过，使组件在无注入场景下仍可工作。

### 3.4 结构化字段

日志采用 `slog.KeyValue` 风格字段，常见键包括：

- `err`：错误对象（`Error`/`Warn` 级别）。
- `url`：请求目标。
- `attempt`：重试次数。
- `status`：HTTP 状态码。
- `feeds`、`updated`、`new`、`failed`：刷新统计。
- `base`：图片代理 base URL。

未发现统一的 trace ID / request ID 字段。

### 3.5 级别使用约定（经验观察）

- `Info`：启动/停止、刷新开始/结束、图片代理监听等生命周期事件。
- `Warn`：可恢复异常（startup refresh failed、image proxy unavailable）。
- `Error`：致命错误（application error handler、fatal 包装）。
- `Debug`：fetcher 的网络探测、重试、评论 API 发现等诊断信息。

## 4. 约定与约束

- **日志输出位置**：GUI 模式下写入 `<data-dir>/reads.log`；CLI/headless 模式同样优先落盘，不可写时回退 `os.Stderr`（见 `main.go:newLogger` 的两处 fallback）。
- **日志级别开关**：仅支持通过环境变量 `READS_LOG_LEVEL=debug` 切换 debug；其他值或 unset 均为 info（见 `main.go:logLevel`）。
- **Wails 集成**：应用级 logger 必须通过 `application.Options.Logger` 传入，才能把 Wails 内部日志也纳入 `reads.log`（`main.go` 构造 application 时即传入）。
- **业务组件日志注入**：`service.Service` 通过 `SetLogger` 暴露 setter，子组件（如 `feed.Fetcher`）通过同名 setter 接收；新建的 Service 以 discard logger 初始化以保证 nil-safe（`internal/service/service.go:New`）。
- **CLI 错误输出**：非结构化错误统一走 `fatal(what, err)`，输出 `ReadS: <what>: <err>` 到 stderr 并 `os.Exit(1)`（`main.go`）。
- **前端侧**：React 前端通过 Wails 的 logger 接口调用日志，但未见本地文件 sink；主要用于开发期诊断。

## 5. 不适用项

- 无第三方日志库（未出现 zap、zerolog、logrus、sugar 等）。
- 无 JSON 输出、无轮转、无多 sink 路由、无采样、无结构化 schema 定义。
- 无单元测试覆盖日志行为（搜索范围有限，未在测试文件中观察到断言日志输出的用例）。