package store

import (
	"database/sql"
	"encoding/json"
	"errors"

	"reads/internal/model"
)

// TranscriptEpisode contains the private feed fields needed to find a
// publisher transcript or locally recognise the episode.
type TranscriptEpisode struct {
	EntryID  int64
	FeedURL  string
	GUID     string
	Link     string
	AudioURL string
}

// EnsureTranscriptSchema creates the optional subtitle cache. It is kept out
// of the core entries table so old databases need no destructive migration.
func (s *Store) EnsureTranscriptSchema() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS entry_transcripts (
			entry_id   INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
			source     TEXT NOT NULL,
			engine     TEXT NOT NULL DEFAULT '',
			language   TEXT NOT NULL DEFAULT '',
			speakers   TEXT NOT NULL DEFAULT '[]',
			segments   TEXT NOT NULL DEFAULT '[]',
			created_at INTEGER NOT NULL
		)`)
	return err
}

func (s *Store) TranscriptEpisode(id int64) (*TranscriptEpisode, error) {
	var ep TranscriptEpisode
	err := s.db.QueryRow(`
		SELECT e.id, f.url, e.guid, e.url, e.audio_url
		FROM entries e JOIN feeds f ON f.id = e.feed_id
		WHERE e.id = ?`, id).
		Scan(&ep.EntryID, &ep.FeedURL, &ep.GUID, &ep.Link, &ep.AudioURL)
	if err == sql.ErrNoRows {
		return nil, errors.New("找不到这一期播客")
	}
	return &ep, err
}

func (s *Store) Transcript(entryID int64) (*model.Transcript, error) {
	var t model.Transcript
	var speakers, segments string
	err := s.db.QueryRow(`
		SELECT entry_id, source, engine, language, speakers, segments, created_at
		FROM entry_transcripts WHERE entry_id = ?`, entryID).
		Scan(&t.EntryID, &t.Source, &t.Engine, &t.Language, &speakers, &segments, &t.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(speakers), &t.Speakers); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(segments), &t.Segments); err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Store) SaveTranscript(t *model.Transcript) error {
	speakers, err := json.Marshal(t.Speakers)
	if err != nil {
		return err
	}
	segments, err := json.Marshal(t.Segments)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`
		INSERT INTO entry_transcripts(entry_id, source, engine, language, speakers, segments, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(entry_id) DO UPDATE SET
			source = excluded.source,
			engine = excluded.engine,
			language = excluded.language,
			speakers = excluded.speakers,
			segments = excluded.segments,
			created_at = excluded.created_at`,
		t.EntryID, t.Source, t.Engine, t.Language, string(speakers), string(segments), t.CreatedAt)
	return err
}

func (s *Store) RenameTranscriptSpeaker(entryID int64, speakerID, name string) (*model.Transcript, error) {
	t, err := s.Transcript(entryID)
	if err != nil || t == nil {
		return t, err
	}
	found := false
	for i := range t.Speakers {
		if t.Speakers[i].ID == speakerID {
			t.Speakers[i].Name = name
			found = true
			break
		}
	}
	if !found {
		return nil, errors.New("找不到这个说话人")
	}
	if err := s.SaveTranscript(t); err != nil {
		return nil, err
	}
	return t, nil
}
