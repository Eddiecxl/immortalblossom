package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCurrentBuildTargetsV30(t *testing.T) {
	if Current.GameVersion != "30.0.4" {
		t.Fatalf("Current.GameVersion = %q, want %q", Current.GameVersion, "30.0.4")
	}
	if Current.LauncherVersion != "5.1.3" {
		t.Fatalf("Current.LauncherVersion = %q, want %q", Current.LauncherVersion, "5.1.3")
	}
}

func TestCompareVersionOrdersNumericSegments(t *testing.T) {
	tests := []struct {
		name string
		a    string
		b    string
		want int
	}{
		{name: "older minor", a: "26.0", b: "26.1", want: -1},
		{name: "equal with trailing zero", a: "26.1", b: "26.1.0", want: 0},
		{name: "newer launcher", a: "5.0.0", b: "4.0.0", want: 1},
		{name: "numeric not lexical", a: "26.10", b: "26.2", want: 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := CompareVersion(tt.a, tt.b)
			if err != nil {
				t.Fatalf("CompareVersion(%q, %q) error: %v", tt.a, tt.b, err)
			}
			if got != tt.want {
				t.Fatalf("CompareVersion(%q, %q) = %d, want %d", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

func TestCompareVersionRejectsMalformedInput(t *testing.T) {
	for _, value := range []string{"", "26.x", "v26.1", "26..1", "-1.0"} {
		if _, err := CompareVersion(value, "26.1"); err == nil {
			t.Fatalf("CompareVersion accepted malformed version %q", value)
		}
	}
}

func TestResolvePackageRootAcceptsCompleteLayout(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"launcher", "game", "runtime", "repair", "Updates"} {
		if err := os.Mkdir(filepath.Join(root, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}

	got, err := ResolvePackageRoot(filepath.Join(root, "LuoXian.exe"))
	if err != nil {
		t.Fatalf("ResolvePackageRoot error: %v", err)
	}
	if got != root {
		t.Fatalf("ResolvePackageRoot = %q, want %q", got, root)
	}
}

func TestResolvePackageRootRejectsMissingLayout(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "launcher"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := ResolvePackageRoot(filepath.Join(root, "LuoXian.exe")); err == nil {
		t.Fatal("ResolvePackageRoot accepted an incomplete package")
	}
}
