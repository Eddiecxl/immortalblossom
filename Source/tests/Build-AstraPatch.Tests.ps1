$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Assert([bool]$condition, [string]$message) {
 if (-not $condition) { throw "FAIL: $message" }
 Write-Output "PASS: $message"
}
function Write-Text([string]$path, [string]$value) {
 [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)) | Out-Null
 [IO.File]::WriteAllText($path, $value, [Text.UTF8Encoding]::new($false))
}
function Hash([string]$path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('AstraPatchTests-' + [guid]::NewGuid().ToString('N'))
try {
 $old = Join-Path $scratch 'old'
 $new = Join-Path $scratch 'new'
 $out = Join-Path $scratch 'out'
 [IO.Directory]::CreateDirectory($out) | Out-Null
 Write-Text (Join-Path $old 'version.json') '{"version":"4.0.0"}'
 Write-Text (Join-Path $old 'game/changed.js') 'old'
 Write-Text (Join-Path $old 'game/unchanged.js') 'same'
 Write-Text (Join-Path $old 'launcher/index.html') 'old launcher'
 Write-Text (Join-Path $old 'repair/game.bundle.zip') 'old bundle'
 [IO.Compression.ZipFile]::CreateFromDirectory($old, (Join-Path $scratch 'baseline.zip'))
 Write-Text (Join-Path $new 'game/changed.js') 'new'
 Write-Text (Join-Path $new 'game/unchanged.js') 'same'
 Write-Text (Join-Path $new 'game/version.json') '{"version":"4.0.1"}'
 $files = @('changed.js','unchanged.js','version.json') | ForEach-Object {
  $p = Join-Path $new ('game/' + $_)
  [ordered]@{path=('game/' + $_);sha256=(Hash $p);size=([IO.FileInfo]$p).Length}
 }
 Write-Text (Join-Path $new 'game/manifest.json') ([ordered]@{version='4.0.1';files=$files} | ConvertTo-Json -Depth 5 -Compress)
 Write-Text (Join-Path $new 'launcher/index.html') 'new launcher'
 [IO.Directory]::CreateDirectory((Join-Path $new 'repair')) | Out-Null
 $bundle = [IO.Compression.ZipFile]::Open((Join-Path $new 'repair/game.bundle.zip'),[IO.Compression.ZipArchiveMode]::Create)
 try {
  foreach ($file in Get-ChildItem -LiteralPath (Join-Path $new 'game') -File) {
   [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($bundle,$file.FullName,('game/' + $file.Name)) | Out-Null
  }
 } finally { $bundle.Dispose() }

 $script = Join-Path $PSScriptRoot '../Build-AstraPatch.ps1'
 $built = @(& $script -ReleaseRoot $new -BaselineZip (Join-Path $scratch 'baseline.zip') -OutputDirectory $out -TargetVersion '4.0.1')
 Assert ($built.Count -eq 1) 'builder returns one patch path for the baseline version'
 $patches = @(Get-ChildItem -LiteralPath $out -Filter '*.lxpatch')
 Assert ($patches.Count -eq 1) 'creates a patch for the current full package'
 foreach ($patch in $patches) {
  $zip = [IO.Compression.ZipFile]::OpenRead($patch.FullName)
  try {
   $entry = $zip.GetEntry('manifest.json')
   Assert ($null -ne $entry) 'has patch manifest'
   $reader = [IO.StreamReader]::new($entry.Open())
   try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
   Assert ($manifest.toVersion -eq '4.0.1') 'targets requested version'
   Assert ($manifest.fromVersion -eq '4.0.0') 'uses full package base version'
   $names = @($manifest.files | ForEach-Object path)
   Assert ($names -contains 'game/changed.js') 'includes changed game file'
   Assert ($names -notcontains 'game/unchanged.js') 'omits unchanged game file'
   Assert ($names -contains 'game/manifest.json') 'includes game manifest'
   Assert ($names -contains 'game/version.json') 'includes game version'
   Assert ($names -contains 'repair/game.bundle.zip') 'includes repair bundle'
   Assert ($names -contains 'launcher/index.html') 'includes changed launcher file'
   Assert ($zip.Entries.Count -eq $names.Count + 1) 'has no unlisted entries'
   foreach ($file in $manifest.files) {
    $payload = $zip.GetEntry('payload/' + $file.path)
    Assert ($null -ne $payload) "contains $($file.path)"
    $stream = $payload.Open()
    try { $sha = [Security.Cryptography.SHA256]::Create(); try { $digest = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() } } finally { $stream.Dispose() }
    Assert ($digest -eq $file.sha256) "hash matches $($file.path)"
   }
  } finally { $zip.Dispose() }
 }
 $first = Hash $patches[0].FullName
 Remove-Item -LiteralPath $patches[0].FullName
 & $script -ReleaseRoot $new -BaselineZip (Join-Path $scratch 'baseline.zip') -OutputDirectory $out -TargetVersion '4.0.1'
 $rerun = @(Get-ChildItem -LiteralPath $out -Filter '*.lxpatch')
 Assert ((Hash $rerun[0].FullName) -eq $first) 'archives are reproducible'

 Write-Text (Join-Path $new 'version.json') '{"version":"4.0.0"}'
 $launcherBaseline = Join-Path $scratch 'launcher-baseline.zip'
 [IO.Compression.ZipFile]::CreateFromDirectory($new,$launcherBaseline)
 Write-Text (Join-Path $new 'launcher/index.html') 'launcher-only update'
 $launcherOut = Join-Path $scratch 'launcher-out'
 [IO.Directory]::CreateDirectory($launcherOut) | Out-Null
 & $script -ReleaseRoot $new -BaselineZip $launcherBaseline -OutputDirectory $launcherOut -TargetVersion '4.0.1' | Out-Null
 $launcherPatch = @(Get-ChildItem -LiteralPath $launcherOut -Filter '*.lxpatch')
 Assert ($launcherPatch.Count -eq 1) 'launcher-only update creates one patch'
 $launcherZip = [IO.Compression.ZipFile]::OpenRead($launcherPatch[0].FullName)
 try {
  $reader = [IO.StreamReader]::new($launcherZip.GetEntry('manifest.json').Open())
  try { $launcherManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  Assert (@($launcherManifest.files | ForEach-Object path).Count -eq 1 -and $launcherManifest.files[0].path -eq 'launcher/index.html') 'launcher-only patch omits game repair bundle'
 } finally { $launcherZip.Dispose() }
 Write-Output 'ALL ASTRA PATCH BUILDER TESTS PASSED'
} finally {
 $scratchRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
 if ((Test-Path -LiteralPath $scratch) -and [IO.Path]::GetFullPath($scratch).StartsWith($scratchRoot,[StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $scratch -Recurse -Force }
}
