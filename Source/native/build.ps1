$ErrorActionPreference = 'Stop'
$product = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$refs = @('/r:System.dll','/r:System.Core.dll','/r:System.Drawing.dll','/r:System.Windows.Forms.dll','/r:System.Web.Extensions.dll','/r:System.Management.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll')
& $compiler /nologo /target:exe /platform:x64 /optimize+ /out:"$product\Luoxian.Updater.exe" @refs "$PSScriptRoot\Patches.cs" "$PSScriptRoot\Updater.cs"
if ($LASTEXITCODE -ne 0) { throw 'Updater compilation failed.' }
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /win32manifest:"$product\app.manifest" /out:"$product\LuoXian.exe" @refs /r:"$product\Microsoft.Web.WebView2.Core.dll" /r:"$product\Microsoft.Web.WebView2.WinForms.dll" "$PSScriptRoot\Patches.cs" "$PSScriptRoot\RuntimeLifetime.cs" "$PSScriptRoot\ModelManager.cs" "$PSScriptRoot\WorldDatabase.cs" "$PSScriptRoot\Host.cs"
if ($LASTEXITCODE -ne 0) { throw 'Host compilation failed.' }
Write-Host 'Native host and updater built successfully.'
