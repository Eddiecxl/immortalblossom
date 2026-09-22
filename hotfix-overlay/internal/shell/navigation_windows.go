//go:build windows

package shell

import (
	"context"
	"time"
)

const launcherLoadingHTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>落仙 · 启程</title>
<style>
html,body{margin:0;width:100%;height:100%;background:#07090d;color:#e8edf5;font-family:"Segoe UI","Microsoft YaHei",sans-serif}
main{height:100%;display:grid;place-items:center}
.card{display:flex;align-items:center;gap:14px;padding:20px 24px;border:1px solid #202633;border-radius:14px;background:#0d1118;box-shadow:0 16px 50px rgba(0,0,0,.35)}
.dot{width:12px;height:12px;border-radius:50%;background:#8ab4ff;animation:pulse 1.1s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1.1)}}
small{display:block;color:#8d98aa;margin-top:4px}
</style></head><body><main><div class="card"><div class="dot"></div><div><strong>落仙正在启动</strong><small>正在连接本地启动器…</small></div></div></main></body></html>`

type navigationView interface {
	SetHtml(string)
	Dispatch(func())
	Navigate(string)
}

var launcherNavigationDelays = []time.Duration{
	100 * time.Millisecond,
	650 * time.Millisecond,
	1500 * time.Millisecond,
	3 * time.Second,
}

func startLauncherNavigation(ctx context.Context, view navigationView, url string, ready <-chan struct{}) {
	startLauncherNavigationWithDelays(ctx, view, url, ready, launcherNavigationDelays, 3*time.Second)
}

func startLauncherNavigationWithDelays(ctx context.Context, view navigationView, url string, ready <-chan struct{}, delays []time.Duration, repeat time.Duration) {
	view.SetHtml(launcherLoadingHTML)
	go func() {
		for _, delay := range delays {
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-ready:
				timer.Stop()
				return
			case <-timer.C:
			}
			select {
			case <-ctx.Done():
				return
			case <-ready:
				return
			default:
			}
			view.Dispatch(func() { view.Navigate(url) })
		}
		if repeat <= 0 {
			return
		}
		ticker := time.NewTicker(repeat)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ready:
				return
			case <-ticker.C:
				view.Dispatch(func() { view.Navigate(url) })
			}
		}
	}()
}
