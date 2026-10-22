package service

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"reads/internal/model"
	"reads/internal/transcribe"
)

// Transcript jobs are intentionally outside Service so the podcast feature can
// be added without coupling refresh scheduling to long-running CPU work.
type transcriptManager struct {
	once sync.Once
	err  error

	mu     sync.RWMutex
	jobs   map[int64]*model.TranscriptJob
	cancel map[int64]context.CancelFunc
	local  chan struct{} // one local recogniser at a time
}

var transcriptManagers sync.Map // *Service -> *transcriptManager

func (s *Service) transcriptManager() *transcriptManager {
	v, _ := transcriptManagers.LoadOrStore(s, &transcriptManager{
		jobs:   map[int64]*model.TranscriptJob{},
		cancel: map[int64]context.CancelFunc{},
		local:  make(chan struct{}, 1),
	})
	m := v.(*transcriptManager)
	m.once.Do(func() { m.err = s.store.EnsureTranscriptSchema() })
	return m
}

// GetTranscribeEngine reports what local tools/models have been found.
func (s *Service) GetTranscribeEngine() model.TranscribeEngine {
	cfg := transcribe.LoadConfig(s.dataDir)
	return transcribe.Detect(s.dataDir, cfg)
}

// SaveTranscribeConfig saves the local tool/model paths and returns the newly
// resolved engine state.
func (s *Service) SaveTranscribeConfig(cfg model.TranscribeConfig) (model.TranscribeEngine, error) {
	if err := transcribe.SaveConfig(s.dataDir, cfg); err != nil {
		return model.TranscribeEngine{}, err
	}
	return s.GetTranscribeEngine(), nil
}

// GetTranscript returns a stored transcript or a running job for the episode.
func (s *Service) GetTranscript(entryID int64) (*model.TranscriptJob, error) {
	if entryID <= 0 {
		return nil, errors.New("无效的条目")
	}
	m := s.transcriptManager()
	if m.err != nil {
		return nil, m.err
	}
	m.mu.RLock()
	if job := m.jobs[entryID]; job != nil {
		copy := cloneJob(job)
		m.mu.RUnlock()
		return copy, nil
	}
	m.mu.RUnlock()

	t, err := s.store.Transcript(entryID)
	if err != nil {
		return nil, err
	}
	if t != nil {
		return &model.TranscriptJob{EntryID: entryID, Status: model.TranscriptDone, Stage: "字幕已就绪", Progress: 100, Transcript: t}, nil
	}
	return &model.TranscriptJob{EntryID: entryID, Status: model.TranscriptNone}, nil
}

// GenerateTranscript starts a background job. Publisher transcripts are tried
// first; when none exists, the local engine recognises and diarizes the audio.
// forceLocal skips the feed and replaces any cached transcript.
func (s *Service) GenerateTranscript(entryID int64, forceLocal bool) (*model.TranscriptJob, error) {
	if entryID <= 0 {
		return nil, errors.New("无效的条目")
	}
	m := s.transcriptManager()
	if m.err != nil {
		return nil, m.err
	}
	ep, err := s.store.TranscriptEpisode(entryID)
	if err != nil {
		return nil, err
	}
	if ep.AudioURL == "" {
		return nil, errors.New("这条内容没有可识别的音频")
	}

	m.mu.Lock()
	if job := m.jobs[entryID]; job != nil && (job.Status == model.TranscriptQueued || job.Status == model.TranscriptRunning) {
		copy := cloneJob(job)
		m.mu.Unlock()
		return copy, nil
	}
	parent := s.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	job := &model.TranscriptJob{EntryID: entryID, Status: model.TranscriptQueued, Stage: "准备字幕", Progress: 0}
	m.jobs[entryID] = job
	m.cancel[entryID] = cancel
	initial := cloneJob(job)
	m.mu.Unlock()

	go s.runTranscript(ctx, m, ep.EntryID, ep.FeedURL, ep.GUID, ep.Link, ep.AudioURL, forceLocal)
	return initial, nil
}

// CancelTranscript cancels an active download or local recognition process.
func (s *Service) CancelTranscript(entryID int64) error {
	m := s.transcriptManager()
	m.mu.RLock()
	cancel := m.cancel[entryID]
	m.mu.RUnlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

// RenameTranscriptSpeaker replaces "说话人 1" with a real name.
func (s *Service) RenameTranscriptSpeaker(entryID int64, speakerID, name string) (*model.Transcript, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("名字不能为空")
	}
	if len([]rune(name)) > 32 {
		return nil, errors.New("名字过长")
	}
	t, err := s.store.RenameTranscriptSpeaker(entryID, speakerID, name)
	if err != nil || t == nil {
		return t, err
	}
	m := s.transcriptManager()
	m.mu.Lock()
	if job := m.jobs[entryID]; job != nil {
		job.Transcript = t
	}
	m.mu.Unlock()
	return t, nil
}

