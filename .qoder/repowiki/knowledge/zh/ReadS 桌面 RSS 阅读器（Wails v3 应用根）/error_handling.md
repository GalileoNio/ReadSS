## 1. 采用的体系

ReadS 是一个基于 Wails v3 的 Go 后端 + React 前端桌面应用。错误处理没有引入第三方 error 库（如 `pkg/errors`、`errorx`），而是遵循 Go 标准库约定：
- 使用 `errors.New` 构造语义化哨兵错误（sentinel errors）。
- 使用 `fmt.Errorf("...: %w", err)` 进行上下文包装与错误链传递。
- 未定义自定义 `Error() string` 类型，也没有统一的错误码枚举或结构化错误体。
- 前端通过 TypeScript 的 `Promise.reject` / `try/catch` 消费 Wails 暴露的 RPC 错误，并转换为 UI 提示。

## 2. 关键文件

- `internal/transcribe/parse.go`：定义两个包级哨兵错误 `ErrUnsupportedFormat`、`ErrNoFeedTranscript`，用于向上游传播“格式不支持”和“节目无自带文稿”两类可判定条件。
- `internal/transcribe/local.go`：本地 Whisper 识别失败时统一返回 `fmt.Errorf("语音识别失败：%w", err)`，并单独用 `errors.New("音频文件过大" | "没有识别出任何语音")` 表达业务约束。
- `internal/feed/bilibili.go`：集中返回 B 站 API 语义错误（限流、风控、412、未登录、找不到用户等），全部为中文消息的 `errors.New`；HTTP 状态码统一走 `fmt.Errorf("服务器返回 %d", status)`。
- `internal/feed/video.go`：YouTube/B 站视频解析错误，同样以中文 `errors.New` 描述无法识别的平台/作者/频道等场景。
- `internal/feed/comments.go`：评论抓取错误统一用 `fmt.Errorf("could not parse the page: %w", err)` 以及 “需要登录 / 没有可获取的评论 / 非有效链接 / 服务器返回 %d” 等消息。
- `internal/opml/opml.go`：OPML 读取失败统一用 `%w` 包装底层错误。
- `main.go`：CLI 入口在 `runSelfTest` 等函数中通过 `fmt.Errorf("xxx: %w", err)` 层层包装 store/service 错误，最终由调用方决定输出。
- `frontend/src/store/*.ts`、`frontend/src/components/*.tsx`：通过 Wails RPC 捕获 Go 端抛出的错误字符串，显示到 Toast / Dialog 中（见 `dialogs.tsx`、`overlays.tsx`、`store/app.ts`）。

## 3. 架构与约定

- **哨兵错误仅用于跨包可判断的条件**：目前只有 `ErrUnsupportedFormat`（transcribe/parse.go）和 `ErrNoFeedTranscript`（transcribe/feed.go）两个包级变量被显式导出，供调用方 `errors.Is` 判断。
- **其余错误一律作为不可比较的 value error 向上传播**：通过 `fmt.Errorf` 携带中文上下文消息，不定义自定义错误类型。
- **错误消息语言**：Go 侧错误消息基本全为中文（例如 `"B 站请求过于频繁，请稍后再试"`、`"无法从 YouTube 页面识别频道 ID"`、`"本机识别引擎未就绪，缺少：%s"`），以便直接透传给前端 UI 展示。
- **HTTP 状态码错误采用统一模板**：多处使用 `fmt.Errorf("服务器返回 %d", resp.StatusCode / status)`，而不是把状态码塞进哨兵错误。
- **无前端的 panic/recover**：仓库内仅在 `internal/feed/commentapi.go` 和 `build/icons/syso-gen/main.go` 两处出现 `panic`/`recover`，均不属于运行时错误路径——前者是测试辅助代码，后者是构建期工具，生产服务代码未发现 panic 恢复策略。
- **Wails 边界**：Go 端函数直接返回 `error`，由 Wails 序列化后在前端 Promise reject 中拿到字符串消息；前端不依赖 Go 错误类型，只消费文本信息。

## 4. 观察到的约定与约束

- 业务可判定的错误优先使用包级 `var ErrXxx = errors.New(...)` 哨兵错误（当前仅限 transcribe 包）。
- 所有错误链使用 `%w` 包装而非 `%v`/`%+v`，保证 `errors.Is` 语义可用。
- 面向用户的错误消息使用中文；内部调试信息保留英文（如 `"could not parse the page"`、`"rankentries: got %d of %d"`）。
- HTTP 层错误统一以 `"服务器返回 %d"` 模板呈现状态码，便于上层区分网络异常与业务错误。
- 没有在中间件或全局钩子中拦截错误——错误沿调用栈逐层冒泡至 CLI/Wails 入口后由调用方决定日志记录或 UI 展示方式。
- 未见仓库级 lint/CI 规则强制这些约定（搜索未发现 golangci-lint 配置中对错误相关规则的启用），因此这是团队约定而非硬性约束。