package transcribe

import "testing"

func TestDiarizationThreads(t *testing.T) {
	cases := []struct {
		cpus, want int
	}{
		{28, 8},
		{16, 8},
		{8, 7},
		{4, 3},
		{2, 1},
		{1, 1},
	}
	for _, c := range cases {
		if got := diarizationThreads(c.cpus); got != c.want {
			t.Errorf("diarizationThreads(%d) = %d, want %d", c.cpus, got, c.want)
		}
	}
}
