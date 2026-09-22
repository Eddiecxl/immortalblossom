package repair

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"luoxianv26/internal/config"
)

type Manifest struct {
	Version string `json:"version"`
	Files   []File `json:"files"`
}

type File struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type Report struct {
	Healthy  bool     `json:"healthy"`
	Version  string   `json:"version"`
	BadFiles []string `json:"bad_files"`
	Repaired []string `json:"repaired,omitempty"`
}

func Verify(root string) (Report, error) {
	manifest, err := readManifest(root)
	if err != nil {
		return Report{}, err
	}

	report := Report{Healthy: true, Version: manifest.Version}
	installed := installedGameVersion(root)
	newerInstalledVersion := false
	if installed != "" {
		if compare, compareErr := config.CompareVersion(installed, manifest.Version); compareErr == nil && compare > 0 {
			report.Version = installed
			newerInstalledVersion = true
		}
	}

	for _, file := range manifest.Files {
		if err := validateGamePath(file.Path); err != nil {
			return Report{}, err
		}
		normalized := filepath.ToSlash(file.Path)
		// A hotfix may legitimately advance game/version.json without replacing the
		// original repair baseline. Never treat that newer marker as corruption or
		// repair it back to an older version.
		if newerInstalledVersion && normalized == "game/version.json" {
			continue
		}
		body, readErr := os.ReadFile(filepath.Join(root, filepath.FromSlash(file.Path)))
		if readErr != nil || int64(len(body)) != file.Size {
			report.Healthy = false
			report.BadFiles = append(report.BadFiles, file.Path)
			continue
		}
		sum := sha256.Sum256(body)
		if !strings.EqualFold(hex.EncodeToString(sum[:]), file.SHA256) {
			report.Healthy = false
			report.BadFiles = append(report.BadFiles, file.Path)
		}
	}
	return report, nil
}

func Repair(root string) (Report, error) {
	before, err := Verify(root)
	if err != nil {
		return Report{}, err
	}
	if before.Healthy {
		return before, nil
	}
	wanted := make(map[string]bool, len(before.BadFiles))
	for _, name := range before.BadFiles {
		wanted[name] = true
	}
	bundlePath := filepath.Join(root, "repair", "game.bundle.zip")
	reader, err := zip.OpenReader(bundlePath)
	if err != nil {
		return Report{}, err
	}
	defer reader.Close()
	repaired := make([]string, 0, len(wanted))
	for _, entry := range reader.File {
		if !wanted[entry.Name] {
			continue
		}
		if err := validateGamePath(entry.Name); err != nil {
			return Report{}, err
		}
		in, err := entry.Open()
		if err != nil {
			return Report{}, err
		}
		body, readErr := io.ReadAll(io.LimitReader(in, 512<<20))
		_ = in.Close()
		if readErr != nil {
			return Report{}, readErr
		}
		target := filepath.Join(root, filepath.FromSlash(entry.Name))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return Report{}, err
		}
		temp := target + ".repair"
		if err := os.WriteFile(temp, body, 0o644); err != nil {
			return Report{}, err
		}
		if err := os.Rename(temp, target); err != nil {
			return Report{}, err
		}
		repaired = append(repaired, entry.Name)
		delete(wanted, entry.Name)
	}
	if len(wanted) != 0 {
		return Report{}, fmt.Errorf("repair bundle is missing %d required file(s)", len(wanted))
	}
	after, err := Verify(root)
	if err != nil {
		return Report{}, err
	}
	after.Repaired = repaired
	if !after.Healthy {
		return after, errors.New("repaired files did not pass verification")
	}
	return after, nil
}

func installedGameVersion(root string) string {
	body, err := os.ReadFile(filepath.Join(root, "game", "version.json"))
	if err != nil {
		return ""
	}
	var document struct {
		Version string `json:"version"`
	}
	if json.Unmarshal(body, &document) != nil {
		return ""
	}
	return strings.TrimSpace(document.Version)
}

func readManifest(root string) (Manifest, error) {
	body, err := os.ReadFile(filepath.Join(root, "game", "manifest.json"))
	if err != nil {
		return Manifest{}, err
	}
	var manifest Manifest
	if err := json.Unmarshal(body, &manifest); err != nil {
		return Manifest{}, err
	}
	if manifest.Version == "" || len(manifest.Files) == 0 {
		return Manifest{}, errors.New("game manifest is incomplete")
	}
	return manifest, nil
}

func validateGamePath(value string) error {
	if value == "" || strings.Contains(value, `\`) || path.IsAbs(value) || path.Clean(value) != value || !strings.HasPrefix(value, "game/") {
		return fmt.Errorf("illegal game manifest path %q", value)
	}
	return nil
}
