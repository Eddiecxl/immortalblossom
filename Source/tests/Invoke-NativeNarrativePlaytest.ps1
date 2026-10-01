param([Parameter(Mandatory=$true)][string]$ReleaseRoot,[Parameter(Mandatory=$true)][string]$OutputRoot,[string]$Seed='native-playtest-0',[switch]$TravelOnly,[ValidateSet('normal','unusual','delivery-accept','delivery-decline')][string]$Scenario='normal',[ValidateSet('local','groq')][string]$Provider='local')
$ErrorActionPreference='Stop'
if (Get-Process -Name LuoXian,RuntimeHost -ErrorAction SilentlyContinue) { throw 'Close existing game normally before playtesting.' }
$release=(Resolve-Path -LiteralPath $ReleaseRoot).Path
$out=[IO.Path]::GetFullPath($OutputRoot)
if (Test-Path -LiteralPath $out) { throw 'Use a fresh isolated output directory.' }
New-Item -ItemType Directory -Path $out | Out-Null
$native=Join-Path $PSScriptRoot '..\native'
$hostText=[IO.File]::ReadAllText((Join-Path $native 'Host.cs'))
$literalRoot=$release.Replace('\','\\').Replace('"','\"')
$hostText=$hostText.Replace('AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar)',('"'+$literalRoot+'"'))
$preload=@'
localStorage.setItem('luoxian_v31_ai_settings_v2',JSON.stringify({mode:'__PROVIDER__'}));
localStorage.setItem('luoxian_beta3_settings',JSON.stringify({master:0,music:0,sfx:0,textSpeed:0,requestInterval:3}));
window.__aiTrace=[];window.__playtestErrors=[];
window.addEventListener('error',e=>window.__playtestErrors.push(e.message));
window.addEventListener('unhandledrejection',e=>window.__playtestErrors.push(String(e.reason)));
const originalFetch=window.fetch.bind(window);
window.fetch=async (...args)=>{const target=String(args[0]);if(!target.includes('/api/ai/generate')&&!target.includes('/api/ai/cloud/generate'))return originalFetch(...args);const row={request:JSON.parse(args[1].body),started:Date.now()};window.__aiTrace.push(row);try{const r=await originalFetch(...args);row.status=r.status;row.response=await r.clone().json();row.seconds=(Date.now()-row.started)/1000;return r;}catch(e){row.error=String(e);throw e;}};
window.__interactionScenario='__SCENARIO__';
const originalUUID=crypto.randomUUID.bind(crypto);let firstUUID=true;
crypto.randomUUID=()=>{if(firstUUID){firstUUID=false;return '__SEED__';}return originalUUID();};
'@
$preload=$preload.Replace('__SEED__',$Seed).Replace('__SCENARIO__',$Scenario).Replace('__PROVIDER__',$Provider)
if($TravelOnly){$preload+="`nwindow.__travelOnly=true;"}
$preloadLiteral=$preload.Replace('\','\\').Replace('"','\"').Replace("`r",'').Replace("`n",'\n')
$driver=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'native-narrative-driver.js'))
$driverLiteral=$driver.Replace('\','\\').Replace('"','\"').Replace("`r",'').Replace("`n",'\n')
$hostText=$hostText.Replace('   web.Source=new Uri(',('   await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("'+$preloadLiteral+'");'+"`n"+'   web.Source=new Uri('))
$replacement=@'
 async Task Smoke() {
  if(!isGame){await web.CoreWebView2.ExecuteScriptAsync("window.nativeAction('launch-game');");return;}
  await web.CoreWebView2.ExecuteScriptAsync("__DRIVER__");
  var watch=Stopwatch.StartNew();string last="";
  while(watch.ElapsedMilliseconds<1200000){
   string stage=await web.CoreWebView2.ExecuteScriptAsync("window.__playtestStage||''");
   if(stage!=last){last=stage;Program.SmokeWrite("STAGE "+stage);using(var file=File.Create(Path.Combine(Path.GetDirectoryName(Program.SmokeLog),"screen-"+watch.ElapsedMilliseconds+".png"))){await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,file);}}
   if(await web.CoreWebView2.ExecuteScriptAsync("window.__playtestDone===true")=="true")break;
   await Task.Delay(500);
  }
  string report=await web.CoreWebView2.ExecuteScriptAsync("JSON.stringify(window.__playtestReport||{error:'native driver timeout',trace:window.__aiTrace})");
  File.WriteAllText(Path.Combine(Path.GetDirectoryName(Program.SmokeLog),"report.json"),Patches.Json.Deserialize<string>(report));
  Program.SmokeWrite("DONE");closeConfirmed=true;Close();Program.Launcher.Close();
 }
'@
$replacement=$replacement.Replace('__DRIVER__',$driverLiteral)
$start=$hostText.IndexOf(' async Task Smoke() {');$end=$hostText.IndexOf(' async Task SmokeWait(', $start)
$hostText=$hostText.Substring(0,$start)+$replacement+"`n"+$hostText.Substring($end)
[IO.File]::WriteAllText((Join-Path $out 'Host.cs'),$hostText)
$db=[IO.File]::ReadAllText((Join-Path $native 'WorldDatabase.cs'))
$db=$db.Replace('Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData),"LuoXian","Saves")','Path.Combine(Path.GetDirectoryName(Program.SmokeLog),"Saves")')
[IO.File]::WriteAllText((Join-Path $out 'WorldDatabase.cs'),$db)
foreach($name in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll')){Copy-Item -LiteralPath (Join-Path $release $name) -Destination $out}
Copy-Item -LiteralPath (Join-Path $release 'LuoXian.exe.config') -Destination (Join-Path $out 'NarrativeProbe.exe.config')
$refs=@('/r:System.dll','/r:System.Core.dll','/r:System.Drawing.dll','/r:System.Windows.Forms.dll','/r:System.Web.Extensions.dll','/r:System.Management.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll')
$compiler='C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /win32manifest:"$release\app.manifest" /out:"$out\NarrativeProbe.exe" @refs /r:"$out\Microsoft.Web.WebView2.Core.dll" /r:"$out\Microsoft.Web.WebView2.WinForms.dll" "$native\Patches.cs" "$native\RuntimeLifetime.cs" "$native\ModelManager.cs" "$out\WorldDatabase.cs" "$out\Host.cs"
if($LASTEXITCODE -ne 0){throw 'Probe compilation failed.'}
$process=Start-Process -FilePath (Join-Path $out 'NarrativeProbe.exe') -ArgumentList @('--smoke-test',('"'+(Join-Path $out 'native.log')+'"')) -WindowStyle Hidden -PassThru
Write-Output "Probe PID $($process.Id); isolated evidence: $out"
