package model

// Transcript sources.
const (
	// TranscriptFromFeed is a transcript the publisher attached to the episode
	// (Podcasting 2.0 <podcast:transcript>).
	TranscriptFromFeed = "feed"
	// TranscriptFromLocal was recognised on this machine.
	TranscriptFromLocal = "local"
)

// Transcript job states.
const (
	TranscriptNone    = "none"
	TranscriptQueued  = "queued"
	TranscriptRunning = "running"
	TranscriptDone    = "done"
	TranscriptError   = "error"
)

// TranscriptSegment is one subtitle cue. Times are in seconds; Speaker is a
// TranscriptSpeaker ID, or empty when the source has no speaker information.
type TranscriptSegment struct {
	Start   float64 `json:"start"`
	End     float64 `json:"end"`
	Speaker string  `json:"speaker"`
	Text    string  `json:"text"`
}

// TranscriptSpeaker is one voice in an episode. Name starts as the
// publisher's label or a numbered placeholder and can be renamed by the reader.
type TranscriptSpeaker struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Transcript is an episode's subtitles, split by speaker.
type Transcript struct {
	EntryID   int64               `json:"entryId"`
	Source    string              `json:"source"`
	Engine    string              `json:"engine"`
	Language  string              `json:"language"`
	Speakers  []TranscriptSpeaker `json:"speakers"`
	Segments  []TranscriptSegment `json:"segments"`
	CreatedAt int64               `json:"createdAt"`
}

// TranscriptJob is what the frontend polls: the stored transcript once done,
// or the progress of the job producing it. While local diarization runs,
// Transcript already holds the recognised lines without speaker labels.
type TranscriptJob struct {
	EntryID    int64       `json:"entryId"`
	Status     string      `json:"status"`
	Stage      string      `json:"stage"`
	Progress   int         `json:"progress"`
	Error      string      `json:"error"`
	Transcript *Transcript `json:"transcript"`
}

// TranscribeConfig points the local engine at its tools and models. Empty
// paths are auto-detected in the engine folder and on PATH.
type TranscribeConfig struct {
	FFmpeg            string `json:"ffmpeg"`
	Whisper           string `json:"whisper"`
	WhisperModel      string `json:"whisperModel"`
	Diarizer          string `json:"diarizer"`
	SegmentationModel string `json:"segmentationModel"`
	EmbeddingModel    string `json:"embeddingModel"`
	// Language is a Whisper language code, or "auto".
	Language string `json:"language"`
	// Speakers fixes the number of voices; 0 lets clustering decide.
	Speakers int `json:"speakers"`
	Threads  int `json:"threads"`
}

// TranscribeEngine reports the local engine: the saved configuration, the
// paths actually in use, and what is still missing.
type TranscribeEngine struct {
	Dir        string           `json:"dir"`
	Config     TranscribeConfig `json:"config"`
	Resolved   TranscribeConfig `json:"resolved"`
	Ready      bool             `json:"ready"`
	CanDiarize bool             `json:"canDiarize"`
	Missing    []string         `json:"missing"`
}

type WhisperModel struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Filename    string `json:"filename"`
	Size        int64  `json:"size"`
	Installed   bool   `json:"installed"`
	Active      bool   `json:"active"`
	Bundled     bool   `json:"bundled"`
}

type WhisperModelDownload struct {
	ModelID    string `json:"modelId"`
	Status     string `json:"status"`
	Progress   int    `json:"progress"`
	Downloaded int64  `json:"downloaded"`
	Total      int64  `json:"total"`
	Error      string `json:"error"`
}
