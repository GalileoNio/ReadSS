// Command ReadS is a Folo-inspired RSS reader.
//
// It is a Wails v3 desktop application: a Go backend exposing a bound service
// and a React frontend embedded into the binary.
package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"reads/internal/feed"
	"reads/internal/imgproxy"
	"reads/internal/service"
	"reads/internal/store"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const version = "1.0.0"

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	showVersion := flag.Bool("version", false, "print the version and exit")
	selfTest := flag.Bool("selftest", false, "run headless backend checks and exit")
	dataDirFlag := flag.String("data-dir", "", "override the application data directory")
	subscribeFlag := flag.String("subscribe", "", "comma-separated feed URLs to subscribe to, then exit")
	probeFlag := flag.String("probe", "", "exercise icon/full-text/comments against a live site, then exit")
	testCommentsFlag := flag.String("test-comments", "", "run the comment extractor over a saved HTML file, then exit")
	fetchCommentsFlag := flag.Int64("fetch-comments", 0, "fetch and store comments for an entry id, then exit")
	recommendFlag := flag.Bool("recommend", false, "print recommended articles and subscriptions, then exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("ReadS %s\n", version)
		return
	}

	dataDir, err := resolveDataDir(*dataDirFlag)
	if err != nil {
		fatal("resolve data directory", err)
	}

	// Logging goes to a file in the data directory: a windowed app has no
	// console, so stderr would otherwise be discarded.
	logger := newLogger(dataDir)

	if *subscribeFlag != "" {
		if err := runSubscribe(dataDir, strings.Split(*subscribeFlag, ",")); err != nil {
			fmt.Fprintln(os.Stderr, "subscribe failed:", err)
			os.Exit(1)
		}
		return
	}

	if *probeFlag != "" {
		if err := runProbe(dataDir, *probeFlag); err != nil {
			fmt.Fprintln(os.Stderr, "probe failed:", err)
			os.Exit(1)
		}
		return
	}

	if *testCommentsFlag != "" {
		if err := runTestComments(dataDir, *testCommentsFlag); err != nil {
			fmt.Fprintln(os.Stderr, "test-comments failed:", err)
			os.Exit(1)
		}
		return
	}

	if *fetchCommentsFlag > 0 {
		if err := runFetchComments(dataDir, *fetchCommentsFlag); err != nil {
			fmt.Fprintln(os.Stderr, "fetch-comments failed:", err)
			os.Exit(1)
		}
		return
	}

	if *recommendFlag {
		if err := runRecommend(dataDir); err != nil {
			fmt.Fprintln(os.Stderr, "recommend failed:", err)
			os.Exit(1)
		}
		return
	}

	if *selfTest {
		if err := runSelfTest(dataDir); err != nil {
			fmt.Fprintln(os.Stderr, "SELFTEST FAILED:", err)
			os.Exit(1)
		}
		fmt.Println("SELFTEST OK")
		return
	}

	st, err := store.Open(filepath.Join(dataDir, "reads.db"))
	if err != nil {
		fatal("open database", err)
	}

	// After an update, drop WebView2's cached copy of the previous build's
	// assets. Without this the embedded index.html can be served from cache and
	// the app silently keeps running the old frontend.
	if updated, err := st.EnsureBuildVersion(version); err == nil && updated {
		purgeWebviewCache(dataDir, logger)
	}

	svc := service.New(st, dataDir, version)
	svc.SetLogger(logger)

	// Serve hotlink-protected article images ourselves: a WebView cannot set
	// the Referer that those CDNs require, so the app fetches them instead.
	// See internal/imgproxy.
	if proxy, err := imgproxy.Start(); err != nil {
		logger.Warn("image proxy unavailable, article images may not load", "err", err)
	} else {
		svc.SetImageProxy(proxy)
		logger.Info("image proxy listening", "base", proxy.Base())
		defer proxy.Close()
	}

	app := application.New(application.Options{
		Name:        "ReadS",
		Description: "A Folo-inspired RSS reader",
		Services:    []application.Service{application.NewService(svc)},
		Assets: application.AssetOptions{
			Handler:    application.BundledAssetFileServer(assets),
			Middleware: noStoreIndexHTML,
		},
		Windows: application.WindowsOptions{
			// Keep the WebView2 profile beside the database so the app is
			// fully self-contained and easy to reset.
			WebviewUserDataPath: filepath.Join(dataDir, "webview"),
		},
		Logger:   logger,
		LogLevel: logLevel(),
		ErrorHandler: func(err error) {
			logger.Error("application error", "err", err)
		},
	})
	svc.Attach(app)

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:   "main",
		Title:  "ReadS",
		Width:  1440,
		Height: 900,
		// Small enough to check the phone layout (list ⇄ reader at <768px) and
		// the tablet layout by resizing, while still above the narrowest layout
		// the app is designed for.
		MinWidth:         360,
		MinHeight:        520,
		URL:              "/",
		BackgroundColour: application.NewRGB(18, 18, 18),
	})

	if err := app.Run(); err != nil {
		fatal("run application", err)
	}
}

// noStoreIndexHTML marks the app shell as uncacheable.
//
// index.html is the one asset whose name never changes, and it is what points
// at the hashed JS/CSS bundles. Letting WebView2 cache it means an updated
// build can keep loading the previous bundle from the HTTP cache. The bundles
// themselves keep their default caching, since their names change per build.
func noStoreIndexHTML(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, "/index.html") {
			w.Header().Set("Cache-Control", "no-store, must-revalidate")
			w.Header().Set("Pragma", "no-cache")
		}
		next.ServeHTTP(w, r)
	})
}

