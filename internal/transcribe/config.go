package transcribe

import (
	"encoding/json"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"reads/internal/model"
)

const configFile = "transcribe.json"

// Dir is where the reader drops the local engine's programs and models; it is
// searched recursively, so unpacked release archives work as they are.
func Dir(dataDir string) string { return filepath.Join(dataDir, "asr") }

// LoadConfig reads the saved engine settings, with defaults filled in.
func LoadConfig(dataDir string) model.TranscribeConfig {
	var cfg model.TranscribeConfig
	if data, err := os.ReadFile(filepath.Join(dataDir, configFile)); err == nil {
		_ = json.Unmarshal(data, &cfg)
	}
	return withDefaults(cfg)
}

// SaveConfig stores the engine settings next to the database.
func SaveConfig(dataDir string, cfg model.TranscribeConfig) error {
	cfg = withDefaults(cfg)
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dataDir, configFile), data, 0o644)
}

func withDefaults(cfg model.TranscribeConfig) model.TranscribeConfig {
	cfg.Language = strings.TrimSpace(cfg.Language)
	if cfg.Language == "" {
		cfg.Language = "auto"
	}
	if cfg.Speakers < 0 || cfg.Speakers > 20 {
		cfg.Speakers = 0
	}
	if cfg.Threads <= 0 {
		cfg.Threads = min(max(runtime.NumCPU()-1, 1), 8)
	}
	for _, p := range []*string{&cfg.FFmpeg, &cfg.Whisper, &cfg.WhisperModel, &cfg.Diarizer, &cfg.SegmentationModel, &cfg.EmbeddingModel} {
		*p = strings.Trim(strings.TrimSpace(*p), `"`)
	}
	return cfg
}

// Detect resolves every tool and model: an explicit path wins when it exists,
// otherwise the engine folder is searched, and programs fall back to PATH.
func Detect(dataDir string, cfg model.TranscribeConfig) model.TranscribeEngine {
	dir := Dir(dataDir)
	_ = os.MkdirAll(dir, 0o755)
	found := scan(dir)

	res := cfg
	res.FFmpeg = pick(cfg.FFmpeg, found.ffmpeg, exe("ffmpeg"))
	res.Whisper = pick(cfg.Whisper, found.whisper, exe("whisper-cli"))
	res.WhisperModel = pick(cfg.WhisperModel, bestWhisperModel(found.whisperModels), "")
	res.Diarizer = pick(cfg.Diarizer, found.diarizer, exe("sherpa-onnx-offline-speaker-diarization"))
	res.SegmentationModel = pick(cfg.SegmentationModel, first(found.segmentation), "")
	res.EmbeddingModel = pick(cfg.EmbeddingModel, first(found.embedding), "")

	var missing []string
	if res.FFmpeg == "" {
		missing = append(missing, "ffmpeg")
	}
	if res.Whisper == "" {
		missing = append(missing, "whisper-cli（whisper.cpp）")
	}
	if res.WhisperModel == "" {
		missing = append(missing, "Whisper 模型（ggml-*.bin）")
	}
	return model.TranscribeEngine{
		Dir:        dir,
		Config:     cfg,
		Resolved:   res,
		Ready:      len(missing) == 0,
		CanDiarize: res.Diarizer != "" && res.SegmentationModel != "" && res.EmbeddingModel != "",
		Missing:    missing,
	}
}

type scanResult struct {
	ffmpeg, whisper, diarizer string
	whisperModels             []string
	segmentation, embedding   []string
}

func scan(root string) scanResult {
	var r scanResult
	visited := 0
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			rel, _ := filepath.Rel(root, path)
			if rel != "." && strings.Count(rel, string(filepath.Separator)) >= 4 {
				return filepath.SkipDir
			}
			return nil
		}
		if visited++; visited > 20000 {
			return filepath.SkipAll
		}
		name := strings.ToLower(d.Name())
		lowerPath := strings.ToLower(filepath.ToSlash(path))
		switch {
		case name == exeName("ffmpeg"):
			r.ffmpeg = path
		case name == exeName("whisper-cli"):
			r.whisper = path
		case name == exeName("sherpa-onnx-offline-speaker-diarization"):
			r.diarizer = path
		case strings.HasPrefix(name, "ggml-") && strings.HasSuffix(name, ".bin") && !strings.Contains(name, "silero"):
			r.whisperModels = append(r.whisperModels, path)
		case strings.HasSuffix(name, ".onnx") && strings.Contains(lowerPath, "segmentation"):
			r.segmentation = append(r.segmentation, path)
		case strings.HasSuffix(name, ".onnx") && isEmbeddingModel(name):
			r.embedding = append(r.embedding, path)
		}
		return nil
	})
	// Full-precision models first; int8 variants are the fallback.
	sort.SliceStable(r.segmentation, func(i, j int) bool {
		return !strings.Contains(strings.ToLower(r.segmentation[i]), "int8") &&
			strings.Contains(strings.ToLower(r.segmentation[j]), "int8")
	})
	return r
}

func isEmbeddingModel(name string) bool {
	for _, k := range []string{"speaker", "eres2net", "campplus", "wespeaker", "titanet", "3dspeaker", "speakernet"} {
		if strings.Contains(name, k) {
			return true
		}
	}
	return false
}

// bestWhisperModel prefers the most accurate model the reader downloaded.
func bestWhisperModel(paths []string) string {
	order := []string{"large-v3-turbo", "large-v3", "large-v2", "large", "medium", "small", "base", "tiny"}
	best, bestRank := "", len(order)+1
	for _, p := range paths {
		name := strings.ToLower(filepath.Base(p))
		rank := len(order)
		for i, k := range order {
			if strings.Contains(name, k) {
				rank = i
				break
			}
		}
		if strings.Contains(name, ".en") {
			rank += len(order) // English-only models are a poor default
		}
		if rank < bestRank {
			best, bestRank = p, rank
		}
	}
	return best
}

func pick(explicit, found, onPath string) string {
	if explicit != "" {
		if st, err := os.Stat(explicit); err == nil && !st.IsDir() {
			return explicit
		}
		if p, err := exec.LookPath(explicit); err == nil {
			return p
		}
		return ""
	}
	if found != "" {
		return found
	}
	return onPath
}

func first(list []string) string {
	if len(list) == 0 {
		return ""
	}
	return list[0]
}

func exeName(base string) string {
	if runtime.GOOS == "windows" {
		return base + ".exe"
	}
	return base
}

func exe(base string) string {
	p, err := exec.LookPath(base)
	if err != nil {
		return ""
	}
	return p
}
