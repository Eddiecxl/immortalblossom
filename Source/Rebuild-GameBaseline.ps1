$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$utf8=New-Object Text.UTF8Encoding($false)
$releaseVersion=(Get-Content -LiteralPath (Join-Path $root 'version.json') -Raw | ConvertFrom-Json).version
if($releaseVersion -notmatch '^4\.\d+\.\d+$'){throw 'Expected a Beta 4 release version.'}
$version=@{version=$releaseVersion;launcher_min='7.2.0';save_schema=6;edition='beta-v4-astra-world';display_version='Game Beta v4'}
[IO.File]::WriteAllText((Join-Path $root 'game\version.json'),($version|ConvertTo-Json -Compress),$utf8)
$files=@(Get-ChildItem -LiteralPath (Join-Path $root 'game') -File -Recurse | Where-Object Name -ne 'manifest.json' | Sort-Object FullName | ForEach-Object {
 @{path=$_.FullName.Substring($root.Length+1).Replace('\','/');sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant();size=$_.Length}
})
[IO.File]::WriteAllText((Join-Path $root 'game\manifest.json'),(@{version=$releaseVersion;display_version='Game Beta v4';files=$files}|ConvertTo-Json -Depth 6 -Compress),$utf8)
$bundlePath=Join-Path $root 'repair\game.bundle.zip'
# File replacement is confined to this release's exact repair artifact.
if(Test-Path -LiteralPath $bundlePath){Remove-Item -LiteralPath $bundlePath}
$zip=[IO.Compression.ZipFile]::Open($bundlePath,[IO.Compression.ZipArchiveMode]::Create)
try {Get-ChildItem -LiteralPath (Join-Path $root 'game') -File -Recurse | ForEach-Object {
 [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$_.FullName,$_.FullName.Substring($root.Length+1).Replace('\','/'),[IO.Compression.CompressionLevel]::Optimal)|Out-Null
}}finally{$zip.Dispose()}
Write-Host "Rebuilt $($files.Count) manifest entries and Beta v4 repair bundle."
