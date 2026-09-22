package app

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

func waitLauncherPage(ctx context.Context, url string) error {
	client := &http.Client{Timeout: 500 * time.Millisecond}
	ticker := time.NewTicker(40 * time.Millisecond)
	defer ticker.Stop()
	var lastErr error

	for {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return err
		}
		response, err := client.Do(request)
		if err == nil {
			body, readErr := io.ReadAll(io.LimitReader(response.Body, 64<<10))
			_ = response.Body.Close()
			contentType := strings.ToLower(response.Header.Get("Content-Type"))
			if readErr == nil && response.StatusCode == http.StatusOK &&
				strings.Contains(contentType, "text/html") &&
				strings.TrimSpace(string(body)) != "" {
				return nil
			}
			if readErr != nil {
				lastErr = readErr
			} else {
				lastErr = errors.New("launcher page is not ready")
			}
		} else {
			lastErr = err
		}

		select {
		case <-ctx.Done():
			if lastErr != nil {
				return errors.Join(ctx.Err(), lastErr)
			}
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
