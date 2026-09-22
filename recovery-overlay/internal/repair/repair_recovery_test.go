package repair

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, p string, body []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, body, 0o644); err != nil {
		t.Fatal(err)
	}
}

func hashHex(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

func TestVerifyUsesNewerInstalledVersionWithoutFlaggingVersionMarker(t *testing.T) {
	root := t.TempDir()
	oldVersion := []byte(`{"version":"30.0.2","launcher_min":"5.1.1","save_schema":4}`)
	newVersion := []byte(`{"version":"30.0.4","launcher_min":"5.1.1","save_schema":4}`)
	gameBody := []byte("game-data")

	manifest := Manifest{
		Version: "30.0.2",
		Files: []File{
			{Path: "game/version.json", SHA256: hashHex(oldVersion), Size: int64(len(oldVersion))},
			{Path: "game/index.html", SHA256: hashHex(gameBody), Size: int64(len(gameBody))},
		},
	}
	manifestBody, _ := json.Marshal(manifest)
	writeFile(t, filepath.Join(root, "game", "manifest.json"), manifestBody)
	writeFile(t, filepath.Join(root, "game", "version.json"), newVersion)
	writeFile(t, filepath.Join(root, "game", "index.html"), gameBody)

	report, err := Verify(root)
	if err != nil {
		t.Fatalf("Verify error: %v", err)
	}
	if !report.Healthy {
		t.Fatalf("expected healthy report, got %+v", report)
	}
	if report.Version != "30.0.4" {
		t.Fatalf("report.Version = %q, want 30.0.4", report.Version)
	}
	if len(report.BadFiles) != 0 {
		t.Fatalf("unexpected bad files: %v", report.BadFiles)
	}

	repaired, err := Repair(root)
	if err != nil {
		t.Fatalf("Repair error: %v", err)
	}
	if !repaired.Healthy || repaired.Version != "30.0.4" {
		t.Fatalf("unexpected repair report: %+v", repaired)
	}
	got, err := os.ReadFile(filepath.Join(root, "game", "version.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(newVersion) {
		t.Fatalf("repair changed newer version marker to %q", string(got))
	}
}

func TestVerifyStillFlagsMalformedVersionMarker(t *testing.T) {
	root := t.TempDir()
	expected := []byte(`{"version":"30.0.2"}`)
	malformed := []byte(`{"version":`)
	manifest := Manifest{
		Version: "30.0.2",
		Files: []File{{Path: "game/version.json", SHA256: hashHex(expected), Size: int64(len(expected))}},
	}
	manifestBody, _ := json.Marshal(manifest)
	writeFile(t, filepath.Join(root, "game", "manifest.json"), manifestBody)
	writeFile(t, filepath.Join(root, "game", "version.json"), malformed)

	report, err := Verify(root)
	if err != nil {
		t.Fatalf("Verify error: %v", err)
	}
	if report.Healthy || len(report.BadFiles) != 1 || report.BadFiles[0] != "game/version.json" {
		t.Fatalf("expected malformed version marker to remain repairable, got %+v", report)
	}
	if report.Version != "30.0.2" {
		t.Fatalf("report.Version = %q, want manifest fallback 30.0.2", report.Version)
	}
}