// purgeWebviewCache deletes WebView2's HTTP and code caches, keeping the rest
// of the profile (local storage, permissions) intact.
func purgeWebviewCache(dataDir string, logger *slog.Logger) {
	for _, sub := range []string{
		filepath.Join("EBWebView", "Default", "Cache"),
		filepath.Join("EBWebView", "Default", "Code Cache"),
		filepath.Join("EBWebView", "Default", "Service Worker", "CacheStorage"),
	} {
		target := filepath.Join(dataDir, "webview", sub)
		if err := os.RemoveAll(target); err != nil {
			logger.Warn("could not purge webview cache", "path", target, "err", err)
			continue
		}
		logger.Info("purged webview cache after update", "path", target)
	}
}

// resolveDataDir decides where the database and WebView profile live.
//
// READS_DATA_DIR takes precedence, then -data-dir, then the OS config dir.
func resolveDataDir(flagValue string) (string, error) {
	if env := os.Getenv("READS_DATA_DIR"); env != "" {
		return filepath.Abs(env)
	}
	if flagValue != "" {
		return filepath.Abs(flagValue)
	}
	// Portable layout: a build placed next to its data folder uses it, so a
	// desktop shortcut can start the app with no environment variable set and
	// still open the developer's library (build/bin/ReadS.exe → build/appdata).
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		for _, candidate := range []string{
			filepath.Join(dir, "..", "appdata"),
			filepath.Join(dir, "appdata"),
		} {
			if info, err := os.Stat(candidate); err == nil && info.IsDir() {
				return filepath.Abs(candidate)
			}
		}
	}
	base, err := os.UserConfigDir()
	if err != nil {
		home, herr := os.UserHomeDir()
		if herr != nil {
			return "", err
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "ReadS"), nil
}

// logLevel returns the Wails system log level. READS_LOG_LEVEL=debug turns on
// verbose Wails logging (bound-method calls and asset requests), which is how
// binding-name problems are diagnosed.
func logLevel() slog.Level {
	if strings.EqualFold(os.Getenv("READS_LOG_LEVEL"), "debug") {
		return slog.LevelDebug
	}
	return slog.LevelInfo
}

func newLogger(dataDir string) *slog.Logger {
	opts := &slog.HandlerOptions{Level: logLevel()}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return slog.New(slog.NewTextHandler(os.Stderr, opts))
	}
	f, err := os.OpenFile(filepath.Join(dataDir, "reads.log"),
		os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return slog.New(slog.NewTextHandler(os.Stderr, opts))
	}
	return slog.New(slog.NewTextHandler(f, opts))
}

func fatal(what string, err error) {
	fmt.Fprintf(os.Stderr, "ReadS: %s: %v\n", what, err)
	os.Exit(1)
}

// runSelfTest exercises the backend end to end without opening a window or
// touching the network, so it can run in CI or a headless shell.
func runSelfTest(dataDir string) error {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}
	dbPath := filepath.Join(dataDir, "selftest.db")
	_ = os.Remove(dbPath)
	_ = os.Remove(dbPath + "-wal")
	_ = os.Remove(dbPath + "-shm")

	st, err := store.Open(dbPath)
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	defer st.Close()

	svc := service.New(st, dataDir, version)
	started := time.Now()
	if err := svc.ServiceStartup(context.Background(), application.ServiceOptions{}); err != nil {
		return fmt.Errorf("service startup: %w", err)
	}

	if err := selftestStore(st); err != nil {
		return err
	}
	if err := selftestService(svc, st); err != nil {
		return err
	}
	if err := feed.SelfTestCommentEngine(); err != nil {
		return err
	}
	if err := feed.SelfTestDiscovery(); err != nil {
		return err
	}
	if err := feed.SelfTestRecommend(); err != nil {
		return err
	}

	fmt.Printf("selftest finished in %s\n", time.Since(started).Round(time.Millisecond))
	return nil
}

// runRecommend prints what the discover pane would show, so the ranking and the
// database query can be checked headlessly against the real library.
func runRecommend(dataDir string) error {
	st, err := store.Open(filepath.Join(dataDir, "reads.db"))
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	defer st.Close()

	seeds, candidates, err := st.RecommendationData(400, 1200)
	if err != nil {
		return fmt.Errorf("recommendation data: %w", err)
	}
	ranked := feed.RankEntries(seeds, candidates)
	fmt.Printf("history=%d unread=%d ranked=%d\n", len(seeds), len(candidates), len(ranked))
	for i, e := range ranked {
		if i >= 8 {
			break
		}
		fmt.Printf("  #%d [%s] %s\n", i+1, e.Author, e.Title)
	}

	feeds, err := st.Feeds()
	if err != nil {
		return fmt.Errorf("feeds: %w", err)
	}
	interest := make([]string, 0, len(feeds)*2+len(seeds)*2)
	subscribed := make([]string, 0, len(feeds)*2)
	for _, f := range feeds {
		interest = append(interest, f.Title, f.Description)
		subscribed = append(subscribed, f.URL, f.SiteURL)
	}
	for _, e := range seeds {
		interest = append(interest, e.Title, e.Summary)
	}
	suggestions := feed.RankFeeds(interest, subscribed, feed.Catalog)
	fmt.Printf("subscriptions=%d suggestions=%d\n", len(feeds), len(suggestions))
	for i, s := range suggestions {
		if i >= 8 {
			break
		}
		fmt.Printf("  * %s (%s) score=%d tags=%v\n", s.Title, s.URL, s.Score, s.Tags)
	}
	return nil
}
