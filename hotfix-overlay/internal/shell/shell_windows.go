//go:build windows

package shell

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"syscall"

	webview2 "github.com/jchv/go-webview2"
	"luoxianv26/internal/windowstate"
)

const (
	gwlStyle        = ^uintptr(15)
	wsCaption       = 0x00C00000
	wsSysMenu       = 0x00080000
	wsPopup         = 0x80000000
	wsThickFrame    = 0x00040000
	wsMinimizeBox   = 0x00020000
	wsMaximizeBox   = 0x00010000
	swMaximize      = 3
	swShow          = 5
	swMinimize      = 6
	swRestore       = 9
	swpNoZOrder     = 0x0004
	swpFrameChanged = 0x0020
	wmNCLButtonDown = 0x00A1
	htCaption       = 2
)

var (
	user32                        = syscall.NewLazyDLL("user32.dll")
	procSetProcessDPIAwareContext = user32.NewProc("SetProcessDpiAwarenessContext")
	procGetWindowLongW            = user32.NewProc("GetWindowLongW")
	procSetWindowLongW            = user32.NewProc("SetWindowLongW")
	procSetWindowPos              = user32.NewProc("SetWindowPos")
	procShowWindow                = user32.NewProc("ShowWindow")
	procIsZoomed                  = user32.NewProc("IsZoomed")
	procIsIconic                  = user32.NewProc("IsIconic")
	procReleaseCapture            = user32.NewProc("ReleaseCapture")
	procSendMessageW              = user32.NewProc("SendMessageW")
	procSetForegroundWindow       = user32.NewProc("SetForegroundWindow")
)

type nativeState struct {
	view webview2.WebView
	hwnd uintptr
}

func (host *Host) Activate() {
	if host.state == nil {
		return
	}
	host.state.view.Dispatch(func() {
		iconic, _, _ := procIsIconic.Call(host.state.hwnd)
		if iconic != 0 {
			_, _, _ = procShowWindow.Call(host.state.hwnd, swRestore)
		} else {
			_, _, _ = procShowWindow.Call(host.state.hwnd, swShow)
		}
		_, _, _ = procSetForegroundWindow.Call(host.state.hwnd)
	})
}

func (host *Host) openNative(ctx context.Context, url string) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	_, _, _ = procSetProcessDPIAwareContext.Call(^uintptr(3))
	dataPath := host.options.DataPath
	if dataPath == "" {
		dataPath = filepath.Join(os.Getenv("LOCALAPPDATA"), "LuoXian", "browser-profile")
	}
	if err := os.MkdirAll(dataPath, 0o700); err != nil {
		return err
	}
	view := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug: host.options.Debug, AutoFocus: true, DataPath: dataPath,
		WindowOptions: webview2.WindowOptions{Title: host.options.Title, Width: 1600, Height: 900, Center: true},
	})
	if view == nil {
		return errors.New("WebView2 runtime is unavailable")
	}
	defer view.Destroy()
	host.state = &nativeState{view: view, hwnd: uintptr(view.Window())}
	host.makeFrameless()
	if err := view.Bind("nativeAction", func(value string) error { return host.handleCommand(value) }); err != nil {
		return err
	}
	view.Init(`document.addEventListener('dragstart',function(e){if(e.target&&e.target.tagName==='IMG')e.preventDefault()});`)
	view.Navigate(url)
	host.maximizeWindow()
	go func() {
		<-ctx.Done()
		view.Terminate()
	}()
	view.Run()
	return nil
}

func (host *Host) makeFrameless() {
	style, _, _ := procGetWindowLongW.Call(host.state.hwnd, gwlStyle)
	style &^= wsCaption | wsSysMenu
	style |= wsPopup | wsThickFrame | wsMinimizeBox | wsMaximizeBox
	_, _, _ = procSetWindowLongW.Call(host.state.hwnd, gwlStyle, style)
	_, _, _ = procSetWindowPos.Call(host.state.hwnd, 0, 0, 0, 0, 0, swpNoZOrder|swpFrameChanged)
}

func (host *Host) handleCommand(value string) error {
	command, err := ParseCommand(value)
	if err != nil {
		return err
	}
	switch command {
	case CommandMinimize:
		_, _, _ = procShowWindow.Call(host.state.hwnd, swMinimize)
	case CommandMaximize:
		host.toggleMaximize()
	case CommandClose:
		if host.options.OnClose != nil {
			host.options.OnClose()
		}
		host.state.view.Terminate()
	case CommandDrag:
		_, _, _ = procReleaseCapture.Call()
		_, _, _ = procSendMessageW.Call(host.state.hwnd, wmNCLButtonDown, htCaption, 0)
	case CommandOpenUpdates:
		if host.options.OpenUpdates != nil {
			return host.options.OpenUpdates()
		}
	case CommandOpenSave:
		if host.options.OpenSave != nil {
			return host.options.OpenSave()
		}
	case CommandScanUpdates:
		if host.options.ScanUpdates != nil {
			return host.options.ScanUpdates()
		}
	}
	return nil
}

func (host *Host) maximizeWindow() {
	if host.state == nil {
		return
	}
	_, _, _ = procShowWindow.Call(host.state.hwnd, swMaximize)
}

func (host *Host) toggleMaximize() {
	if host.state == nil {
		return
	}
	zoomed, _, _ := procIsZoomed.Call(host.state.hwnd)
	switch windowstate.Toggle(zoomed != 0) {
	case windowstate.Restore:
		_, _, _ = procShowWindow.Call(host.state.hwnd, swRestore)
	case windowstate.Maximize:
		_, _, _ = procShowWindow.Call(host.state.hwnd, swMaximize)
	}
}
