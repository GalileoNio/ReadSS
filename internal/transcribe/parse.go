// Package transcribe produces speaker-labelled subtitles for podcast episodes:
// either from a transcript the publisher attached to the feed, or locally with
// whisper.cpp (speech recognition) and sherpa-onnx (speaker diarization).
package transcribe

import (
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"reads/internal/model"
)

// Cue is a subtitle line before speakers are numbered. Speaker holds the raw
// label from the source ("Alice", "speaker_00"), or "" when unknown.
type Cue struct {
	Start   float64
	End     float64
	Speaker string
	Text    string
}

// ErrUnsupportedFormat is returned for transcripts without timing (HTML, plain
// text), which cannot drive subtitles.
var ErrUnsupportedFormat = errors.New("不支持的文稿格式")

// Parse reads a VTT, SRT or Podcasting 2.0 JSON transcript.
func Parse(body []byte, mime, srcURL string) ([]Cue, error) {
	text := strings.TrimPrefix(string(body), "\ufeff")
	trimmed := strings.TrimSpace(text)
	mime = strings.ToLower(mime)
	lowerURL := strings.ToLower(srcURL)

	var cues []Cue
	var err error
	switch {
	case strings.Contains(mime, "html") || strings.HasPrefix(trimmed, "<"):
		return nil, ErrUnsupportedFormat
	case strings.Contains(mime, "json") || strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "["):
		cues, err = parseJSON([]byte(trimmed))
	case strings.Contains(mime, "vtt") || strings.Contains(mime, "srt") || strings.Contains(mime, "subrip") ||
		strings.HasPrefix(trimmed, "WEBVTT") || strings.Contains(trimmed, "-->") ||
		strings.HasSuffix(lowerURL, ".vtt") || strings.HasSuffix(lowerURL, ".srt"):
		cues = parseTimedText(text)
		cues = applySpeakerPrefixes(cues)
	default:
		return nil, ErrUnsupportedFormat
	}
	if err != nil {
		return nil, err
	}
	cues = cleanCues(cues)
	if len(cues) == 0 {
		return nil, errors.New("文稿内容为空")
	}
	if wordLevel(cues) {
		cues = mergeWords(cues)
	}
	return cues, nil
}

/* ------------------------------------------------------------- VTT / SRT */

var (
	voiceTag = regexp.MustCompile(`<v(?:\.[^\s>]*)?\s+([^>]+)>`)
	anyTag   = regexp.MustCompile(`<[^>]*>`)
	clockRe  = regexp.MustCompile(`(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?`)
)

// parseTimedText handles both WebVTT and SubRip: a cue is a timing line with
// "-->" followed by text lines up to the next blank line.
func parseTimedText(text string) []Cue {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	var cues []Cue
	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		arrow := strings.Index(line, "-->")
		if arrow < 0 {
			continue
		}
		start, ok1 := parseClock(line[:arrow])
		end, ok2 := parseClock(line[arrow+3:])
		if !ok1 || !ok2 {
			continue
		}
		var parts []string
		speaker := ""
		for i+1 < len(lines) && strings.TrimSpace(lines[i+1]) != "" {
			i++
			raw := strings.TrimSpace(lines[i])
			if m := voiceTag.FindStringSubmatch(raw); m != nil && speaker == "" {
				speaker = strings.TrimSpace(html.UnescapeString(m[1]))
			}
			raw = html.UnescapeString(anyTag.ReplaceAllString(raw, ""))
			if raw = strings.TrimSpace(raw); raw != "" {
				parts = append(parts, raw)
			}
		}
		cues = append(cues, Cue{Start: start, End: end, Speaker: speaker, Text: joinText(parts)})
	}
	return cues
}

// parseClock reads "hh:mm:ss.mmm", "mm:ss.mmm" or SubRip's "hh:mm:ss,mmm".
func parseClock(s string) (float64, bool) {
	m := clockRe.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return 0, false
	}
	h, _ := strconv.Atoi(m[1])
	mi, _ := strconv.Atoi(m[2])
	sec, _ := strconv.Atoi(m[3])
	ms := 0.0
	if m[4] != "" {
		frac, _ := strconv.Atoi(m[4])
		ms = float64(frac) / pow10(len(m[4]))
	}
	return float64(h*3600+mi*60+sec) + ms, true
}

func pow10(n int) float64 {
	v := 1.0
	for i := 0; i < n; i++ {
		v *= 10
	}
	return v
}

var prefixRe = regexp.MustCompile(`^\[?([^:：\[\]]{1,30}?)\]?\s*[:：]\s*(\S.*)$`)

// applySpeakerPrefixes recognises the "Name: text" convention many SRT
// exports use. A label must repeat to count, so a single "Note: …" line is not
// mistaken for a speaker; unlabelled cues continue the previous speaker's turn.
func applySpeakerPrefixes(cues []Cue) []Cue {
	counts := map[string]int{}
	for _, c := range cues {
		if c.Speaker != "" {
			return cues // the source already carries voice tags
		}
		if m := prefixRe.FindStringSubmatch(c.Text); m != nil && plausibleName(m[1]) {
			counts[strings.TrimSpace(m[1])]++
		}
	}
	accepted := map[string]bool{}
	for name, n := range counts {
		if n >= 2 {
			accepted[name] = true
		}
	}
	if len(accepted) == 0 || len(accepted) > 12 {
		return cues
	}
	current := ""
	for i, c := range cues {
		if m := prefixRe.FindStringSubmatch(c.Text); m != nil && accepted[strings.TrimSpace(m[1])] {
			current = strings.TrimSpace(m[1])
			cues[i].Text = strings.TrimSpace(m[2])
		}
		cues[i].Speaker = current
	}
	return cues
}

