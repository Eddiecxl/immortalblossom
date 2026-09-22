package app

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"luoxianv26/internal/config"
	"luoxianv26/internal/httpapi"
	"luoxianv26/internal/patch"
	"luoxianv26/internal/repair"
	"luoxianv26/internal/storage"
)

type closingView struct {
	opened chan string
}

func TestRunAutomaticallyAppliesPatchBeforeOpeningView(t *testing.T) {
	root := t.TempDir()
	updates := filepath.Join(root, "Updates")
	payload := filepath.Join(root, "payload")
	if err := os.MkdirAll(filepath.Join(payload, "launcher"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(payload, "launcher", "marker.txt"), []byte("patched"), 0o644); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(updates, "auto.lxpatch")
	manifest := patch.Manifest{
		Format: 2, PatchID: "luoxian_auto_update_test", FromVersion: "26.1", ToVersion: "26.2",
		LauncherMin: "5.0.0", Files: []patch.File{{Path: "launcher/marker.txt", Kind: patch.KindDirect}},
	}
	if err := patch.BuildArchive(payload, manifest, archive); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	view := &closingView{opened: make(chan string, 1)}
	server := httpapi.New(httpapi.Dependencies{
		Root: root, UpdatesDir: updates,
		Build:   config.BuildInfo{GameVersion: "26.1", LauncherVersion: "5.0.0", PatchFormat: 2},
		Store:   storage.New(filepath.Join(root, "storage.json")),
		Verify:  func(string) (repair.Report, error) { return repair.Report{Healthy: true, Version: "26.1"}, nil },
		Restart: func(patch.InstallResult) error { cancel(); return nil },
	})
	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, Options{Address: "127.0.0.1:0", Server: server, Shell: view, AutoUpdate: true})
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("automatic patch installation did not restart")
	}
	select {
	case url := <-view.opened:
		t.Fatalf("view opened before restart: %s", url)
	default:
	}
	body, err := os.ReadFile(filepath.Join(root, "launcher", "marker.txt"))
	if err != nil || string(body) != "patched" {
		t.Fatalf("patch payload = %q, %v", body, err)
	}
}

func (view *closingView) Open(_ context.Context, url string) error {
	view.opened <- url
	return nil
}

func TestRunKeepsServerAliveAfterViewReturns(t *testing.T) {
	root := t.TempDir()
	launcherDir := filepath.Join(root, "launcher")
	if err := os.MkdirAll(launcherDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(launcherDir, "index.html"), []byte("<!doctype html><html><body>LuoXian launcher</body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	server := httpapi.New(httpapi.Dependencies{
		Root: root, UpdatesDir: filepath.Join(root, "Updates"),
		Build:  config.BuildInfo{GameVersion: "26.1", LauncherVersion: "5.0.0", PatchFormat: 2},
		Store:  storage.New(filepath.Join(root, "storage.json")),
		Verify: func(string) (repair.Report, error) { return repair.Report{Healthy: true, Version: "26.1"}, nil },
	})
	view := &closingView{opened: make(chan string, 1)}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- Run(ctx, Options{Address: "127.0.0.1:0", Server: server, Shell: view}) }()
	var url string
	select {
	case url = <-view.opened:
	case <-time.After(3 * time.Second):
		t.Fatal("view did not open")
	}
	response, err := http.Get(url + "/api/status")
	if err != nil {
		t.Fatalf("server stopped with view: %v", err)
	}
	_ = response.Body.Close()
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("app did not stop after explicit cancellation")
	}
}
