param([Parameter(Mandatory=$true)][string]$ZipPath,[Parameter(Mandatory=$true)][string]$ReportPath)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$path=(Resolve-Path -LiteralPath $ZipPath).Path
$prefix='Luoxian Beta v4/'
$archive=[IO.Compression.ZipFile]::OpenRead($path)
function ReadText($entry){
 $reader=[IO.StreamReader]::new($entry.Open())
 try{$reader.ReadToEnd()}finally{$reader.Dispose()}
}
function EntryHash($entry){
 $stream=$entry.Open();$algorithm=[Security.Cryptography.SHA256]::Create()
 try{[BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
 finally{$stream.Dispose();$algorithm.Dispose()}
}
try{
 $sums=$archive.GetEntry($prefix+'SHA256SUMS.txt')
 if(-not $sums){throw 'Package checksum list is missing.'}
 $expected=[Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
 foreach($line in (ReadText $sums).Split("`n")){
  if(-not $line.Trim()){continue}
  if($line.TrimEnd("`r") -notmatch '^([a-f0-9]{64})  (.+)$'){throw 'Invalid checksum record.'}
  $expected.Add($Matches[2],$Matches[1])
 }
 $actual=[Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
 foreach($entry in $archive.Entries){
  if(-not $entry.FullName.StartsWith($prefix,[StringComparison]::Ordinal)){throw 'Unexpected package root.'}
  $relative=$entry.FullName.Substring($prefix.Length)
  if($relative -match '(^|/)(Saves|credentials|userdata|profiles|Applied|\.git)(/|$)' -or $relative.Contains('..') -or $relative.Contains('\')){throw "Unexpected data/path: $relative"}
  if($relative -eq 'SHA256SUMS.txt'){continue}
  if(-not $expected.ContainsKey($relative)){throw "Unlisted package file: $relative"}
  $hash=EntryHash $entry
  if($hash -ne $expected[$relative]){throw "Checksum mismatch: $relative"}
  $actual.Add($relative,$hash)
 }
 if($actual.Count -ne $expected.Count){throw 'Package files missing from checksum list.'}
 $rootVersion=(ReadText ($archive.GetEntry($prefix+'version.json'))|ConvertFrom-Json).version
 $gameVersion=(ReadText ($archive.GetEntry($prefix+'game/version.json'))|ConvertFrom-Json).version
 $manifest=ReadText ($archive.GetEntry($prefix+'game/manifest.json'))|ConvertFrom-Json
 if($rootVersion -ne $gameVersion -or $rootVersion -ne $manifest.version){throw 'Package versions disagree.'}
 foreach($file in $manifest.files){
  $entry=$archive.GetEntry($prefix+$file.path)
  if(-not $entry -or $entry.Length -ne $file.size -or $actual[$file.path] -ne $file.sha256){throw "Game manifest mismatch: $($file.path)"}
 }
 $gameCount=@($actual.Keys|Where-Object {$_ -like 'game/*' -and $_ -ne 'game/manifest.json'}).Count
 if($gameCount -ne $manifest.files.Count){throw 'Game contains files outside its repair manifest.'}
}finally{$archive.Dispose()}
$report=[ordered]@{version=$rootVersion;verifiedFiles=$actual.Count+1;gameFiles=$gameCount;bytes=(Get-Item -LiteralPath $path).Length;
 containsPlayerData=$false;result='PASS';sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($ReportPath),($report|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$report|ConvertTo-Json -Compress
