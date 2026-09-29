param(
 [Parameter(Mandatory=$true)][string]$PayloadDirectory,
 [Parameter(Mandatory=$true)][string]$FromVersion,
 [Parameter(Mandatory=$true)][string]$ToVersion,
 [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$payloadRoot = (Resolve-Path -LiteralPath $PayloadDirectory).Path.TrimEnd('\')
$outputFile = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $outputFile) { throw 'Output already exists.' }
if ($FromVersion -notmatch '^4\.\d+\.\d+$' -or $ToVersion -notmatch '^4\.\d+\.\d+$' -or [version]$ToVersion -le [version]$FromVersion) { throw 'Expected increasing Beta 4 semantic versions.' }
$records = @(Get-ChildItem -LiteralPath $payloadRoot -File -Recurse | ForEach-Object {
 if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse points are not supported.' }
 $relative = $_.FullName.Substring($payloadRoot.Length + 1).Replace('\','/')
 [ordered]@{ path=$relative; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
if (!$records.Count) { throw 'Payload is empty.' }
$manifest = [ordered]@{ format='luoxian-beta4-patch-1'; fromVersion=$FromVersion; toVersion=$ToVersion; files=$records }
$archive = [IO.Compression.ZipFile]::Open($outputFile,[IO.Compression.ZipArchiveMode]::Create)
try {
 $entry = $archive.CreateEntry('manifest.json')
 $writer = [IO.StreamWriter]::new($entry.Open(),[Text.UTF8Encoding]::new($false))
 try { $writer.Write(($manifest | ConvertTo-Json -Depth 5)) } finally { $writer.Dispose() }
 foreach ($record in $records) {
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,(Join-Path $payloadRoot $record.path),('payload/' + $record.path),[IO.Compression.CompressionLevel]::Optimal) | Out-Null
 }
} finally { $archive.Dispose() }
Write-Output $outputFile
