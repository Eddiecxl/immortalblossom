package windowstate

import "testing"

func TestToggleUsesObservedWindowsState(t *testing.T) {
	if got := Toggle(false); got != Maximize {
		t.Fatalf("normal window toggle = %v, want maximize", got)
	}
	if got := Toggle(true); got != Restore {
		t.Fatalf("maximized window toggle = %v, want restore", got)
	}
}
