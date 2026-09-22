package airuntime

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type hotfixExitProcess struct {
	*fakeProcess
	done chan error
}

func (process *hotfixExitProcess) Done() <-chan error { return process.done }

func exitedHotfixProcess(err error) *hotfixExitProcess {
	done := make(chan error, 1)
	done <- err
	close(done)
	return &hotfixExitProcess{fakeProcess: &fakeProcess{}, done: done}
}

func gpuLayersArg(args []string) string {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == "--n-gpu-layers" {
			return args[i+1]
		}
	}
	return ""
}

func TestHotfixEnsureReadyFallsBackToCPUOnceAfterRuntimeExit(t *testing.T) {
	root, executable, model := makeAssets(t)
	var starts [][]string
	manager, err := New(Options{
		PackageRoot: root, DataRoot: t.TempDir(), ExecutablePath: executable, ModelPath: model,
		TotalMemoryBytes: func() uint64 { return 32 << 30 },
		StartupTimeout: 200 * time.Millisecond,
		PollInterval: time.Millisecond,
		HealthTimeout: 20 * time.Millisecond,
		RetryCooldown: time.Minute,
		StartProcess: func(_ string, args []string, _ io.Writer) (Process, error) {
			starts = append(starts, append([]string(nil), args...))
			if len(starts) == 1 {
				return exitedHotfixProcess(errors.New("simulated GPU/Vulkan startup failure")), nil
			}
			return &fakeProcess{}, nil
		},
		HTTPClient: fakeDoer(func(request *http.Request) (*http.Response, error) {
			if request.URL.Path != "/health" {
				t.Fatalf("unexpected path %s", request.URL.Path)
			}
			if len(starts) < 2 {
				return httpResponse(http.StatusServiceUnavailable, `{"status":"loading"}`), nil
			}
			return httpResponse(http.StatusOK, `{"status":"ok"}`), nil
		}),
	})
	if err != nil {
		t.Fatal(err)
	}

	status, err := manager.EnsureReady(context.Background())
	if err != nil {
		t.Fatalf("expected CPU fallback to recover runtime, got %v (%+v)", err, status)
	}
	if !status.Ready {
		t.Fatalf("expected ready status after CPU fallback, got %+v", status)
	}
	if len(starts) != 2 {
		t.Fatalf("expected exactly 2 starts (GPU then CPU), got %d", len(starts))
	}
	if got := gpuLayersArg(starts[0]); got == "0" || got == "" {
		t.Fatalf("expected first start to use configured GPU policy, got %q", got)
	}
	if got := gpuLayersArg(starts[1]); got != "0" {
		t.Fatalf("expected CPU fallback with --n-gpu-layers 0, got %q", got)
	}
}

func TestHotfixStartupFailureEntersCooldownAndStopsRestartStorm(t *testing.T) {
	root, executable, model := makeAssets(t)
	starts := 0
	manager, err := New(Options{
		PackageRoot: root, DataRoot: t.TempDir(), ExecutablePath: executable, ModelPath: model,
		TotalMemoryBytes: func() uint64 { return 32 << 30 },
		StartupTimeout: 100 * time.Millisecond,
		PollInterval: time.Millisecond,
		HealthTimeout: 20 * time.Millisecond,
		RetryCooldown: time.Hour,
		StartProcess: func(_ string, _ []string, _ io.Writer) (Process, error) {
			starts++
			return exitedHotfixProcess(errors.New("simulated startup crash")), nil
		},
		HTTPClient: fakeDoer(func(request *http.Request) (*http.Response, error) {
			return httpResponse(http.StatusServiceUnavailable, `{"status":"loading"}`), nil
		}),
	})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := manager.EnsureReady(context.Background()); err == nil {
		t.Fatal("expected initial startup failure")
	}
	if starts != 2 {
		t.Fatalf("expected configured attempt plus one CPU fallback, got %d starts", starts)
	}

	if _, err := manager.Recover(context.Background()); err == nil {
		t.Fatal("expected recover to respect active cooldown")
	}
	if starts != 2 {
		t.Fatalf("recover caused restart storm: starts=%d", starts)
	}

	if _, err := manager.EnsureReady(context.Background()); err == nil {
		t.Fatal("expected ensure-ready to respect active cooldown")
	}
	if starts != 2 {
		t.Fatalf("ensure-ready caused restart storm: starts=%d", starts)
	}
}

func TestHotfixHealthProbeUsesShortTimeout(t *testing.T) {
	root, executable, model := makeAssets(t)
	manager, err := New(Options{
		PackageRoot: root, DataRoot: t.TempDir(), ExecutablePath: executable, ModelPath: model,
		HealthTimeout: 25 * time.Millisecond,
		HTTPClient: fakeDoer(func(request *http.Request) (*http.Response, error) {
			<-request.Context().Done()
			return nil, request.Context().Err()
		}),
	})
	if err != nil {
		t.Fatal(err)
	}

	start := time.Now()
	status := manager.Status(context.Background())
	elapsed := time.Since(start)
	if elapsed > 300*time.Millisecond {
		t.Fatalf("health probe blocked UI path for %s; status=%+v", elapsed, status)
	}
	if !strings.Contains(status.Engine, "llama") {
		t.Fatalf("unexpected status: %+v", status)
	}
}
