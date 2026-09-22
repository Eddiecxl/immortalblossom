//go:build windows

package airuntime

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000

func configureBackgroundProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
}