func plausibleName(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" || utf8.RuneCountInString(s) > 24 || strings.Contains(strings.ToLower(s), "http") {
		return false
	}
	return !unicode.IsDigit([]rune(s)[0])
}

/* ------------------------------------------------------------------ JSON */

// parseJSON reads the Podcasting 2.0 JSON transcript format:
// {"segments":[{"speaker":"…","startTime":0.1,"endTime":0.9,"body":"…"}]}.
func parseJSON(body []byte) ([]Cue, error) {
	type segment struct {
		Speaker   string      `json:"speaker"`
		StartTime json.Number `json:"startTime"`
		EndTime   json.Number `json:"endTime"`
		Body      string      `json:"body"`
	}
	var doc struct {
		Segments []segment `json:"segments"`
	}
	if err := json.Unmarshal(body, &doc); err != nil {
		var list []segment
		if err2 := json.Unmarshal(body, &list); err2 != nil {
			return nil, fmt.Errorf("无法解析 JSON 文稿：%w", err)
		}
		doc.Segments = list
	}
	cues := make([]Cue, 0, len(doc.Segments))
	for _, s := range doc.Segments {
		start, err1 := s.StartTime.Float64()
		end, err2 := s.EndTime.Float64()
		if err1 != nil || err2 != nil {
			continue
		}
		cues = append(cues, Cue{
			Start:   start,
			End:     end,
			Speaker: strings.TrimSpace(s.Speaker),
			Text:    strings.TrimSpace(html.UnescapeString(s.Body)),
		})
	}
	return cues, nil
}

/* --------------------------------------------------------------- shaping */

func cleanCues(cues []Cue) []Cue {
	out := cues[:0]
	for _, c := range cues {
		c.Text = strings.TrimSpace(strings.ReplaceAll(c.Text, "\ufffd", ""))
		if c.Text == "" {
			continue
		}
		if c.End < c.Start {
			c.End = c.Start
		}
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Start < out[j].Start })
	return out
}

// wordLevel reports transcripts timed per word, which read badly as
// subtitles; their median cue is well under a second and a half.
func wordLevel(cues []Cue) bool {
	if len(cues) < 8 {
		return false
	}
	d := make([]float64, len(cues))
	for i, c := range cues {
		d[i] = c.End - c.Start
	}
	sort.Float64s(d)
	return d[len(d)/2] < 1.5
}

// mergeWords joins consecutive cues of one speaker into sentence-sized lines.
func mergeWords(cues []Cue) []Cue {
	var out []Cue
	for _, c := range cues {
		if n := len(out); n > 0 {
			last := &out[n-1]
			if last.Speaker == c.Speaker && c.Start-last.End < 1.5 &&
				last.End-last.Start < 12 && utf8.RuneCountInString(last.Text) < 120 &&
				!endsSentence(last.Text) {
				last.Text = joinText([]string{last.Text, c.Text})
				last.End = c.End
				continue
			}
		}
		out = append(out, c)
	}
	return out
}

func endsSentence(s string) bool {
	r, _ := utf8.DecodeLastRuneInString(strings.TrimSpace(s))
	return strings.ContainsRune("。！？!?.…", r)
}

// joinText concatenates pieces, with a space only between non-CJK text.
func joinText(parts []string) string {
	var b strings.Builder
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if b.Len() > 0 {
			prev, _ := utf8.DecodeLastRuneInString(b.String())
			next, _ := utf8.DecodeRuneInString(p)
			if !isCJK(prev) && !isCJK(next) {
				b.WriteByte(' ')
			}
		}
		b.WriteString(p)
	}
	return b.String()
}

func isCJK(r rune) bool {
	return unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) ||
		unicode.Is(unicode.Katakana, r) || unicode.Is(unicode.Hangul, r) ||
		(r >= 0x3000 && r <= 0x303F) || (r >= 0xFF00 && r <= 0xFFEF)
}

var genericLabel = regexp.MustCompile(`(?i)^(?:speaker|spk|说话人)[\s_-]*\d+$`)

// Build numbers the speakers in order of first appearance. Publisher names
// are kept; generic labels such as "speaker_00" become "说话人 1".
func Build(cues []Cue) ([]model.TranscriptSpeaker, []model.TranscriptSegment) {
	ids := map[string]string{}
	speakers := []model.TranscriptSpeaker{}
	segments := make([]model.TranscriptSegment, 0, len(cues))
	for _, c := range cues {
		id := ""
		if c.Speaker != "" {
			var ok bool
			if id, ok = ids[c.Speaker]; !ok {
				n := len(speakers) + 1
				id = fmt.Sprintf("s%d", n)
				ids[c.Speaker] = id
				name := c.Speaker
				if genericLabel.MatchString(name) {
					name = fmt.Sprintf("说话人 %d", n)
				}
				speakers = append(speakers, model.TranscriptSpeaker{ID: id, Name: name})
			}
		}
		segments = append(segments, model.TranscriptSegment{
			Start:   round3(c.Start),
			End:     round3(c.End),
			Speaker: id,
			Text:    c.Text,
		})
	}
	return speakers, segments
}

func round3(v float64) float64 { return float64(int64(v*1000+0.5)) / 1000 }
