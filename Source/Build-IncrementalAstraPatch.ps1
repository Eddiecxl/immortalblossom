param(
 [Parameter(Mandatory=$true)][string]$PreviousPatch,
 [Parameter(Mandatory=$true)][string]$TargetPatch,
 [Parameter(Mandatory=$true)][string]$BaselineZip,
 [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
function ReadJsonEntry($zip,$name){
 $entry=$zip.GetEntry($name)
 if(!$entry){throw "Missing entry: $name"}
 $reader=[IO.StreamReader]::new($entry.Open())
 try{$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
}
function CopyEntry($entry,[string]$path){
 if(!$entry){throw "Missing payload for $path"}
 [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path))|Out-Null
 $inputStream=$entry.Open();$outputStream=[IO.File]::Create($path)
 try{$inputStream.CopyTo($outputStream)}finally{$outputStream.Dispose();$inputStream.Dispose()}
}
$stageParent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
$stage=[IO.Path]::GetFullPath((Join-Path $stageParent ('Luoxian-incremental-'+[guid]::NewGuid().ToString('N'))))
if(!$stage.StartsWith($stageParent,[StringComparison]::OrdinalIgnoreCase)){throw 'Stage outside temporary directory'}
[IO.Directory]::CreateDirectory($stage)|Out-Null
$oldZip=$null;$newZip=$null;$baseZip=$null
try{
 $oldZip=[IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($PreviousPatch))
 $newZip=[IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($TargetPatch))
 $baseZip=[IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($BaselineZip))
 $old=ReadJsonEntry $oldZip 'manifest.json';$new=ReadJsonEntry $newZip 'manifest.json'
 if($old.fromVersion-ne$new.fromVersion-or[version]$new.toVersion-le[version]$old.toVersion){throw 'Incompatible patch lineage'}
 $baseRoot=@($baseZip.Entries|Where-Object{$_.FullName-match'^(?:[^/]+/)?version.json$'})
 if($baseRoot.Count-ne1){throw 'Baseline root version is ambiguous'}
 $prefix=$baseRoot[0].FullName.Substring(0,$baseRoot[0].FullName.Length-'version.json'.Length)
 if((ReadJsonEntry $baseZip $baseRoot[0].FullName).version-ne$old.fromVersion){throw 'Baseline does not match patch lineage'}
 $hashes=@{};foreach($record in $old.files){$hashes[$record.path]=$record.sha256}
 $payload=Join-Path $stage 'payload';$install=Join-Path $stage 'install'
 [IO.Directory]::CreateDirectory($payload)|Out-Null
 [IO.Directory]::CreateDirectory($install)|Out-Null
 foreach($record in $new.files){
  if($hashes[$record.path]-eq$record.sha256){continue}
  # Bound extraction to the temporary stage; the native probe validates the
  # finished patch against the production allowlist and applies it below.
  $path=[string]$record.path
  if($path.Contains('\')-or$path.Contains(':')-or$path.StartsWith('/')-or$path.Split('/')-contains'..'){throw 'Unsafe patch member'}
  CopyEntry ($newZip.GetEntry('payload/'+$path)) (Join-Path $payload $path)
  if((Get-FileHash -LiteralPath (Join-Path $payload $path) -Algorithm SHA256).Hash.ToLowerInvariant()-ne$record.sha256){throw 'Target payload hash mismatch'}
  $previous=$oldZip.GetEntry('payload/'+$path)
  if(!$previous){$previous=$baseZip.GetEntry($prefix+$path)}
  if($previous){CopyEntry $previous (Join-Path $install $path)}
 }
 [IO.Directory]::CreateDirectory((Join-Path $install 'Saves'))|Out-Null
 [IO.File]::WriteAllText((Join-Path $install 'version.json'),('{"version":"'+$old.toVersion+'"}'))
 [IO.File]::WriteAllText((Join-Path $install 'Saves/sentinel.txt'),'keep-this-save')
 & (Join-Path $PSScriptRoot 'native/New-Patch.ps1') -PayloadDirectory $payload -FromVersion $old.toVersion -ToVersion $new.toVersion -OutputPath $OutputPath
 $probe=Join-Path $stage 'PatchProbe.exe'
 $compiler='C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
 & $compiler /nologo /target:exe /out:$probe /r:System.dll /r:System.Core.dll /r:System.Web.Extensions.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll (Join-Path $PSScriptRoot 'native/Patches.cs') (Join-Path $PSScriptRoot 'tests/PatchProbe.cs')
 if($LASTEXITCODE-ne0){throw 'Probe compilation failed'}
 & $probe ([IO.Path]::GetFullPath($OutputPath)) $install $new.toVersion
 if($LASTEXITCODE-ne0){throw 'Incremental native Validate/Apply failed'}
 $sha=(Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
 [IO.File]::WriteAllText(([IO.Path]::GetFullPath($OutputPath)+'.sha256'),($sha+'  '+[IO.Path]::GetFileName($OutputPath)))
}finally{
 if($baseZip){$baseZip.Dispose()};if($newZip){$newZip.Dispose()};if($oldZip){$oldZip.Dispose()}
 $resolvedStage=[IO.Path]::GetFullPath($stage)
 if($resolvedStage.StartsWith($stageParent,[StringComparison]::OrdinalIgnoreCase)-and[IO.Directory]::Exists($resolvedStage)){
  Remove-Item -LiteralPath $resolvedStage -Recurse -Force
 }
}
