package transcribe

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestDownloadModelFileVerifiesContent(t *testing.T) {
	content := []byte("model-data")
	sum := sha256.Sum256(content)
	spec := whisperModelSpec{Size: int64(len(content)), SHA256: hex.EncodeToString(sum[:])}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(content)
	}))
	defer server.Close()

	destination := filepath.Join(t.TempDir(), "model.bin")
	if err := downloadModelFile(context.Background(), server.URL, destination, spec, func(int64, int64) {}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != string(content) {
		t.Fatalf("downloaded %q", data)
	}
}

func TestDownloadModelFileRejectsWrongHash(t *testing.T) {
	content := []byte("model-data")
	spec := whisperModelSpec{Size: int64(len(content)), SHA256: "wrong"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(content)
	}))
	defer server.Close()

	err := downloadModelFile(context.Background(), server.URL, filepath.Join(t.TempDir(), "model.bin"), spec, func(int64, int64) {})
	if err == nil {
		t.Fatal("expected checksum error")
	}
}
