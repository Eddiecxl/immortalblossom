//go:build windows

package airuntime

import (
	"os/exec"
	"testing"
)

func TestHotfixBackgroundProcessPolicyHidesWindowsConsole(t *testing.T) {
	command := exec.Command("cmd.exe", "/c", "exit", "0")
	configureBackgroundProcess(command)
	if command.SysProcAttr == nil {
		t.Fatal("expected Windows SysProcAttr")
	}
	if !command.SysProcAttr.HideWindow {
		t.Fatal("expected HideWindow=true")
	}
	if command.SysProcAttr.CreationFlags&createNoWindow == 0 {
		t.Fatalf("expected CREATE_NO_WINDOW flag, got %#x", command.SysProcAttr.CreationFlags)
	}
}
