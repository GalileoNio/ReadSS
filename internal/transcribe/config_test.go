package transcribe

import (
	"os"
	"path/filepath"
	"testing"
)

func TestScanRootsPrefersEarlierCompleteRuntime(t *testing.T) {
	bundled := t.TempDir()
	user := t.TempDir()
	for _, path := range []string{
		filepath.Join(bundled, exeName("ffmpeg")),
		filepath.Join(bundled, exeName("whisper-cli")),
		filepath.Join(bundled, "ggml-small-q5_1.bin"),
		filepath.Join(user, exeName("ffmpeg")),
		filepath.Join(user, "ggml-large-v3.bin"),
	} {
		if err := os.WriteFile(path, []byte("test"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	found := scanRoots(bundled, user)
	if found.ffmpeg != filepath.Join(bundled, exeName("ffmpeg")) {
		t.Fatalf("ffmpeg = %q", found.ffmpeg)
	}
	if model := bestWhisperModel(found.whisperModels); model != filepath.Join(bundled, "ggml-small-q5_1.bin") {
		t.Fatalf("model = %q", model)
	}
}

func TestScanRootsFillsMissingComponents(t *testing.T) {
	bundled := t.TempDir()
	user := t.TempDir()
	whisper := filepath.Join(bundled, exeName("whisper-cli"))
	ffmpeg := filepath.Join(user, exeName("ffmpeg"))
	for _, path := range []string{whisper, ffmpeg} {
		if err := os.WriteFile(path, []byte("test"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	found := scanRoots(bundled, user)
	if found.whisper != whisper || found.ffmpeg != ffmpeg {
		t.Fatalf("whisper = %q, ffmpeg = %q", found.whisper, found.ffmpeg)
	}
}

func TestPickFallsBackFromMissingConfiguredPath(t *testing.T) {
	bundled := filepath.Join(t.TempDir(), exeName("ffmpeg"))
	if got := pick(filepath.Join(t.TempDir(), "missing.exe"), bundled, "on-path"); got != bundled {
		t.Fatalf("pick = %q", got)
	}
}
