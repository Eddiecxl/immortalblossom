package main

import "testing"

func TestHotfixRefreshUpdaterOnLaunchSkipsPostUpdateRestart(t *testing.T) {
	if !refreshUpdaterOnLaunch([]string{"LuoXian.exe"}) {
		t.Fatal("ordinary launch must refresh updater helper")
	}
	if refreshUpdaterOnLaunch([]string{"LuoXian.exe", "--restarted-after-update", "token"}) {
		t.Fatal("post-update restart must not overwrite the updater helper while it is running")
	}
}
