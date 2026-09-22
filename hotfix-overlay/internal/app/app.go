package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"luoxianv26/internal/httpapi"
)

type Shell interface {
	Open(context.Context, string) error
}

type Options struct {
	Address    string
	Server     *httpapi.Server
	Shell      Shell
	AutoUpdate bool
}

func Run(ctx context.Context, options Options) error {
	if options.Server == nil || options.Shell == nil {
		return errors.New("app server and shell are required")
	}
	if options.Address == "" {
		options.Address = "127.0.0.1:24824"
	}
	if err := options.Server.Start(ctx, options.Address); err != nil {
		return err
	}
	readyCtx, cancelReady := context.WithTimeout(ctx, 5*time.Second)
	defer cancelReady()
	if err := options.Server.Ready(readyCtx); err != nil {
		return err
	}
	if options.AutoUpdate {
		applied, err := applyAvailableUpdates(ctx, options.Server.URL())
		if err != nil {
			return err
		}
		if applied {
			select {
			case <-ctx.Done():
				return shutdown(options.Server)
			case <-time.After(5 * time.Second):
				// If the detached updater could not start, keep the launcher usable.
			}
		}
	}

	launcherURL := options.Server.URL() + "/launcher/"
	pageCtx, cancelPage := context.WithTimeout(ctx, 5*time.Second)
	if err := waitLauncherPage(pageCtx, launcherURL); err != nil {
		cancelPage()
		return err
	}
	cancelPage()

	viewErrors := make(chan error, 1)
	go func() { viewErrors <- options.Shell.Open(ctx, launcherURL) }()
	for {
		select {
		case <-ctx.Done():
			return shutdown(options.Server)
		case err := <-viewErrors:
			if err != nil {
				return err
			}
			viewErrors = nil
		}
	}
}

func applyAvailableUpdates(ctx context.Context, baseURL string) (bool, error) {
	requestCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, baseURL+"/api/apply-updates", nil)
	if err != nil {
		return false, err
	}
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return false, errors.New("automatic patch installation failed")
	}
	var result struct {
		Applied []string `json:"applied"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return false, err
	}
	return len(result.Applied) > 0, nil
}

func shutdown(server *httpapi.Server) error {
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil && !errors.Is(err, context.Canceled) {
		return err
	}
	return nil
}
