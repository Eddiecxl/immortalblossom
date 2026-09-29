param(
 [Parameter(Mandatory=$true)][string]$ReleaseRoot,
 [Parameter(Mandatory=$true)][string]$BaselineZip,
 [Parameter(Mandatory=$true)][string]$OutputDirectory,
 [Parameter(Mandatory=$true)][string]$TargetVersion
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Fail([string]$message) { throw $message }
function CheckNoReparse([string]$path) {
 $part = [IO.Path]::GetFullPath($path)
 while (-not [string]::IsNullOrEmpty($part)) {
  if (([IO.File]::Exists($part) -or [IO.Directory]::Exists($part)) -and (([IO.File]::GetAttributes($part) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { Fail "Reparse point is not allowed: $part" }
  $parent = [IO.Path]::GetDirectoryName($part)
  if ($parent -eq $part) { break }
  $part = $parent
 }
}
function ShaStream([IO.Stream]$stream) {
 $sha = [Security.Cryptography.SHA256]::Create()
 try { [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
}
function ShaFile([string]$path) {
 $stream = [IO.File]::OpenRead($path)
 try { ShaStream $stream } finally { $stream.Dispose() }
}
function ShaEntry([IO.Compression.ZipArchiveEntry]$entry) {
 $stream = $entry.Open()
 try { ShaStream $stream } finally { $stream.Dispose() }
}
function CheckPath([string]$relative) {
 if ([string]::IsNullOrEmpty($relative) -or $relative.Length -gt 220 -or $relative.Contains('\') -or $relative.Contains(':') -or $relative.StartsWith('/')) { Fail "Unsafe patch path: $relative" }
 foreach ($part in $relative.Split('/')) {
  if ($part -in @('', '.', '..') -or $part.EndsWith('.') -or $part.EndsWith(' ') -or $part -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)' -or $part.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) { Fail "Unsafe patch path: $relative" }
  if ($part -in @('saves','save','credentials','userdata','profiles')) { Fail "User data path cannot be patched: $relative" }
 }
 $nativeFiles=@('LuoXian.exe','LuoXian.exe.config','RuntimeHost.exe','Luoxian.Updater.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll')
 if (-not ($relative.StartsWith('game/',[StringComparison]::OrdinalIgnoreCase) -or $relative.StartsWith('launcher/',[StringComparison]::OrdinalIgnoreCase) -or $relative -ieq 'repair/game.bundle.zip' -or $relative -in $nativeFiles)) { Fail "Path outside patch allowlist: $relative" }
}
function ReleaseFile([string]$relative) {
 CheckPath $relative
 $path = [IO.Path]::GetFullPath((Join-Path $release $relative))
 if (-not $path.StartsWith(($release.TrimEnd('\') + '\'),[StringComparison]::OrdinalIgnoreCase)) { Fail "Path escaped release: $relative" }
 if (-not [IO.File]::Exists($path)) { Fail "Missing release file: $relative" }
 CheckNoReparse $path
 return $path
}
function AddZipFile([IO.Compression.ZipArchive]$archive,[string]$name,[string]$path) {
 $entry = $archive.CreateEntry($name,[IO.Compression.CompressionLevel]::Optimal)
 $entry.LastWriteTime = [DateTimeOffset]::new(1980,1,1,0,0,0,[TimeSpan]::Zero)
 $input = [IO.File]::OpenRead($path)
 $output = $entry.Open()
 try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
}
function AddZipText([IO.Compression.ZipArchive]$archive,[string]$name,[string]$content) {
 $entry = $archive.CreateEntry($name,[IO.Compression.CompressionLevel]::Optimal)
 $entry.LastWriteTime = [DateTimeOffset]::new(1980,1,1,0,0,0,[TimeSpan]::Zero)
 $writer = [IO.StreamWriter]::new($entry.Open(),[Text.UTF8Encoding]::new($false))
 try { $writer.Write($content) } finally { $writer.Dispose() }
}
function ReadEntryText([IO.Compression.ZipArchiveEntry]$entry) {
 $reader = [IO.StreamReader]::new($entry.Open())
 try { $reader.ReadToEnd() } finally { $reader.Dispose() }
}

$release = (Resolve-Path -LiteralPath $ReleaseRoot).Path.TrimEnd('\')
$baseline = (Resolve-Path -LiteralPath $BaselineZip).Path
$output = [IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\')
if (-not [IO.Directory]::Exists($output)) { Fail "Output directory does not exist: $output" }
if ($output -ieq $release -or $output.StartsWith(($release + '\'),[StringComparison]::OrdinalIgnoreCase)) { Fail 'Output directory must be outside the release installation.' }
CheckNoReparse $release
CheckNoReparse $baseline
CheckNoReparse $output
if ($TargetVersion -notmatch '^4\.\d+\.\d+$') { Fail 'TargetVersion must be a Beta 4 version.' }
$baselineHash = ShaFile $baseline
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('AstraPatchBuild-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($scratch) | Out-Null
$outputs = @()
try {
 $baseArchive = [IO.Compression.ZipFile]::OpenRead($baseline)
 try {
  $roots = @($baseArchive.Entries | Where-Object { $name = $_.FullName.Replace('\','/'); $name -match '(^|/)version\.json$' -and $name -notmatch '(^|/)(game|runtime)/version\.json$' } | Sort-Object { $_.FullName.Length })
  if ($roots.Count -ne 1) { Fail 'Baseline ZIP must have one root version.json.' }
  $rootName = $roots[0].FullName.Replace('\','/')
  $prefix = $rootName.Substring(0,$rootName.Length - 'version.json'.Length)
  $baseVersion = (ReadEntryText $roots[0] | ConvertFrom-Json).version
  if ($baseVersion -notmatch '^4\.\d+\.\d+$' -or [version]$TargetVersion -le [version]$baseVersion) { Fail "Target version $TargetVersion must be newer than baseline $baseVersion." }
  $baseEntries = [Collections.Generic.Dictionary[string,IO.Compression.ZipArchiveEntry]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in $baseArchive.Entries) {
   $entryName = $entry.FullName.Replace('\','/')
   if (-not $entryName.StartsWith($prefix,[StringComparison]::Ordinal)) { continue }
   $relative = $entryName.Substring($prefix.Length)
   if ($relative -eq '' -or $relative.EndsWith('/')) { continue }
   if ($baseEntries.ContainsKey($relative)) { Fail "Duplicate baseline ZIP entry: $relative" }
   $baseEntries.Add($relative,$entry)
  }
  $gameRoot = Join-Path $release 'game'
  if (-not [IO.Directory]::Exists($gameRoot)) { Fail 'Release game directory is missing.' }
  $gameFiles = @(Get-ChildItem -LiteralPath $gameRoot -File -Recurse -Force | ForEach-Object { $_.FullName.Substring($release.Length + 1).Replace('\','/') } | Sort-Object -CaseSensitive)
  $gameManifestPath = ReleaseFile 'game/manifest.json'
  $gameVersionPath = ReleaseFile 'game/version.json'
  $bundlePath = ReleaseFile 'repair/game.bundle.zip'
  $gameManifest = Get-Content -LiteralPath $gameManifestPath -Raw | ConvertFrom-Json
  $gameVersion = Get-Content -LiteralPath $gameVersionPath -Raw | ConvertFrom-Json
  if ($gameManifest.version -ne $gameVersion.version) { Fail 'Game manifest and game version disagree.' }
  $listedGame = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($record in $gameManifest.files) {
   $path = [string]$record.path
   if (-not $path.StartsWith('game/',[StringComparison]::OrdinalIgnoreCase) -or $path -ieq 'game/manifest.json') { Fail "Invalid game manifest path: $path" }
   if (-not $listedGame.Add($path)) { Fail "Duplicate game manifest path: $path" }
   $source = ReleaseFile $path
   if ((ShaFile $source) -ne [string]$record.sha256 -or ([IO.FileInfo]$source).Length -ne [long]$record.size) { Fail "Game manifest mismatch: $path" }
  }
  foreach ($path in $gameFiles) { if ($path -ine 'game/manifest.json' -and -not $listedGame.Contains($path)) { Fail "Unlisted game file: $path" } }
  if ($listedGame.Count -ne ($gameFiles.Count - 1)) { Fail 'Game manifest has extra entries.' }
  $bundle = [IO.Compression.ZipFile]::OpenRead($bundlePath)
  try {
   $bundleNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
   foreach ($entry in $bundle.Entries) {
    if ($entry.FullName.EndsWith('/')) { continue }
    if (-not $bundleNames.Add($entry.FullName) -or $entry.FullName -notin $gameFiles) { Fail "Unexpected repair bundle entry: $($entry.FullName)" }
    if ((ShaEntry $entry) -ne (ShaFile (ReleaseFile $entry.FullName))) { Fail "Repair bundle hash mismatch: $($entry.FullName)" }
   }
   if ($bundleNames.Count -ne $gameFiles.Count) { Fail 'Repair bundle is missing game files.' }
  } finally { $bundle.Dispose() }
  $candidates = [Collections.Generic.List[string]]::new()
  foreach ($path in $gameFiles) { $candidates.Add($path) }
  $launcherRoot = Join-Path $release 'launcher'
  if ([IO.Directory]::Exists($launcherRoot)) {
   foreach ($file in Get-ChildItem -LiteralPath $launcherRoot -File -Recurse -Force) { $candidates.Add($file.FullName.Substring($release.Length + 1).Replace('\','/')) }
  }
  foreach ($name in @('LuoXian.exe','LuoXian.exe.config','RuntimeHost.exe','Luoxian.Updater.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll')) {
   if ([IO.File]::Exists((Join-Path $release $name))) { $candidates.Add($name) }
  }
  $changed = [Collections.Generic.List[string]]::new()
  foreach ($path in $candidates) {
   $source = ReleaseFile $path
   if (-not $baseEntries.ContainsKey($path) -or (ShaFile $source) -ne (ShaEntry $baseEntries[$path])) { $changed.Add($path) }
  }
  if (@($changed | Where-Object { $_.StartsWith('game/',[StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) {
   foreach ($required in @('game/manifest.json','game/version.json','repair/game.bundle.zip')) { if (-not $changed.Contains($required)) { $changed.Add($required) } }
  }
  $ordered = @($changed | Sort-Object -Unique -CaseSensitive)
  if ($ordered.Count -gt 5000) { Fail 'Patch exceeds native file count limit.' }
  $total = [long]0
  $records = @($ordered | ForEach-Object {
   $source = ReleaseFile $_
   $size = ([IO.FileInfo]$source).Length
   if ($size -gt 512MB) { Fail "Patch file exceeds native size limit: $_" }
   $total += $size
   [ordered]@{path=$_;sha256=(ShaFile $source)}
  })
  if ($total -gt 1GB) { Fail 'Patch exceeds native total size limit.' }
  foreach ($from in @($baseVersion)) {
   $name = "Luoxian-Update-$from-to-$TargetVersion.lxpatch"
   $destination = Join-Path $output $name
   if ([IO.File]::Exists($destination)) { Fail "Output already exists: $destination" }
   $tempPatch = Join-Path $scratch $name
   $manifest = [ordered]@{format='luoxian-beta4-patch-1';fromVersion=$from;toVersion=$TargetVersion;files=$records} | ConvertTo-Json -Depth 5 -Compress
   $archive = [IO.Compression.ZipFile]::Open($tempPatch,[IO.Compression.ZipArchiveMode]::Create)
   try {
    AddZipText $archive 'manifest.json' $manifest
    foreach ($record in $records) { AddZipFile $archive ('payload/' + $record.path) (ReleaseFile $record.path) }
   } finally { $archive.Dispose() }
   $outputs += [pscustomobject]@{from=$from;path=$destination;temp=$tempPatch}
  }
   $compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
   if (-not [IO.File]::Exists($compiler)) { Fail 'Native .NET Framework compiler is unavailable.' }
   $probe = Join-Path $scratch 'PatchProbe.exe'
   & $compiler /nologo /target:exe /out:$probe /r:System.dll /r:System.Core.dll /r:System.Web.Extensions.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll (Join-Path $PSScriptRoot 'native/Patches.cs') (Join-Path $PSScriptRoot 'tests/PatchProbe.cs')
   if ($LASTEXITCODE -ne 0) { Fail 'Native patch probe compilation failed.' }
   foreach ($result in $outputs) {
    $install = Join-Path $scratch ('install-' + $result.from)
    [IO.Directory]::CreateDirectory($install) | Out-Null
    foreach ($record in $records) {
     if (-not $baseEntries.ContainsKey($record.path)) { continue }
     $dest = Join-Path $install $record.path
     [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest)) | Out-Null
     $input = $baseEntries[$record.path].Open(); $outputStream = [IO.File]::Create($dest)
     try { $input.CopyTo($outputStream) } finally { $outputStream.Dispose(); $input.Dispose() }
    }
    [IO.File]::WriteAllText((Join-Path $install 'version.json'),('{"version":"' + $result.from + '"}'))
    [IO.Directory]::CreateDirectory((Join-Path $install 'Saves')) | Out-Null
    [IO.File]::WriteAllText((Join-Path $install 'Saves/sentinel.txt'),'keep-this-save')
    $probeOutput = @(& $probe $result.temp $install $TargetVersion)
    if ($LASTEXITCODE -ne 0) { Fail "Native patch validation/application failed for $($result.from)." }
    foreach ($line in $probeOutput) { Write-Host $line }
   }
  if ((ShaFile $baseline) -ne $baselineHash) { Fail 'Baseline ZIP changed during build.' }
  foreach ($result in $outputs) { [IO.File]::Move($result.temp,$result.path); Write-Output $result.path }
 } finally { $baseArchive.Dispose() }
} finally {
 $scratchRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
 if ([IO.Directory]::Exists($scratch) -and [IO.Path]::GetFullPath($scratch).StartsWith($scratchRoot,[StringComparison]::OrdinalIgnoreCase)) { [IO.Directory]::Delete($scratch,$true) }
}
