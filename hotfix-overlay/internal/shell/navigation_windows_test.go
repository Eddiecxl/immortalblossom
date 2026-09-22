//go:build windows

package shell

import (
	"context"
	"sync"
	"testing"
	"time"
)

type fakeNavigationView struct {
	mu       sync.Mutex
	events   []string
	onNavigate func()
}

func (view *fakeNavigationView) SetHtml(string) {
	view.mu.Lock()
	view.events = append(view.events, "html")
	view.mu.Unlock()
}

func (view *fakeNavigationView) Dispatch(fn func()) { fn() }

func (view *fakeNavigationView) Navigate(string) {
	view.mu.Lock()
	view.events = append(view.events, "navigate")
	onNavigate := view.onNavigate
	view.mu.Unlock()
	if onNavigate != nil {
		onNavigate()
	}
}

func (view *fakeNavigationView) snapshot() []string {
	view.mu.Lock()
	defer view.mu.Unlock()
	return append([]string(nil), view.events...)
}

func TestHotfixNavigationShowsLoadingBeforeFirstNavigation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ready := make(chan struct{})
	view := &fakeNavigationView{}
	startLauncherNavigationWithDelays(ctx, view, "http://127.0.0.1:24824/launcher/", ready, []time.Duration{time.Millisecond}, 0)
	time.Sleep(20 * time.Millisecond)

	events := view.snapshot()
	if len(events) < 2 {
		t.Fatalf("expected loading HTML then navigation, got %v", events)
	}
	if events[0] != "html" || events[1] != "navigate" {
		t.Fatalf("expected loading HTML before navigation, got %v", events)
	}
}

func TestHotfixNavigationStopsRetryingAfterPageReady(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ready := make(chan struct{})
	var once sync.Once
	view := &fakeNavigationView{onNavigate: func() { once.Do(func() { close(ready) }) }}
	startLauncherNavigationWithDelays(ctx, view, "http://127.0.0.1:24824/launcher/", ready, []time.Duration{time.Millisecond, 5 * time.Millisecond, 5 * time.Millisecond}, 5*time.Millisecond)
	time.Sleep(40 * time.Millisecond)

	events := view.snapshot()
	navigations := 0
	for _, event := range events {
		if event == "navigate" {
			navigations++
		}
	}
	if navigations != 1 {
		t.Fatalf("expected navigation retries to stop after ready, got %d (%v)", navigations, events)
	}
}
