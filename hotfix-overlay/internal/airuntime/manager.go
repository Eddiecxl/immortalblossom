package airuntime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	StateMissingRuntime = "missing_runtime"
	StateMissingModel   = "missing_model"
	StateStopped        = "stopped"
	StateStarting       = "starting"
	StateReady          = "ready"
	StateError          = "error"

	defaultHost    = "127.0.0.1"
	defaultPort    = 24825
	defaultContext = 8192
)

var (
	ErrUnsafeRuntimePath  = errors.New("unsafe AI runtime path")
	ErrRuntimeMissing     = errors.New("llama.cpp runtime is not installed")
	ErrModelMissing       = errors.New("local AI model is not installed")
	ErrRuntimeUnavailable = errors.New("local AI runtime is unavailable")
	ErrInvalidRequest     = errors.New("invalid local AI request")
	ErrGenerationFailed   = errors.New("local AI generation failed")
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type GenerateRequest struct {
	Task        string    `json:"task"`
	Messages    []Message `json:"messages"`
	MaxTokens   int       `json:"maxTokens"`
	Temperature float64   `json:"temperature"`
}

type GenerateResponse struct {
	Text    string `json:"text"`
	Runtime Status `json:"runtime"`
}

type Status struct {
	State            string `json:"state"`
	RuntimeInstalled bool   `json:"runtimeInstalled"`
	ModelInstalled   bool   `json:"modelInstalled"`
	Ready            bool   `json:"ready"`
	Engine           string `json:"engine"`
	ProfileID        string `json:"profileId"`
	ProfileLabel     string `json:"profileLabel"`
	ProfileSource    string `json:"profileSource"`
	ModelSlot        string `json:"modelSlot"`
	ContextSize      int    `json:"contextSize"`
	Threads          int    `json:"threads"`
	GPULayers        string `json:"gpuLayers"`
	MaxOutputTokens  int    `json:"maxOutputTokens"`
	LastError        string `json:"lastError,omitempty"`
}

type Process interface {
	Kill() error
}

type ProcessStarter func(executable string, args []string, output io.Writer) (Process, error)

type HTTPDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type Options struct {
	PackageRoot         string
	DataRoot            string
	ExecutablePath      string
	ModelPath           string
	ProfileManifestPath string
	ActiveProfilePath   string
	TotalMemoryBytes    func() uint64
	CPUCount            int
	Host                string
	Port                int
	ContextSize         int
	StartupTimeout      time.Duration
	PollInterval        time.Duration
	HealthTimeout       time.Duration
	RetryCooldown       time.Duration
	StartProcess        ProcessStarter
	HTTPClient          HTTPDoer
}

type Manager struct {
	mu sync.Mutex

	packageRoot         string
	runtimeRoot         string
	executable          string
	model               string
	dataRoot            string
	host                string
	port                int
	contextSize         int
	threads             int
	gpuLayers           string
	profile             Profile
	profileManifestPath string
	activeProfilePath   string
	totalMemoryBytes    func() uint64
	cpuCount            int
	modelOverride       bool
	baseURL             string

	startupTimeout time.Duration
	pollInterval   time.Duration
	healthTimeout  time.Duration
	retryCooldown  time.Duration
	startProcess   ProcessStarter
	httpClient     HTTPDoer

	process       Process
	state         string
	lastError     string
	cooldownUntil time.Time
}

type commandProcess struct {
	process *os.Process
	done    <-chan error
}

func (process commandProcess) Kill() error {
	if process.process == nil {
		return nil
	}
	return process.process.Kill()
}

func (process commandProcess) Done() <-chan error { return process.done }

func defaultStartProcess(executable string, args []string, output io.Writer) (Process, error) {
	command := exec.Command(executable, args...)
	configureBackgroundProcess(command)
	command.Stdout = output
	command.Stderr = output
	if err := command.Start(); err != nil {
		return nil, err
	}
	done := make(chan error, 1)
	go func() {
		done <- command.Wait()
		close(done)
	}()
	return commandProcess{process: command.Process, done: done}, nil
}

func New(options Options) (*Manager, error) {
	if strings.TrimSpace(options.PackageRoot) == "" {
		return nil, fmt.Errorf("%w: package root is required", ErrUnsafeRuntimePath)
	}
	packageRoot, err := filepath.Abs(options.PackageRoot)
	if err != nil {
		return nil, err
	}
	runtimeRoot := filepath.Join(packageRoot, "runtime")

	executable := options.ExecutablePath
	if executable == "" {
		name := "llama-server"
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		executable = filepath.Join(runtimeRoot, "llama", name)
	}
	profile, err := resolveProfile(profileOptions{
		PackageRoot: packageRoot, ManifestPath: options.ProfileManifestPath, ActiveProfilePath: options.ActiveProfilePath,
		TotalMemoryBytes: options.TotalMemoryBytes, CPUCount: options.CPUCount,
	})
	if err != nil {
		return nil, err
	}
	model := options.ModelPath
	if model == "" {
		model = filepath.Join(runtimeRoot, "models", profile.ModelFile)
	}

	executable, err = safeRuntimePath(runtimeRoot, executable)
	if err != nil {
		return nil, err
	}
	model, err = safeRuntimePath(runtimeRoot, model)
	if err != nil {
		return nil, err
	}

	host := strings.TrimSpace(options.Host)
	if host == "" {
		host = defaultHost
	}
	if host != defaultHost {
		return nil, fmt.Errorf("%w: local AI host must be loopback", ErrUnsafeRuntimePath)
	}
	port := options.Port
	if port == 0 {
		port = defaultPort
	}
	if port < 1024 || port > 65535 {
		return nil, fmt.Errorf("%w: invalid local AI port", ErrUnsafeRuntimePath)
	}
	contextSize := options.ContextSize
	if contextSize == 0 {
		contextSize = profile.ContextSize
	}
	if contextSize == 0 {
		contextSize = defaultContext
	}
	if contextSize < 2048 || contextSize > 131072 {
		return nil, fmt.Errorf("%w: invalid context size", ErrInvalidRequest)
	}

	startupTimeout := options.StartupTimeout
	if startupTimeout <= 0 {
		startupTimeout = 45 * time.Second
	}
	pollInterval := options.PollInterval
	if pollInterval <= 0 {
		pollInterval = 200 * time.Millisecond
	}
	healthTimeout := options.HealthTimeout
	if healthTimeout <= 0 {
		healthTimeout = 1200 * time.Millisecond
	}
	retryCooldown := options.RetryCooldown
	if retryCooldown <= 0 {
		retryCooldown = 45 * time.Second
	}
	starter := options.StartProcess
	if starter == nil {
		starter = defaultStartProcess
	}
	client := options.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second}
	}

	dataRoot := strings.TrimSpace(options.DataRoot)
	if dataRoot == "" {
		dataRoot = packageRoot
	}
	if abs, absErr := filepath.Abs(dataRoot); absErr == nil {
		dataRoot = abs
	}

	return &Manager{
		packageRoot: packageRoot, runtimeRoot: runtimeRoot, executable: executable, model: model, dataRoot: dataRoot,
		profileManifestPath: options.ProfileManifestPath, activeProfilePath: options.ActiveProfilePath, totalMemoryBytes: options.TotalMemoryBytes, cpuCount: options.CPUCount, modelOverride: options.ModelPath != "",
		host: host, port: port, contextSize: contextSize, threads: profile.Threads, gpuLayers: profile.GPULayers, profile: profile,
		baseURL:        "http://" + host + ":" + strconv.Itoa(port),
		startupTimeout: startupTimeout, pollInterval: pollInterval, healthTimeout: healthTimeout, retryCooldown: retryCooldown,
		startProcess: starter, httpClient: client, state: StateStopped,
	}, nil
}

