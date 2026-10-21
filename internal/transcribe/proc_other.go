//go:build !windows

package transcribe

import "os/exec"

func hideWindow(_ *exec.Cmd) {}
