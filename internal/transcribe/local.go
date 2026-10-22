package transcribe

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"reads/internal/model"
)

// Progress receives the current stage and an overall percentage.
type Progress func(stage string, percent int)

// Partial receives the recognised lines as soon as whisper finishes, before
// speaker separation starts, so the reader can start reading earlier.
type Partial func(cues []Cue, language, engine string)

// Result is a locally recognised transcript.
type Result struct {
	Cues     []Cue
	Language string
	Engine   string
}

const maxAudioBytes = 2 << 30

// RunLocal downloads the episode, converts it to 16 kHz mono WAV, recognises
// it with whisper.cpp and, when the diarization models are present, labels
// each line with the speaker whose turn overlaps it most.
//
// Diarization failing does not fail the job: subtitles without speakers are
// still useful, and the engine label records what happened.
func RunLocal(ctx context.Context, eng model.TranscribeEngine, audioURL, workDir string, report Progress, partial Partial) (*Result, error) {
	if !eng.Ready {
		return nil, fmt.Errorf("本机识别引擎未就绪，缺少：%s", strings.Join(eng.Missing, "、"))
	}
	cfg := eng.Resolved
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return nil, err
	}

	report("下载音频", 0)
	src := filepath.Join(workDir, "source")
	if err := downloadFile(ctx, audioURL, src, func(p float64) { report("下载音频", int(p*15)) }); err != nil {
		return nil, fmt.Errorf("下载音频失败：%w", err)
	}

	report("转换音频", 15)
	wav := filepath.Join(workDir, "audio.wav")
	if err := runTool(ctx, cfg.FFmpeg, []string{
		"-nostdin", "-hide_banner", "-loglevel", "error", "-y",
		"-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav,
	}, nil); err != nil {
		return nil, fmt.Errorf("音频转换失败：%w", err)
	}
	_ = os.Remove(src)

	asrEnd := 97
	if eng.CanDiarize {
		asrEnd = 75
	}
	report("识别语音", 20)
	cues, lang, err := whisper(ctx, cfg, wav, workDir, func(p int) {
		report("识别语音", 20+p*(asrEnd-20)/100)
	})
	if err != nil {
		return nil, err
	}
	if len(cues) == 0 {
		return nil, errors.New("没有识别出任何语音")
	}
	cues = cleanCues(cues)

	engine := "whisper.cpp · " + strings.TrimSuffix(filepath.Base(cfg.WhisperModel), filepath.Ext(cfg.WhisperModel))
	if eng.CanDiarize {
		report("区分说话人", asrEnd)
		if partial != nil {
			partial(cues, lang, engine)
		}
		// sherpa's segmentation and embedding sessions default to one thread
		// each. On a long episode that made diarization slower than the
		// recognition pass, so give it several threads and leave one core for
		// the UI.
		turns, err := diarize(ctx, cfg, wav, diarizationThreads(runtime.NumCPU()), func(p int) {
			report("区分说话人", asrEnd+p*(97-asrEnd)/100)
		})
		switch {
		case ctx.Err() != nil:
			return nil, ctx.Err()
		case err != nil:
			engine += " · 说话人分离失败：" + err.Error()
		case len(turns) == 0:
			engine += " · 未分辨出说话人"
		default:
			assignSpeakers(cues, turns)
			engine += " · sherpa-onnx 说话人分离"
		}
	} else {
		engine += " · 未配置说话人分离"
	}

	report("整理字幕", 98)
	return &Result{Cues: cues, Language: lang, Engine: engine}, nil
}

// diarizationThreads gives the speech segmentation and embedding models room
// to scale. Both default to a single thread, which made diarization the slowest
// stage of a long episode. One core is left for the UI, and the cap keeps ONNX
// Runtime's per-session pools from oversubscribing many-core machines.
func diarizationThreads(cpus int) int {
	if cpus < 2 {
		return 1
	}
	threads := cpus - 1
	if threads > 8 {
		threads = 8
	}
	return threads
}

/* -------------------------------------------------------------- download */

func downloadFile(ctx context.Context, u, dst string, progress func(float64)) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := (&http.Client{Transport: &http.Transport{Proxy: http.ProxyFromEnvironment}}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("服务器返回 %d", resp.StatusCode)
	}
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer f.Close()

	total := resp.ContentLength
	var done int64
	buf := make([]byte, 256<<10)
	last := time.Now()
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				return werr
			}
			done += int64(n)
			if done > maxAudioBytes {
				return errors.New("音频文件过大")
			}
			if total > 0 && time.Since(last) > 300*time.Millisecond {
				progress(float64(done) / float64(total))
				last = time.Now()
			}
		}
		if rerr == io.EOF {
			return nil
		}
		if rerr != nil {
			return rerr
		}
	}
}

/* --------------------------------------------------------------- whisper */

var progressRe = regexp.MustCompile(`(\d+(?:\.\d+)?)\s*%`)