func safeRuntimePath(runtimeRoot, candidate string) (string, error) {
	absolute, err := filepath.Abs(candidate)
	if err != nil {
		return "", err
	}
	root, err := filepath.Abs(runtimeRoot)
	if err != nil {
		return "", err
	}
	relative, err := filepath.Rel(root, absolute)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return "", fmt.Errorf("%w: path must stay under package runtime directory", ErrUnsafeRuntimePath)
	}
	return filepath.Clean(absolute), nil
}

func regularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func (manager *Manager) statusLocked(ctx context.Context, probe bool) Status {
	runtimeInstalled := regularFile(manager.executable)
	modelInstalled := regularFile(manager.model)
	status := Status{
		State: manager.state, RuntimeInstalled: runtimeInstalled, ModelInstalled: modelInstalled,
		Engine: "llama.cpp", ProfileID: manager.profile.ID, ProfileLabel: manager.profile.Label, ProfileSource: manager.profile.Source,
		ModelSlot: manager.profile.ModelFile, ContextSize: manager.contextSize, Threads: manager.threads, GPULayers: manager.gpuLayers,
		MaxOutputTokens: manager.profile.MaxOutputTokens, LastError: manager.lastError,
	}
	if !runtimeInstalled {
		status.State = StateMissingRuntime
		return status
	}
	if !modelInstalled {
		status.State = StateMissingModel
		return status
	}
	if probe {
		if manager.health(ctx) {
			manager.state = StateReady
			manager.lastError = ""
			status.State = StateReady
			status.Ready = true
			status.LastError = ""
			return status
		}
		if manager.state == StateReady {
			manager.state = StateError
			manager.lastError = "llama.cpp health check failed"
		}
	}
	if manager.state == "" || manager.state == StateMissingRuntime || manager.state == StateMissingModel {
		manager.state = StateStopped
	}
	status.State = manager.state
	status.Ready = status.State == StateReady
	return status
}

