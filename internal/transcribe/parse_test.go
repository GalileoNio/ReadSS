package transcribe

import "testing"

func TestParseVTTWithVoices(t *testing.T) {
	body := []byte("WEBVTT\n\n00:00:01.000 --> 00:00:03.500\n<v 主持人>欢迎收听。\n\n00:00:04.000 --> 00:00:06.000\n<v 嘉宾>你好。\n")
	cues, err := Parse(body, "text/vtt", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(cues) != 2 || cues[0].Speaker != "主持人" || cues[1].Text != "你好。" {
		t.Fatalf("unexpected cues: %#v", cues)
	}
	speakers, segments := Build(cues)
	if len(speakers) != 2 || speakers[0].Name != "主持人" || segments[1].Speaker != "s2" {
		t.Fatalf("unexpected build: %#v %#v", speakers, segments)
	}
}

func TestParseSRTPrefixSpeakers(t *testing.T) {
	body := []byte("1\n00:00:01,000 --> 00:00:02,000\nAlice: Hello.\n\n2\n00:00:02,100 --> 00:00:03,000\nBob: Hi.\n\n3\n00:00:03,100 --> 00:00:04,000\nAlice: Welcome.\n\n4\n00:00:04,100 --> 00:00:05,000\nBob: Thanks.\n")
	cues, err := Parse(body, "application/x-subrip", "")
	if err != nil {
		t.Fatal(err)
	}
	if cues[0].Speaker != "Alice" || cues[0].Text != "Hello." || cues[3].Speaker != "Bob" {
		t.Fatalf("unexpected cues: %#v", cues)
	}
}

func TestAssignSpeakers(t *testing.T) {
	cues := []Cue{{Start: 0, End: 5, Text: "one"}, {Start: 5.1, End: 7, Text: "two"}}
	turns := []turn{{start: 0, end: 4, speaker: "speaker_00"}, {start: 4, end: 8, speaker: "speaker_01"}}
	assignSpeakers(cues, turns)
	if cues[0].Speaker != "speaker_00" || cues[1].Speaker != "speaker_01" {
		t.Fatalf("unexpected speakers: %#v", cues)
	}
}
