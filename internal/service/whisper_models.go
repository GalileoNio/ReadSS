package service

import (
	"context"
	"errors"
	"sync"

	"reads/internal/model"
	"reads/internal/transcribe"
)

type whisperModelManager struct {
	mu       sync.RWMutex
	download model.WhisperModelDownload
	cancel   context.CancelFunc
}

var whisperModelManagers sync.Map

func (s *Service) whisperModelManager() *whisperModelManager {
	value, _ := whisperModelManagers.LoadOrStore(s, &whisperModelManager{
		download: model.WhisperModelDownload{Status: "idle"},
	})
	return value.(*whisperModelManager)
}

func (s *Service) GetWhisperModels() []model.WhisperModel {
	return transcribe.WhisperModels(s.dataDir, transcribe.LoadConfig(s.dataDir))
}

func (s *Service) GetWhisperModelDownload() model.WhisperModelDownload {
	manager := s.whisperModelManager()
	manager.mu.RLock()
	defer manager.mu.RUnlock()
	return manager.download
}

func (s *Service) DownloadWhisperModel(modelID string) (model.WhisperModelDownload, error) {
	available := false
	for _, candidate := range s.GetWhisperModels() {
		if candidate.ID == modelID && !candidate.Bundled {
			available = true
			break
		}
	}
	if !available {
		return model.WhisperModelDownload{}, errors.New("未知或无需下载的 Whisper 模型")
	}

	manager := s.whisperModelManager()
	manager.mu.Lock()
	if manager.download.Status == "running" {
		current := manager.download
		manager.mu.Unlock()
		if current.ModelID != modelID {
			return current, errors.New("另一个模型正在下载")
		}
		return current, nil
	}
	parent := s.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	manager.cancel = cancel
	manager.download = model.WhisperModelDownload{ModelID: modelID, Status: "running"}
	initial := manager.download
	manager.mu.Unlock()

	go s.runWhisperModelDownload(ctx, manager, modelID)
	return initial, nil
}

func (s *Service) CancelWhisperModelDownload() error {
	manager := s.whisperModelManager()
	manager.mu.RLock()
	cancel := manager.cancel
	manager.mu.RUnlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

func (s *Service) SelectWhisperModel(modelID string) (model.TranscribeEngine, error) {
	path, err := transcribe.InstalledWhisperModel(s.dataDir, modelID)
	if err != nil {
		return model.TranscribeEngine{}, err
	}
	cfg := transcribe.LoadConfig(s.dataDir)
	cfg.WhisperModel = path
	if err := transcribe.SaveConfig(s.dataDir, cfg); err != nil {
		return model.TranscribeEngine{}, err
	}
	return transcribe.Detect(s.dataDir, cfg), nil
}

func (s *Service) runWhisperModelDownload(ctx context.Context, manager *whisperModelManager, modelID string) {
	path, err := transcribe.DownloadWhisperModel(ctx, s.dataDir, modelID, func(downloaded, total int64) {
		manager.mu.Lock()
		manager.download.Downloaded = downloaded
		manager.download.Total = total
		if total > 0 {
			manager.download.Progress = int(downloaded * 100 / total)
		}
		manager.mu.Unlock()
	})
	if err == nil {
		cfg := transcribe.LoadConfig(s.dataDir)
		cfg.WhisperModel = path
		err = transcribe.SaveConfig(s.dataDir, cfg)
	}

	manager.mu.Lock()
	defer manager.mu.Unlock()
	manager.cancel = nil
	if ctx.Err() != nil {
		manager.download = model.WhisperModelDownload{ModelID: modelID, Status: "idle"}
		return
	}
	if err != nil {
		manager.download.Status = "error"
		manager.download.Error = err.Error()
		return
	}
	manager.download.Status = "done"
	manager.download.Progress = 100
}