func whisper(ctx context.Context, cfg model.TranscribeConfig, wav, workDir string, progress func(int)) ([]Cue, string, error) {
	out := filepath.Join(workDir, "asr")
	args := []string{
		"-m", cfg.WhisperModel, "-f", wav,
		"-l", cfg.Language, "-t", strconv.Itoa(cfg.Threads),
		"-oj", "-of", out, "-pp",
	}
	if strings.HasPrefix(cfg.Language, "zh") {
		// Without a hint Whisper often writes Mandarin in traditional characters.
		args = append(args, "--prompt", "以下是普通话的句子，使用简体中文。")
	}
	err := runTool(ctx, cfg.Whisper, args, func(line string) {
		if strings.Contains(line, "progress") {
			if m := progressRe.FindStringSubmatch(line); m != nil {
				if v, err := strconv.ParseFloat(m[1], 64); err == nil {
					progress(int(math.Min(v, 100)))
				}
			}
		}
	})
	if err != nil {
		return nil, "", fmt.Errorf("语音识别失败：%w", err)
	}

	data, err := os.ReadFile(out + ".json")
	if err != nil {
		return nil, "", errors.New("语音识别没有输出结果")
	}
	var doc struct {
		Result struct {
			Language string `json:"language"`
		} `json:"result"`
		Transcription []struct {
			Offsets struct {
				From int64 `json:"from"`
				To   int64 `json:"to"`
			} `json:"offsets"`
			Text string `json:"text"`
		} `json:"transcription"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, "", fmt.Errorf("无法读取识别结果：%w", err)
	}
	cues := make([]Cue, 0, len(doc.Transcription))
	for _, t := range doc.Transcription {
		text := strings.TrimSpace(strings.ReplaceAll(t.Text, "\ufffd", ""))
		if text == "" || isNoiseLine(text) {
			continue
		}
		cues = append(cues, Cue{
			Start: float64(t.Offsets.From) / 1000,
			End:   float64(t.Offsets.To) / 1000,
			Text:  text,
		})
	}
	return cues, doc.Result.Language, nil
}

// isNoiseLine drops Whisper's non-speech annotations such as "[音乐]" or
// "(applause)".
func isNoiseLine(s string) bool {
	if len(s) < 2 {
		return false
	}
	open, close := s[0], s[len(s)-1]
	return (open == '[' && close == ']') || (open == '(' && close == ')')
}

/* ----------------------------------------------------------- diarization */

type turn struct {
	start, end float64
	speaker    string
}

var turnRe = regexp.MustCompile(`(\d+(?:\.\d+)?)\s*--\s*(\d+(?:\.\d+)?)\s+(speaker_\d+)`)

func diarize(ctx context.Context, cfg model.TranscribeConfig, wav string, threads int, progress func(int)) ([]turn, error) {
	args := []string{
		"--segmentation.pyannote-model=" + cfg.SegmentationModel,
		"--segmentation.num-threads=" + strconv.Itoa(threads),
		"--embedding.model=" + cfg.EmbeddingModel,
		"--embedding.num-threads=" + strconv.Itoa(threads),
	}
	if cfg.Speakers > 0 {
		args = append(args, "--clustering.num-clusters="+strconv.Itoa(cfg.Speakers))
	}
	args = append(args, wav)

	var turns []turn
	err := runTool(ctx, cfg.Diarizer, args, func(line string) {
		if m := turnRe.FindStringSubmatch(line); m != nil {
			s, _ := strconv.ParseFloat(m[1], 64)
			e, _ := strconv.ParseFloat(m[2], 64)
			turns = append(turns, turn{start: s, end: e, speaker: m[3]})
			return
		}
		if m := progressRe.FindStringSubmatch(line); m != nil {
			if v, err := strconv.ParseFloat(m[1], 64); err == nil {
				progress(int(math.Min(v, 100)))
			}
		}
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(turns, func(i, j int) bool { return turns[i].start < turns[j].start })
	return turns, nil
}

// assignSpeakers gives each line the speaker whose turns overlap it most; a
// line inside a pause takes the nearest turn within two seconds.
func assignSpeakers(cues []Cue, turns []turn) {
	for i := range cues {
		c := &cues[i]
		overlap := map[string]float64{}
		nearest, nearestGap := "", 2.0
		for _, t := range turns {
			if t.start > c.End+nearestGap {
				break
			}
			if o := math.Min(c.End, t.end) - math.Max(c.Start, t.start); o > 0 {
				overlap[t.speaker] += o
				continue
			}
			gap := math.Max(t.start-c.End, c.Start-t.end)
			if gap < nearestGap {
				nearest, nearestGap = t.speaker, gap
			}
		}
		best, bestO := "", 0.0
		for sp, o := range overlap {
			if o > bestO || (o == bestO && sp < best) {
				best, bestO = sp, o
			}
		}
		if best == "" {
			best = nearest
		}
		c.Speaker = best
	}
}

/* ----------------------------------------------------------------- tools */

// runTool runs a helper program without a console window, streaming its
// combined output to onLine. On failure the last lines of output explain why.
func runTool(ctx context.Context, path string, args []string, onLine func(string)) error {
	cmd := exec.CommandContext(ctx, path, args...)
	hideWindow(cmd)
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw
	if err := cmd.Start(); err != nil {
		pw.Close()
		return err
	}

	tail := make([]string, 0, 6)
	scanned := make(chan struct{})
	go func() {
		defer close(scanned)
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 64<<10), 1<<20)
		sc.Split(scanLinesOrCR)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" {
				continue
			}
			if onLine != nil {
				onLine(line)
			}
			if len(tail) == cap(tail) {
				tail = tail[1:]
			}
			tail = append(tail, line)
		}
		_, _ = io.Copy(io.Discard, pr)
	}()

	err := cmd.Wait()
	pw.Close()
	<-scanned
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		if len(tail) > 0 {
			return fmt.Errorf("%s（%s）", tail[len(tail)-1], filepath.Base(path))
		}
		return fmt.Errorf("%s 退出：%w", filepath.Base(path), err)
	}
	return nil
}

// scanLinesOrCR splits on \n and on bare \r, which progress meters use to
// redraw one line in place.
func scanLinesOrCR(data []byte, atEOF bool) (int, []byte, error) {
	for i, b := range data {
		if b == '\n' || b == '\r' {
			return i + 1, data[:i], nil
		}
	}
	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}
	return 0, nil, nil
}