func (manager *Manager) Status(ctx context.Context) Status {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	return manager.statusLocked(ctx, true)
}

func (manager *Manager) health(ctx context.Context) bool {
	healthContext := ctx
	cancel := func() {}
	if manager.healthTimeout > 0 {
		healthContext, cancel = context.WithTimeout(ctx, manager.healthTimeout)
	}
	defer cancel()
	request, err := http.NewRequestWithContext(healthContext, http.MethodGet, manager.baseURL+"/health", nil)
	if err != nil {
		return false
	}
	response, err := manager.httpClient.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	return response.StatusCode >= 200 && response.StatusCode < 300
}

type processExitNotifier interface {
	Done() <-chan error
}

func processDone(process Process) <-chan error {
	if notifier, ok := process.(processExitNotifier); ok {
		return notifier.Done()
	}
	return nil
}

func (manager *Manager) stopProcessLocked() {
	if manager.process == nil {
		return
	}
	_ = manager.process.Kill()
	manager.process = nil
}

func (manager *Manager) waitForReadyLocked(ctx context.Context) error {
	manager.state = StateStarting
	deadline := time.Now().Add(manager.startupTimeout)
	done := processDone(manager.process)
	for {
		if manager.health(ctx) {
			manager.state = StateReady
			manager.lastError = ""
			manager.cooldownUntil = time.Time{}
			return nil
		}
		if done != nil {
			select {
			case exitErr, ok := <-done:
				manager.process = nil
				if !ok || exitErr == nil {
					return errors.New("llama.cpp exited during startup")
				}
				return fmt.Errorf("llama.cpp exited during startup: %v", exitErr)
			default:
			}
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if time.Now().After(deadline) {
			return errors.New("llama.cpp health check timed out")
		}
		timer := time.NewTimer(manager.pollInterval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case exitErr, ok := <-done:
			timer.Stop()
			manager.process = nil
			if !ok || exitErr == nil {
				return errors.New("llama.cpp exited during startup")
			}
			return fmt.Errorf("llama.cpp exited during startup: %v", exitErr)
		case <-timer.C:
		}
	}
}

func (manager *Manager) markStartupFailureLocked(err error) {
	manager.state = StateError
	manager.lastError = err.Error()
	manager.cooldownUntil = time.Now().Add(manager.retryCooldown)
}

func (manager *Manager) cooldownErrorLocked(ctx context.Context) (Status, error) {
	remaining := time.Until(manager.cooldownUntil)
	if remaining < 0 {
		remaining = 0
	}
	status := manager.statusLocked(ctx, false)
	return status, fmt.Errorf("%w: local AI restart cooldown active (%s remaining)", ErrRuntimeUnavailable, remaining.Round(time.Second))
}

func (manager *Manager) EnsureReady(ctx context.Context) (Status, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()

	status := manager.statusLocked(ctx, true)
	if status.Ready {
		return status, nil
	}
	if !status.RuntimeInstalled {
		return status, ErrRuntimeMissing
	}
	if !status.ModelInstalled {
		return status, ErrModelMissing
	}
	if manager.state == StateError && time.Now().Before(manager.cooldownUntil) {
		return manager.cooldownErrorLocked(ctx)
	}

	var primaryErr error
	if manager.process == nil {
		if err := manager.startLockedWithGPULayers(manager.gpuLayers); err != nil {
			primaryErr = err
		} else if err := manager.waitForReadyLocked(ctx); err != nil {
			if ctx.Err() != nil {
				manager.state = StateStarting
				manager.lastError = "llama.cpp startup still in progress"
				return manager.statusLocked(context.Background(), false), fmt.Errorf("%w: %v", ErrRuntimeUnavailable, ctx.Err())
			}
			primaryErr = err
			manager.stopProcessLocked()
		} else {
			return manager.statusLocked(ctx, false), nil
		}
	} else {
		if err := manager.waitForReadyLocked(ctx); err != nil {
			if ctx.Err() != nil {
				manager.state = StateStarting
				manager.lastError = "llama.cpp startup still in progress"
				return manager.statusLocked(context.Background(), false), fmt.Errorf("%w: %v", ErrRuntimeUnavailable, ctx.Err())
			}
			primaryErr = err
			manager.stopProcessLocked()
		} else {
			return manager.statusLocked(ctx, false), nil
		}
	}

	if manager.gpuLayers != "0" && ctx.Err() == nil {
		if err := manager.startLockedWithGPULayers("0"); err != nil {
			primaryErr = fmt.Errorf("%v; CPU fallback start failed: %v", primaryErr, err)
		} else if err := manager.waitForReadyLocked(ctx); err != nil {
			if ctx.Err() != nil {
				manager.state = StateStarting
				manager.lastError = "llama.cpp CPU fallback startup still in progress"
				return manager.statusLocked(context.Background(), false), fmt.Errorf("%w: %v", ErrRuntimeUnavailable, ctx.Err())
			}
			primaryErr = fmt.Errorf("%v; CPU fallback failed: %v", primaryErr, err)
			manager.stopProcessLocked()
		} else {
			return manager.statusLocked(ctx, false), nil
		}
	}

	if primaryErr == nil {
		primaryErr = errors.New("local AI runtime did not become ready")
	}
	manager.markStartupFailureLocked(primaryErr)
	return manager.statusLocked(ctx, false), fmt.Errorf("%w: %v", ErrRuntimeUnavailable, primaryErr)
}

func (manager *Manager) startLocked() error {
	return manager.startLockedWithGPULayers(manager.gpuLayers)
}

func (manager *Manager) startLockedWithGPULayers(gpuLayers string) error {
	logDir := filepath.Join(manager.dataRoot, "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return err
	}
	logFile, err := os.OpenFile(filepath.Join(logDir, "llama-server.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	args := []string{
		"--model", manager.model,
		"--host", manager.host,
		"--port", strconv.Itoa(manager.port),
		"--ctx-size", strconv.Itoa(manager.contextSize),
		"--threads", strconv.Itoa(manager.threads),
		"--n-gpu-layers", gpuLayers,
	}
	process, startErr := manager.startProcess(manager.executable, args, logFile)
	_ = logFile.Close()
	if startErr != nil {
		return startErr
	}
	manager.process = process
	manager.state = StateStarting
	manager.lastError = ""
	return nil
}

func (manager *Manager) Stop(ctx context.Context) (Status, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.process != nil {
		if err := manager.process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
			manager.state = StateError
			manager.lastError = err.Error()
			return manager.statusLocked(ctx, false), err
		}
		manager.process = nil
	}
	manager.state = StateStopped
	manager.lastError = ""
	manager.cooldownUntil = time.Time{}
	return manager.statusLocked(ctx, false), nil
}

func (manager *Manager) SetProfile(ctx context.Context, requested string) (Status, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	requested = strings.TrimSpace(strings.ToLower(requested))
	if requested != "auto" && requested != "lite" && requested != "standard" {
		return manager.statusLocked(ctx, false), fmt.Errorf("%w: profile must be auto, lite, or standard", ErrInvalidRequest)
	}
	if manager.process != nil {
		if err := manager.process.Kill(); err != nil {
			manager.state = StateError
			manager.lastError = err.Error()
			return manager.statusLocked(ctx, false), err
		}
		manager.process = nil
	}
	activePath := manager.activeProfilePath
	if activePath == "" {
		activePath = filepath.Join(manager.runtimeRoot, "models", "active-profile.json")
	}
	if err := os.MkdirAll(filepath.Dir(activePath), 0o755); err != nil {
		return manager.statusLocked(ctx, false), err
	}
	body, err := json.Marshal(activeProfileFile{Profile: requested})
	if err != nil {
		return manager.statusLocked(ctx, false), err
	}
	if err := os.WriteFile(activePath, body, 0o644); err != nil {
		return manager.statusLocked(ctx, false), err
	}
	profile, err := resolveProfile(profileOptions{
		PackageRoot: manager.packageRoot, ManifestPath: manager.profileManifestPath, ActiveProfilePath: activePath,
		TotalMemoryBytes: manager.totalMemoryBytes, CPUCount: manager.cpuCount,
	})
	if err != nil {
		return manager.statusLocked(ctx, false), err
	}
	manager.profile = profile
	manager.contextSize = profile.ContextSize
	manager.threads = profile.Threads
	manager.gpuLayers = profile.GPULayers
	if !manager.modelOverride {
		manager.model = filepath.Join(manager.runtimeRoot, "models", profile.ModelFile)
	}
	manager.state = StateStopped
	manager.lastError = ""
	manager.cooldownUntil = time.Time{}
	return manager.statusLocked(ctx, false), nil
}

func (manager *Manager) Recover(ctx context.Context) (Status, error) {
	manager.mu.Lock()
	if manager.state == StateError && time.Now().Before(manager.cooldownUntil) {
		status, err := manager.cooldownErrorLocked(ctx)
		manager.mu.Unlock()
		return status, err
	}
	manager.stopProcessLocked()
	manager.state = StateStopped
	manager.lastError = ""
	manager.cooldownUntil = time.Time{}
	manager.mu.Unlock()
	return manager.EnsureReady(ctx)
}

func validateGenerateRequest(request GenerateRequest) error {
	allowedTasks := map[string]bool{"intent": true, "npc": true, "narrate": true, "system": true}
	if !allowedTasks[request.Task] {
		return fmt.Errorf("%w: unsupported task", ErrInvalidRequest)
	}
	if len(request.Messages) < 1 || len(request.Messages) > 32 {
		return fmt.Errorf("%w: messages must contain 1-32 items", ErrInvalidRequest)
	}
	if request.MaxTokens < 16 || request.MaxTokens > 2048 {
		return fmt.Errorf("%w: maxTokens out of range", ErrInvalidRequest)
	}
	if request.Temperature < 0 || request.Temperature > 1.5 {
		return fmt.Errorf("%w: temperature out of range", ErrInvalidRequest)
	}
	total := 0
	for _, message := range request.Messages {
		if message.Role != "system" && message.Role != "user" && message.Role != "assistant" {
			return fmt.Errorf("%w: invalid message role", ErrInvalidRequest)
		}
		if strings.TrimSpace(message.Content) == "" || len(message.Content) > 50000 {
			return fmt.Errorf("%w: invalid message content", ErrInvalidRequest)
		}
		total += len(message.Content)
	}
	if total > 120000 {
		return fmt.Errorf("%w: message payload too large", ErrInvalidRequest)
	}
	return nil
}

func (manager *Manager) Generate(ctx context.Context, request GenerateRequest) (GenerateResponse, error) {
	if err := validateGenerateRequest(request); err != nil {
		return GenerateResponse{}, err
	}
	status, err := manager.EnsureReady(ctx)
	if err != nil {
		return GenerateResponse{Runtime: status}, err
	}

	maxTokens := request.MaxTokens
	if manager.profile.MaxOutputTokens > 0 && maxTokens > manager.profile.MaxOutputTokens {
		maxTokens = manager.profile.MaxOutputTokens
	}
	body, err := json.Marshal(map[string]any{
		"model": "local", "messages": request.Messages, "max_tokens": maxTokens,
		"temperature": request.Temperature, "stream": false,
	})
	if err != nil {
		return GenerateResponse{Runtime: status}, err
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, manager.baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return GenerateResponse{Runtime: status}, err
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	response, err := manager.httpClient.Do(httpRequest)
	if err != nil {
		return GenerateResponse{Runtime: status}, fmt.Errorf("%w: %v", ErrGenerationFailed, err)
	}
	defer response.Body.Close()
	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if readErr != nil {
		return GenerateResponse{Runtime: status}, fmt.Errorf("%w: %v", ErrGenerationFailed, readErr)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := strings.TrimSpace(string(responseBody))
		if len(message) > 500 {
			message = message[:500]
		}
		return GenerateResponse{Runtime: status}, fmt.Errorf("%w: llama.cpp HTTP %d: %s", ErrGenerationFailed, response.StatusCode, message)
	}
	var decoded struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(responseBody, &decoded); err != nil || len(decoded.Choices) == 0 || strings.TrimSpace(decoded.Choices[0].Message.Content) == "" {
		return GenerateResponse{Runtime: status}, fmt.Errorf("%w: llama.cpp returned no assistant text", ErrGenerationFailed)
	}
	return GenerateResponse{Text: decoded.Choices[0].Message.Content, Runtime: status}, nil
}

func (manager *Manager) Close() error {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.process == nil {
		return nil
	}
	err := manager.process.Kill()
	manager.process = nil
	manager.state = StateStopped
	manager.cooldownUntil = time.Time{}
	if errors.Is(err, os.ErrProcessDone) {
		return nil
	}
	return err
}
