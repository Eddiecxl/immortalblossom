package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestWaitLauncherPageRetriesUntilHTMLIsReady(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if calls.Add(1) < 3 {
			http.Error(writer, "warming up", http.StatusServiceUnavailable)
			return
		}
		writer.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = writer.Write([]byte("<!doctype html><html><body>LuoXian</body></html>"))
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := waitLauncherPage(ctx, server.URL+"/launcher/"); err != nil {
		t.Fatalf("expected launcher page readiness to recover, got %v", err)
	}
	if calls.Load() < 3 {
		t.Fatalf("expected retries before success, got %d calls", calls.Load())
	}
}

func TestWaitLauncherPageRejectsBlankSuccessResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/html; charset=utf-8")
		writer.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Millisecond)
	defer cancel()
	if err := waitLauncherPage(ctx, server.URL+"/launcher/"); err == nil {
		t.Fatal("expected blank launcher page to be rejected")
	}
}
