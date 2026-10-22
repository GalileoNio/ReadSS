package transcribe

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"reads/internal/model"
)

type whisperModelSpec struct {
	ID          string
	Name        string
	Description string
	Filename    string
	Size        int64
	SHA256      string
}

var whisperModelCatalog = []whisperModelSpec{
	{
		ID: "base-q5_1", Name: "均衡 · Base", Description: "内置推荐，低功耗设备优先",
		Filename: "ggml-base-q5_1.bin", Size: 59707625,
		SHA256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
	},
	{
		ID: "small-q5_1", Name: "准确 · Small", Description: "中文准确度更高，速度适中",
		Filename: "ggml-small-q5_1.bin", Size: 190085487,
		SHA256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
	},
	{
		ID: "medium-q5_0", Name: "高精度 · Medium", Description: "适合性能较强的电脑",
		Filename: "ggml-medium-q5_0.bin", Size: 539212467,
		SHA256: "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f",
	},
	{
		ID: "large-v3-turbo-q5_0", Name: "最高精度 · Turbo", Description: "资源占用最高，长节目更慢",
		Filename: "ggml-large-v3-turbo-q5_0.bin", Size: 574041195,
		SHA256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
	},
}

func WhisperModels(dataDir string, cfg model.TranscribeConfig) []model.WhisperModel {
	eng := Detect(dataDir, cfg)
	active := cleanPath(eng.Resolved.WhisperModel)
	bundledModels := filepath.Join(bundledDir(), "models")
	userModels := filepath.Join(Dir(dataDir), "models")
	models := make([]model.WhisperModel, 0, len(whisperModelCatalog))
	for _, spec := range whisperModelCatalog {
		bundledPath := filepath.Join(bundledModels, spec.Filename)
		userPath := filepath.Join(userModels, spec.Filename)
		path := ""
		bundled := validModelFile(bundledPath, spec)
		if bundled {
			path = bundledPath
		} else if validModelFile(userPath, spec) {
			path = userPath
		}
		models = append(models, model.WhisperModel{
			ID: spec.ID, Name: spec.Name, Description: spec.Description,
			Filename: spec.Filename, Size: spec.Size, Installed: path != "",
			Active: path != "" && cleanPath(path) == active, Bundled: bundled,
		})
	}
	return models
}

func InstalledWhisperModel(dataDir, id string) (string, error) {
	spec, ok := whisperModelByID(id)
	if !ok {
		return "", errors.New("未知的 Whisper 模型")
	}
	for _, path := range []string{
		filepath.Join(bundledDir(), "models", spec.Filename),
		filepath.Join(Dir(dataDir), "models", spec.Filename),
	} {
		if validModelFile(path, spec) {
			return path, nil
		}
	}
	return "", errors.New("模型尚未下载")
}

func DownloadWhisperModel(ctx context.Context, dataDir, id string, progress func(downloaded, total int64)) (string, error) {
	spec, ok := whisperModelByID(id)
	if !ok || id == "base-q5_1" {
		return "", errors.New("未知或无需下载的 Whisper 模型")
	}
	if path, err := InstalledWhisperModel(dataDir, id); err == nil {
		return path, nil
	}

	dir := filepath.Join(Dir(dataDir), "models")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	destination := filepath.Join(dir, spec.Filename)
	partial := destination + ".part"
	_ = os.Remove(partial)
	defer os.Remove(partial)

	urls := []string{
		"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/" + spec.Filename,
		"https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/" + spec.Filename,
	}
	var lastErr error
	for _, url := range urls {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		if err := downloadModelFile(ctx, url, partial, spec, progress); err != nil {
			lastErr = err
			_ = os.Remove(partial)
			continue
		}
		if err := os.Rename(partial, destination); err != nil {
			return "", err
		}
		return destination, nil
	}
	return "", fmt.Errorf("模型下载失败：%w", lastErr)
}

func downloadModelFile(ctx context.Context, url, destination string, spec whisperModelSpec, progress func(downloaded, total int64)) error {
	client := &http.Client{
		Transport: &http.Transport{
			Proxy:               http.ProxyFromEnvironment,
			DialContext:         (&net.Dialer{Timeout: 20 * time.Second}).DialContext,
			TLSHandshakeTimeout: 20 * time.Second,
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("服务器返回 %d", resp.StatusCode)
	}
	if resp.ContentLength > 0 && resp.ContentLength != spec.Size {
		return errors.New("模型文件大小不符")
	}

	file, err := os.Create(destination)
	if err != nil {
		return err
	}
	hash := sha256.New()
	writer := io.MultiWriter(file, hash)
	var downloaded int64
	buffer := make([]byte, 256<<10)
	lastReport := time.Now()
	for {
		n, readErr := resp.Body.Read(buffer)
		if n > 0 {
			if downloaded+int64(n) > spec.Size {
				file.Close()
				return errors.New("模型文件超过预期大小")
			}
			if _, err := writer.Write(buffer[:n]); err != nil {
				file.Close()
				return err
			}
			downloaded += int64(n)
			if time.Since(lastReport) >= 250*time.Millisecond {
				progress(downloaded, spec.Size)
				lastReport = time.Now()
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			file.Close()
			return readErr
		}
	}
	if err := file.Close(); err != nil {
		return err
	}
	if downloaded != spec.Size || hex.EncodeToString(hash.Sum(nil)) != spec.SHA256 {
		return errors.New("模型校验失败")
	}
	progress(downloaded, spec.Size)
	return nil
}

func whisperModelByID(id string) (whisperModelSpec, bool) {
	for _, spec := range whisperModelCatalog {
		if spec.ID == id {
			return spec, true
		}
	}
	return whisperModelSpec{}, false
}

func validModelFile(path string, spec whisperModelSpec) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Size() == spec.Size
}

func cleanPath(path string) string {
	path, _ = filepath.Abs(path)
	path = filepath.Clean(path)
	if runtime.GOOS == "windows" {
		path = strings.ToLower(path)
	}
	return path
}
