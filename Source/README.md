# 后续维护

前端源码就是发行包内 `game/` 与 `launcher/` 的 HTML、CSS、JavaScript。

新原生启动器与更新器源码位于 `native/`。关闭游戏后，可在 Windows PowerShell 中运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\Source\native\build.ps1
powershell -ExecutionPolicy Bypass -File .\Source\native\test.ps1
```

发行包使用根目录已附带的 Microsoft WebView2 SDK DLL 编译，不需要 npm 或 Python。编译器使用 Windows .NET Framework 自带 `csc.exe`。

修改游戏后，运行 `Source/Rebuild-GameBaseline.ps1` 重建清单和修复包。未来发布者需要按版本更改该脚本的版本字符串。制作补丁时必须同时包含对应版本的游戏清单、游戏版本文件和修复包，详见 `native/README.md`。

根目录 `version.json` 是补丁安装匹配用的版本。Launcher 从 `game/version.json` 读取实际安装的精确版本；安装补丁后须校验版本与文件健康状态，再显示更新成功和当前版本。`game/version.json` 也保留世界服务内部版本及玩家可见的 `display_version`。更新游戏时同步修改 `Source/Rebuild-GameBaseline.ps1`、Launcher 游戏版本文案和公告；只更新 Launcher 时在“更新公告”列出改动。

当前完整包与文件夹统一为 Game Beta v4；根版本为 `4.1.2`。以后制作补丁时，把最新完整包 ZIP 作为 `Source/Build-AstraPatch.ps1` 的 `BaselineZip`，目标版本设为更高的 `4.x.y`。补丁只适用于与基线版本相同的安装。维护先读 docs/ACTUAL_PLAYTEST_V412.md 与 ENGINE_CONTRACT.md。

`RuntimeHost.exe` 是用户提供的 v2 原生服务重命名而来，源码未包含在原始资料中。本次没有伪造或重建其源码。
