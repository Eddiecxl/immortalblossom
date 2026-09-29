param(
 [Parameter(Mandatory=$true)][string]$ReleaseRoot,
 [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root=(Resolve-Path -LiteralPath $ReleaseRoot).Path.TrimEnd('\')
$output=[IO.Path]::GetFullPath($OutputPath)
if ($output.StartsWith(($root+'\'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Output must be outside the release folder.' }
if ([IO.File]::Exists($output)) { throw "Output already exists: $output" }
if (-not [IO.Directory]::Exists([IO.Path]::GetDirectoryName($output))) { throw 'Output directory does not exist.' }
if ((Get-Content -LiteralPath (Join-Path $root 'version.json') -Raw | ConvertFrom-Json).version -notmatch '^4\.\d+\.\d+$') { throw 'Expected a Beta 4 full package.' }

$included=[Collections.Generic.List[IO.FileInfo]]::new()
foreach ($file in Get-ChildItem -LiteralPath $root -File -Force) { if ($file.Name -ne 'SHA256SUMS.txt') { $included.Add($file) } }
foreach ($name in @('game','launcher','Licenses','repair','runtime','Source','docs')) {
 foreach ($file in Get-ChildItem -LiteralPath (Join-Path $root $name) -File -Recurse -Force) { $included.Add($file) }
}
foreach ($name in @('Patches\README.txt','Updates\README.txt')) { $included.Add([IO.FileInfo]::new((Join-Path $root $name))) }
$files=@($included | Sort-Object FullName)
$prefix='Luoxian Beta v4/'
$lines=@(foreach ($file in $files) {
 $relative=$file.FullName.Substring($root.Length+1).Replace('\','/')
 if ($relative -match '(^|/)(Saves|credentials|userdata|profiles|Applied)(/|$)') { throw "User data is not part of the package: $relative" }
 '{0}  {1}' -f (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant(),$relative
})
[IO.File]::WriteAllLines((Join-Path $root 'SHA256SUMS.txt'),$lines,[Text.UTF8Encoding]::new($false))
$included.Add([IO.FileInfo]::new((Join-Path $root 'SHA256SUMS.txt')))
$files=@($included | Sort-Object FullName)
$archive=[IO.Compression.ZipFile]::Open($output,[IO.Compression.ZipArchiveMode]::Create)
try {
 foreach ($file in $files) {
  $entry=$archive.CreateEntry(($prefix+$file.FullName.Substring($root.Length+1).Replace('\','/')),[IO.Compression.CompressionLevel]::Optimal)
  $entry.LastWriteTime=[DateTimeOffset]::new(1980,1,1,0,0,0,[TimeSpan]::Zero)
  $input=[IO.File]::OpenRead($file.FullName)
  $stream=$entry.Open()
  try { $input.CopyTo($stream) } finally { $stream.Dispose();$input.Dispose() }
 }
} finally { $archive.Dispose() }
Write-Output "Built $output with $($files.Count) files."
