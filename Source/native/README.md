# Native Game Beta v4 shell

Build with `powershell -File Source/native/build.ps1`; run `test.ps1` for patch validation and transactional rollback tests. Uses the Microsoft WebView2 SDK under `the release root (bundled DLLs)`, .NET Framework 4.7.2+, Windows x64 and the installed Edge WebView2 Runtime.

`LuoXian.exe` owns the hidden `RuntimeHost.exe` child. It refuses a preoccupied localhost port 24824. The launcher loads `/launcher/`; a separate game window loads `/game/v4/`. The launcher minimizes after the game document successfully loads and restores on game close. F11 and Alt+Enter toggle borderless fullscreen. UI storage keeps the existing `%LOCALAPPDATA%/LuoxianBeta3/WebView2` path so user settings and saves remain accessible.

The injected bridge exposes `window.lxNative=true` and `nativeAction(action,payload):Promise`. Supported actions: `launch-game` (`{settings:true}` optional), `minimize`, `maximize`, `close`, `window-settings` (`{mode,width,height}`), `open-patches`, `scan-patches`, `apply-patches` (`{name}`). Mode values are `windowed`, `borderless`, `fullscreen`; fullscreen is borderless display fullscreen, not exclusive DirectX fullscreen. Scan returns `{version,patches:[{name,valid,fromVersion,toVersion,error}]}`. Opening settings on an existing game dispatches `lx-open-settings`.

Patch application validates before shutting down. A copied updater waits for the owning host and runtime, then updates unlocked application files and restarts. Manifest version controls belong to root `version.json`. Runtime models and user data are deliberately outside the Beta v4 patch allowlist. Patches are hash checked, not cryptographically publisher signed; install trusted patches only. File replacement is atomic per file with rollback on caught failures; there is no power-loss transaction recovery guarantee. Failed rollback preserves its `.patch-*` backup.

To build a patch, place changed files under a payload directory mirroring allowed install paths, then run `New-Patch.ps1 -PayloadDirectory <folder> -FromVersion 4.0.0 -ToVersion 4.0.1 -OutputPath <patch.lxpatch>`. No model copies are needed. Every game-content patch must also rebuild and include `game/manifest.json`, `game/version.json`, and `repair/game.bundle.zip` so integrity checks and repair use the new baseline. The exact repair bundle is allowed; arbitrary repair paths and the entire runtime directory are denied. Launcher/native-only patches need no game manifest changes. Root version advancement is handled by the updater.

`LuoXian.exe --smoke-test <absolute-log-path>` exercises actual page load, bridge, separate game opening, launcher minimize, fullscreen/windowed changes, game close, launcher restore, and owned runtime cleanup. It does not request AI generation.


## Beta v4 天阙 display host

The build embeds root `app.manifest`, declaring Windows 10 compatibility. `LuoXian.exe.config` opts .NET Framework into `PerMonitorV2` before any controls exist. This follows Microsoft's .NET Framework guidance: DPI awareness belongs in application configuration rather than conflicting manifest DPI flags. The assembly targets .NET Framework 4.7.2.

Display requests use logical client pixels. `window-settings` and `window-status` return `{mode,width,height,scaleFactor,physicalWidth,physicalHeight,requestedWidth,requestedHeight,clamped,maximized}`. The dimensions describe the actual client area after applying monitor/work-area limits, including the native title bar and borders. `scaleFactor` comes from `GetDpiForWindow`; measured native chrome avoids stale Framework DPI values while moving between monitors. `lx:display-changed` is a DOM custom event whose `detail` has the same state after native resize, DPI transition, mode change, or shortcuts. `borderless` and `fullscreen` both use monitor-sized borderless windows.

The host creates the documented CoreWebView2 controller inside a native Control, allowing direct `AcceleratorKeyPressed` handling of F11 and Alt+Enter, including repeat filtering. Bounds, focus, visibility, parent movement, and controller disposal follow the native window lifecycle. Existing `%LOCALAPPDATA%/LuoxianBeta3/WebView2` storage, mutex, port, runtime ownership, and launcher/game separation remain compatible with Beta 3.

The expanded `--smoke-test` verifies actual browser/native client dimensions, DPI thread awareness, status replies and events, exact fullscreen restore, oversize clamping, native accelerator delivery, each available monitor's DPI, and launcher/game/runtime lifecycle. It refuses existing instances and never terminates unrelated user processes. No AI requests are made.

References: https://learn.microsoft.com/en-us/dotnet/desktop/winforms/high-dpi-support-in-windows-forms and https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2controller.acceleratorkeypressed