func (s *Service) runTranscript(ctx context.Context, m *transcriptManager, entryID int64, feedURL, guid, link, audioURL string, forceLocal bool) {
	defer func() {
		m.mu.Lock()
		delete(m.cancel, entryID)
		m.mu.Unlock()
	}()
	setJob(m, entryID, model.TranscriptRunning, "查找节目文稿", 3, "", nil)

	client := &http.Client{
		Timeout: 45 * time.Second,
		Transport: &http.Transport{
			Proxy:               http.ProxyFromEnvironment,
			DialContext:         (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
			TLSHandshakeTimeout: 10 * time.Second,
		},
	}
	if !forceLocal {
		cues, err := transcribe.FeedTranscript(ctx, client, transcribe.Episode{
			FeedURL: feedURL, GUID: guid, Link: link, AudioURL: audioURL,
		})
		if err == nil {
			speakers, segments := transcribe.Build(cues)
			t := &model.Transcript{
				EntryID: entryID, Source: model.TranscriptFromFeed, Engine: "节目自带文稿",
				Speakers: speakers, Segments: segments, CreatedAt: time.Now().UnixMilli(),
			}
			if err := s.store.SaveTranscript(t); err != nil {
				setJob(m, entryID, model.TranscriptError, "保存失败", 0, err.Error(), nil)
				return
			}
			setJob(m, entryID, model.TranscriptDone, "字幕已就绪", 100, "", t)
			return
		}
		if ctx.Err() != nil {
			setJob(m, entryID, model.TranscriptNone, "", 0, "", nil)
			return
		}
	}

	setJob(m, entryID, model.TranscriptQueued, "等待本机识别", 4, "", nil)
	select {
	case m.local <- struct{}{}:
		defer func() { <-m.local }()
	case <-ctx.Done():
		setJob(m, entryID, model.TranscriptNone, "", 0, "", nil)
		return
	}

	eng := s.GetTranscribeEngine()
	if !eng.Ready {
		setJob(m, entryID, model.TranscriptError, "本机识别未配置", 0,
			"请先配置本机识别引擎，缺少："+strings.Join(eng.Missing, "、"), nil)
		return
	}
	work := filepath.Join(transcribe.Dir(s.dataDir), "work", time.Now().Format("20060102-150405")+"-"+itoa(entryID))
	defer os.RemoveAll(work)
	res, err := transcribe.RunLocal(ctx, eng, audioURL, work, func(stage string, progress int) {
		setJob(m, entryID, model.TranscriptRunning, stage, progress, "", nil)
	}, func(cues []transcribe.Cue, language, engine string) {
		// Publish the recognised lines while diarization is still running; the
		// final save below replaces them with the speaker-labelled version.
		speakers, segments := transcribe.Build(cues)
		interim := &model.Transcript{
			EntryID: entryID, Source: model.TranscriptFromLocal, Engine: engine,
			Language: language, Speakers: speakers, Segments: segments, CreatedAt: time.Now().UnixMilli(),
		}
		setJob(m, entryID, model.TranscriptRunning, "区分说话人", 75, "", interim)
	})
	if ctx.Err() != nil {
		setJob(m, entryID, model.TranscriptNone, "", 0, "", nil)
		return
	}
	if err != nil {
		setJob(m, entryID, model.TranscriptError, "识别失败", 0, err.Error(), nil)
		return
	}
	speakers, segments := transcribe.Build(res.Cues)
	t := &model.Transcript{
		EntryID: entryID, Source: model.TranscriptFromLocal, Engine: res.Engine,
		Language: res.Language, Speakers: speakers, Segments: segments, CreatedAt: time.Now().UnixMilli(),
	}
	if err := s.store.SaveTranscript(t); err != nil {
		setJob(m, entryID, model.TranscriptError, "保存失败", 0, err.Error(), nil)
		return
	}
	setJob(m, entryID, model.TranscriptDone, "字幕已就绪", 100, "", t)
}

func setJob(m *transcriptManager, id int64, status, stage string, progress int, errMsg string, transcript *model.Transcript) {
	m.mu.Lock()
	defer m.mu.Unlock()
	job := m.jobs[id]
	if job == nil {
		job = &model.TranscriptJob{EntryID: id}
		m.jobs[id] = job
	}
	job.Status = status
	job.Stage = stage
	job.Progress = progress
	job.Error = errMsg
	if transcript != nil || status == model.TranscriptNone {
		job.Transcript = transcript
	}
}

func cloneJob(j *model.TranscriptJob) *model.TranscriptJob {
	copy := *j
	return &copy
}

func itoa(v int64) string {
	if v == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	return string(buf[i:])
}
