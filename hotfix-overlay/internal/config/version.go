package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type BuildInfo struct {
	GameVersion     string
	LauncherVersion string
	PatchFormat     int
}

var buildGameVersion = "30.0.5"
var buildLauncherVersion = "5.1.4"

var Current = BuildInfo{
	GameVersion:     buildGameVersion,
	LauncherVersion: buildLauncherVersion,
	PatchFormat:     2,
}

func CompareVersion(a, b string) (int, error) {
	av, err := parseNumericVersion(a)
	if err != nil {
		return 0, err
	}
	bv, err := parseNumericVersion(b)
	if err != nil {
		return 0, err
	}
	for len(av) < len(bv) {
		av = append(av, 0)
	}
	for len(bv) < len(av) {
		bv = append(bv, 0)
	}
	for i := range av {
		if av[i] < bv[i] {
			return -1, nil
		}
		if av[i] > bv[i] {
			return 1, nil
		}
	}
	return 0, nil
}

func parseNumericVersion(value string) ([]int, error) {
	if value == "" {
		return nil, fmt.Errorf("version is empty")
	}
	parts := strings.Split(value, ".")
	result := make([]int, len(parts))
	for i, part := range parts {
		if part == "" {
			return nil, fmt.Errorf("invalid version %q", value)
		}
		for _, r := range part {
			if r < '0' || r > '9' {
				return nil, fmt.Errorf("invalid version %q", value)
			}
		}
		n, err := strconv.Atoi(part)
		if err != nil {
			return nil, fmt.Errorf("invalid version %q: %w", value, err)
		}
		result[i] = n
	}
	return result, nil
}

func ResolvePackageRoot(executablePath string) (string, error) {
	abs, err := filepath.Abs(executablePath)
	if err != nil {
		return "", fmt.Errorf("resolve executable path: %w", err)
	}
	root := filepath.Dir(abs)
	for _, name := range []string{"launcher", "game", "runtime", "repair", "Updates"} {
		info, statErr := os.Stat(filepath.Join(root, name))
		if statErr != nil || !info.IsDir() {
			return "", fmt.Errorf("invalid package layout: missing %s directory", name)
		}
	}
	return root, nil
}
