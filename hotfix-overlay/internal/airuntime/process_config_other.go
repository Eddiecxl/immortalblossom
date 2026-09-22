//go:build !windows

package airuntime

import "os/exec"

func configureBackgroundProcess(command *exec.Cmd) {}
