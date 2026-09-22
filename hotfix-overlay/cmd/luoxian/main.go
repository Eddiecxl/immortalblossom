package main

import (
	"context"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"luoxianv26/internal/aihttp"
	"luoxianv26/internal/airuntime"
	"luoxianv26/internal/app"
	"luoxianv26/internal/config"
	"luoxianv26/internal/httpapi"
	"luoxianv26/internal/patch"
	"luoxianv26/internal/shell"
	"luoxianv26/internal/storage"
	"luoxianv26/internal/worlddb"
)

var launcherLogFile *os.File

func main() {
	os.Exit(finishRun(run()))
}

func finishRun(err error) int {
	if err != nil {
		log.Printf("LuoXian launcher failed: %v", err)
	}
	closeLogging()
	if err != nil {
		return 1
	}
	return 0
}

func run() error {
	if len(os.Args) == 4 && os.Args[1] == "--self-update" && os.Args[2] == "--stage-meta" {
		return patch.RunUpdater(context.Background(), os.Args[3])
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	root, err := config.ResolvePackageRoot(executable)
	if err != nil {
		return err
	}
	if err := configureLogging(); err != nil {
		return err
	}
	// During the first launch after a core update, the old updater helper is
	// still running and Windows keeps its executable locked. Refreshing the
	// helper here makes the new launcher fail before /api/status becomes ready,
	// which forces the updater to roll back the new core binary. Defer helper
	// refresh until the next ordinary launch, after the old helper has exited.
	if refreshUpdaterOnLaunch(os.Args) {
		if err := patch.EnsureUpdater(root, executable); err != nil {
			return err
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var host *shell.Host
	activate := func() {
		if host != nil {
			host.Activate()
		}
	}
	instance, primary, err := shell.AcquireSingleInstance(activate)
	if err != nil {
		return err
	}
	if !primary && restartLaunch(os.Args) {
		deadline := time.Now().Add(12 * time.Second)
		for !primary && time.Now().Before(deadline) {
			time.Sleep(100 * time.Millisecond)
			instance, primary, err = shell.AcquireSingleInstance(activate)
			if err != nil {
				return err
			}
		}
		if !primary {
			return errors.New("previous launcher instance did not release after update")
		}
	}
	if !primary {
		return nil
	}
	defer instance.Close()
	localData, err := localDataPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(localData, 0o700); err != nil {
		return err
	}
	aiRuntime, err := airuntime.New(airuntime.Options{PackageRoot: root, DataRoot: localData})
	if err != nil {
		return err
	}
	defer aiRuntime.Close()
	host = shell.New(shell.Options{
		Title: "落仙 · 启程", DataPath: filepath.Join(localData, "browser-profile"),
		OnClose:     cancel,
		OpenUpdates: func() error { return shell.OpenFolder(filepath.Join(root, "Updates")) },
		OpenSave:    func() error { return shell.OpenFolder(localData) },
	})
	server := httpapi.New(httpapi.Dependencies{
		Root: root, UpdatesDir: filepath.Join(root, "Updates"),
		LauncherDir: filepath.Join(root, "launcher"), GameDir: filepath.Join(root, "game"),
		ContentPath: filepath.Join(root, "launcher", "content.json"), Build: config.Current,
		Store: storage.New(filepath.Join(localData, "game-storage.json")), Worlds: worlddb.New(localData), AIHandler: aihttp.New(aiRuntime), OpenFolder: shell.OpenFolder,
		Restart: func(result patch.InstallResult) error {
			stage, stageErr := patch.StageCore(root, result)
			if stageErr != nil {
				return stageErr
			}
			if launchErr := patch.LaunchUpdater(stage); launchErr != nil {
				return launchErr
			}
			cancel()
			return nil
		},
	})
	return app.Run(ctx, app.Options{Address: "127.0.0.1:24824", Server: server, Shell: host, AutoUpdate: true})
}

func refreshUpdaterOnLaunch(args []string) bool {
	return !restartLaunch(args)
}

func localDataPath() (string, error) {
	root := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
	if !filepath.IsAbs(root) {
		return "", errors.New("LOCALAPPDATA must be an absolute directory")
	}
	return filepath.Join(root, "LuoXian"), nil
}

func restartLaunch(args []string) bool {
	for _, value := range args[1:] {
		if value == "--restarted-after-update" {
			return true
		}
	}
	return false
}

func configureLogging() error {
	localAppData := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
	if localAppData == "" {
		fallback, err := os.UserCacheDir()
		if err != nil {
			return err
		}
		localAppData = fallback
	}
	dir := filepath.Join(localAppData, "LuoXian", "logs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(filepath.Join(dir, "launcher.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	closeLogging()
	launcherLogFile = file
	log.SetOutput(file)
	log.SetFlags(log.Ldate | log.Ltime | log.LUTC | log.Lmicroseconds)
	return nil
}

func closeLogging() {
	if launcherLogFile == nil {
		return
	}
	_ = launcherLogFile.Close()
	launcherLogFile = nil
}
