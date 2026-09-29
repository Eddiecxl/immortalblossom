using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.7.2")]

namespace Luoxian {
static class Program {
 internal static string Root=AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
 internal static Process Backend;
 internal static RuntimeLifetime RuntimeJob;
 internal static Shell Launcher;
 internal static Shell Game;
 internal static string Origin="http://127.0.0.1:24824";
 internal static CoreWebView2Environment Environment;
 internal static string SmokeLog;
 internal static void SmokeWrite(string message){if(SmokeLog!=null)File.AppendAllText(SmokeLog,message+System.Environment.NewLine);}
 static System.Windows.Forms.Timer hideTimer;
 delegate bool EnumWindowsProc(IntPtr window,IntPtr param);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback,IntPtr param);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window,int state);
 [STAThread] static void Main(string[] args) {
  if(args.Length==2&&args[0]=="--model-status") {
   try {File.WriteAllText(Path.GetFullPath(args[1]),Patches.Json.Serialize(ModelManager.Status()));}
   catch(Exception e) {File.WriteAllText(Path.GetFullPath(args[1]),Patches.Json.Serialize(new{error=e.Message}));}
   return;
  }
  if(args.Length==2&&args[0]=="--world-db-self-test") {
   try {File.WriteAllText(Path.GetFullPath(args[1]),Patches.Json.Serialize(WorldDatabase.SelfTest(Path.Combine(Path.GetDirectoryName(Path.GetFullPath(args[1])),"db-self-test"))));}
   catch(Exception e) {File.WriteAllText(Path.GetFullPath(args[1]),Patches.Json.Serialize(new{error=e.ToString()}));}
   return;
  }
  if(args.Length==2&&args[0]=="--smoke-test"){SmokeLog=Path.GetFullPath(args[1]);File.WriteAllText(SmokeLog,"");}
  Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
  bool created; using(var mutex=new System.Threading.Mutex(true,"Local\\LuoxianBeta3Host",out created)) {
   if(!created) {SmokeWrite("BLOCKED: an existing Luoxian instance owns the mutex");if(SmokeLog==null)MessageBox.Show("落仙已在运行。请从任务栏打开启动器。","落仙");return;}
   try {
    if(IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().AnyPort(24824)) throw new IOException("游戏服务端口 24824 仍被占用。可能有其他版本或后台服务正在运行；本启动器不会强制关闭未知进程。");
    var executable=Path.Combine(Root,"RuntimeHost.exe"); if(!File.Exists(executable)) throw new FileNotFoundException("缺少 RuntimeHost.exe，请完整解压游戏。",executable);
    RuntimeJob=new RuntimeLifetime(); Backend=RuntimeJob.Start(executable,Root);
    hideTimer=new System.Windows.Forms.Timer{Interval=100}; hideTimer.Tick+=(s,e)=>HideBackend(); hideTimer.Start();
    Launcher=new Shell(false); Application.Run(Launcher);
   } catch(Exception e) {SmokeWrite("FAIL: "+e.Message);if(SmokeLog==null)MessageBox.Show(e.Message,"落仙启动失败",MessageBoxButtons.OK,MessageBoxIcon.Error);}
   finally {if(hideTimer!=null) hideTimer.Dispose(); StopBackend();mutex.ReleaseMutex();SmokeWrite("STOP: owned runtime shut down");}
  }
 }
 static bool AnyPort(this System.Net.IPEndPoint[] endpoints,int port) {foreach(var ep in endpoints) if(ep.Port==port) return true;return false;}
 internal static void StopBackend() {if(RuntimeJob!=null){RuntimeJob.Dispose();RuntimeJob=null;}if(Backend!=null) {try {if(!Backend.HasExited){Backend.Kill();Backend.WaitForExit(5000);}}catch{} Backend.Dispose();Backend=null;}}
 static void HideBackend() {if(Backend==null)return;try {int pid=Backend.Id;EnumWindows((w,p)=>{uint owner;GetWindowThreadProcessId(w,out owner);if(owner==pid)ShowWindow(w,0);return true;},IntPtr.Zero);}catch{}}
 internal static async Task WaitForRuntime() {
  var watch=Stopwatch.StartNew(); while(watch.ElapsedMilliseconds<30000) {
   if(Backend==null||Backend.HasExited) throw new IOException("游戏运行服务提前退出。请确认 WebView2 Runtime 已安装。");
   try {var request=(HttpWebRequest)WebRequest.Create(Origin+"/launcher/");request.Timeout=800;var responseTask=request.GetResponseAsync();if(await Task.WhenAny(responseTask,Task.Delay(800))!=responseTask){request.Abort();try{await responseTask;}catch{} }else using(var response=await responseTask) if(((HttpWebResponse)response).StatusCode==HttpStatusCode.OK)return;}catch(WebException){}
   await Task.Delay(250);
  } throw new IOException("启动服务超时，请关闭其他落仙实例后重试。");
 }
 internal static void LaunchGame(bool settings) {
  if(Launcher!=null&&!Launcher.IsDisposed)Launcher.SetGameActive(true);
  if(Game!=null&&!Game.IsDisposed){Game.WindowState=FormWindowState.Normal;Game.Activate(); if(settings)Game.OpenSettings();return;}
  try {
   Game=new Shell(true,settings);
   Game.FormClosed+=(s,e)=>{Game=null;if(Launcher!=null&&!Launcher.IsDisposed){Launcher.Show();Launcher.WindowState=FormWindowState.Normal;Launcher.SetGameActive(false);Launcher.Activate();}};
   Game.Show();
  }catch{if(Game!=null){Game.Dispose();Game=null;}if(Launcher!=null&&!Launcher.IsDisposed)Launcher.SetGameActive(false);throw;}
 }
 internal static async Task ApplyPatch(string name) {
  if(Game!=null&&!Game.IsDisposed) throw new IOException("请先退出游戏，再安装补丁。");
  var dir=Path.Combine(Root,"Patches"); if(String.IsNullOrEmpty(name)) {foreach(var f in Directory.GetFiles(dir)){try{Patches.Validate(f,Root,null);name=Path.GetFileName(f);break;}catch{}}}
  if(String.IsNullOrEmpty(name)||Path.GetFileName(name)!=name||!(name.EndsWith(".zip",StringComparison.OrdinalIgnoreCase)||name.EndsWith(".lxpatch",StringComparison.OrdinalIgnoreCase)))throw new IOException("未找到可安装补丁。");
  var patch=Path.Combine(dir,name);await Task.Run(()=>Patches.Validate(patch,Root,null));
  if(Game!=null&&!Game.IsDisposed)throw new IOException("请先退出游戏，再安装补丁。");
  var helperDir=Path.Combine(Path.GetTempPath(),"LuoxianUpdate-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(helperDir);var helper=Path.Combine(helperDir,"Luoxian.Updater.exe");File.Copy(Path.Combine(Root,"Luoxian.Updater.exe"),helper);
  Process.Start(new ProcessStartInfo(helper,"--apply "+Quote(Root)+" "+Quote(patch)+" "+Process.GetCurrentProcess().Id+" "+(Backend==null?0:Backend.Id)){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Root});
  Launcher.BeginInvoke(new Action(()=>Launcher.Close()));
 }
 static string Quote(string value){return "\""+value.Replace("\"","")+"\"";}
}
// Own the documented Core controller so accelerator events do not depend on WinForms key forwarding.
sealed class NativeWebView : Control {
 internal CoreWebView2Controller CoreWebView2Controller {get;private set;}
 internal CoreWebView2 CoreWebView2 {get {return CoreWebView2Controller==null?null:CoreWebView2Controller.CoreWebView2;}}
 internal Color DefaultBackgroundColor {get;set;}
 internal Uri Source {set {CoreWebView2.Navigate(value.AbsoluteUri);}}
 internal async Task EnsureCoreWebView2Async(CoreWebView2Environment environment) {
  var controller=await environment.CreateCoreWebView2ControllerAsync(Handle);
  if(IsDisposed){controller.Close();return;}
  CoreWebView2Controller=controller;controller.DefaultBackgroundColor=DefaultBackgroundColor;controller.Bounds=ClientRectangle;controller.IsVisible=Visible;
  controller.ShouldDetectMonitorScaleChanges=true;
 }
 protected override void OnResize(EventArgs e){base.OnResize(e);if(CoreWebView2Controller!=null)CoreWebView2Controller.Bounds=ClientRectangle;}
 protected override void OnVisibleChanged(EventArgs e){base.OnVisibleChanged(e);if(CoreWebView2Controller!=null)CoreWebView2Controller.IsVisible=Visible;}
 protected override void OnGotFocus(EventArgs e){base.OnGotFocus(e);if(CoreWebView2Controller!=null)CoreWebView2Controller.MoveFocus(CoreWebView2MoveFocusReason.Programmatic);}
 protected override void Dispose(bool disposing){if(disposing&&CoreWebView2Controller!=null){CoreWebView2Controller.Close();CoreWebView2Controller=null;}base.Dispose(disposing);}
}
sealed class Shell : Form {
 readonly bool isGame; readonly bool initialSettings; readonly NativeWebView web=new NativeWebView(); readonly Label loading=new Label(); bool full; Rectangle restoreBounds; FormWindowState restoreState;
 string displayMode="windowed"; bool applyingDisplay; bool displayQueued; int requestedWidth,requestedHeight; bool smokeStarted; bool closeConfirmed; bool closeGuard;
 [DllImport("user32.dll")] static extern IntPtr GetThreadDpiAwarenessContext();
 [DllImport("user32.dll")] static extern bool AreDpiAwarenessContextsEqual(IntPtr first,IntPtr second);
 [DllImport("user32.dll")] static extern short GetKeyState(int key);
 [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
 [DllImport("user32.dll")] static extern IntPtr GetFocus();
 [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window,uint message,IntPtr wParam,IntPtr lParam);
 [DllImport("user32.dll")] static extern bool GetKeyboardState(byte[] state);
 [DllImport("user32.dll")] static extern bool SetKeyboardState(byte[] state);
 public Shell(bool game,bool settings=false) {
  isGame=game;initialSettings=settings; Text=game?"落仙 · Game Beta v4":"落仙 · 启程";AutoScaleDimensions=new SizeF(96,96);AutoScaleMode=AutoScaleMode.Dpi;StartPosition=FormStartPosition.CenterScreen;ClientSize=new Size(game?1440:1200,game?900:780);BackColor=game?Color.Black:Color.FromArgb(8,15,24);
  requestedWidth=game?1440:1200;requestedHeight=game?900:780;
  loading.Text="正在开启落仙…";loading.ForeColor=Color.FromArgb(232,213,178);loading.Font=new Font("Microsoft YaHei UI",16);loading.TextAlign=ContentAlignment.MiddleCenter;loading.Dock=DockStyle.Fill;
  web.Dock=DockStyle.Fill;web.DefaultBackgroundColor=BackColor;Controls.Add(web);Controls.Add(loading);Shown+=async(s,e)=>{SetMode("windowed",requestedWidth,requestedHeight);await Initialize();};
  ResizeEnd+=(s,e)=>{if(!full&&WindowState==FormWindowState.Normal){requestedWidth=Logical(ClientSize.Width);requestedHeight=Logical(ClientSize.Height);}QueueDisplayChanged();};
  SizeChanged+=(s,e)=>QueueDisplayChanged();
  LocationChanged+=(s,e)=>{if(web.CoreWebView2Controller!=null)web.CoreWebView2Controller.NotifyParentWindowPositionChanged();};
  DpiChanged+=(s,e)=>{if(IsHandleCreated)BeginInvoke(new Action(()=>{if(full)SetMode(displayMode,0,0);else if(WindowState==FormWindowState.Normal)SetMode("windowed",requestedWidth,requestedHeight);QueueDisplayChanged();}));};
  FormClosing+=(s,e)=>{if(isGame&&closeGuard&&!closeConfirmed&&web.CoreWebView2!=null&&e.CloseReason==CloseReason.UserClosing){e.Cancel=true;Program.SmokeWrite("PASS: native close routes through save confirmation bridge");web.CoreWebView2.PostWebMessageAsJson(Patches.Json.Serialize(new { @event="lx:close-request",detail=new {}}));return;}if(!isGame&&Program.Game!=null&&!Program.Game.IsDisposed){e.Cancel=true;Program.Game.Close();}};
 }
 async Task Initialize() {
  try {
   await Program.WaitForRuntime();
   if(Program.Environment==null)Program.Environment=await CoreWebView2Environment.CreateAsync(null,(Program.SmokeLog!=null?Path.Combine(Path.GetDirectoryName(Program.SmokeLog),"WebView2-smoke"):Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData),"LuoxianBeta3","WebView2")),new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required"));
   await web.EnsureCoreWebView2Async(Program.Environment);
   web.CoreWebView2.Settings.IsStatusBarEnabled=false;web.CoreWebView2.Settings.AreDefaultContextMenusEnabled=false;
   web.CoreWebView2.NewWindowRequested+=(s,e)=>{e.Handled=true;};
   web.CoreWebView2.NavigationStarting+=(s,e)=>{Uri uri;if(!Uri.TryCreate(e.Uri,UriKind.Absolute,out uri)||uri.GetLeftPart(UriPartial.Authority)!=Program.Origin)e.Cancel=true;};
   web.CoreWebView2.WebMessageReceived+=Message;
   web.CoreWebView2.NavigationCompleted+=async(s,e)=>{if(e.IsSuccess){loading.Visible=false;QueueDisplayChanged();if(isGame&&Program.Launcher!=null)Program.Launcher.WindowState=FormWindowState.Minimized;if(!isGame)SetGameActive(Program.Game!=null&&!Program.Game.IsDisposed);if(Program.SmokeLog!=null&&!smokeStarted){smokeStarted=true;await Smoke();}}else{loading.Text="页面加载失败，请关闭窗口后重试。";Program.SmokeWrite("FAIL: page navigation "+e.WebErrorStatus);if(isGame){closeConfirmed=true;Close();}}};
   web.CoreWebView2Controller.AcceleratorKeyPressed+=(s,e)=>{
    if(Program.SmokeLog!=null)Program.SmokeWrite("INFO: accelerator "+e.VirtualKey+" "+e.KeyEventKind+" alt="+e.PhysicalKeyStatus.IsMenuKeyDown+" repeat="+e.PhysicalKeyStatus.WasKeyDown);
    bool down=e.KeyEventKind==CoreWebView2KeyEventKind.KeyDown||e.KeyEventKind==CoreWebView2KeyEventKind.SystemKeyDown;
    bool shortcut=e.VirtualKey==(uint)Keys.F11||(e.VirtualKey==(uint)Keys.Enter&&(e.PhysicalKeyStatus.IsMenuKeyDown!=0||(GetKeyState((int)Keys.Menu)&0x8000)!=0));
    if(shortcut){e.Handled=true;if(down&&e.PhysicalKeyStatus.WasKeyDown==0)BeginInvoke(new Action(()=>ToggleFullscreen()));}
   };
   await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(@"(()=>{if(location.origin!=='http://127.0.0.1:24824')return;window.lxNative=true;window.lxGameActive=true;let serial=0;const pending=new Map();window.nativeAction=(action,payload)=>new Promise((resolve,reject)=>{const id=String(++serial);pending.set(id,{resolve,reject});window.chrome.webview.postMessage({id,action,payload:payload||{}});setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error('本机操作超时'));}},action==='model-custom'||action==='model-select'?600000:60000);});window.chrome.webview.addEventListener('message',e=>{const m=e.data;if(m.event==='lx:display-changed'||m.event==='lx:game-active'||m.event==='lx:close-request'||m.event==='lx:model-progress'){if(m.event==='lx:game-active')window.lxGameActive=m.detail.active;window.dispatchEvent(new CustomEvent(m.event,{detail:m.detail}));return;}const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.ok?p.resolve(m.result):p.reject(new Error(m.error||'操作失败'));});})();");
   web.Source=new Uri(Program.Origin+(isGame?"/game/v4/"+(initialSettings?"?settings=1":""):"/launcher/"));
  } catch(Exception e) {loading.Text="无法启动："+e.Message;Program.SmokeWrite("FAIL: "+e.Message);if(Program.SmokeLog==null)MessageBox.Show(this,e.Message,"落仙",MessageBoxButtons.OK,MessageBoxIcon.Error);Close();}
 }
 async Task Smoke() {
  if(!isGame){Program.SmokeWrite("PASS: launcher navigation ready");Program.SmokeWrite((Text=="落仙 · 启程"?"PASS":"FAIL")+": launcher window title has no version");await SmokeWait("document.getElementById('gameVersion').textContent==='Game Beta v4' && !document.getElementById('launcherVersion') && document.querySelector('#newsPanel li strong').textContent.includes('v4')","game version and update news are visible without launcher version");var bridge=await web.CoreWebView2.ExecuteScriptAsync("window.lxNative===true && typeof window.nativeAction==='function'");Program.SmokeWrite((bridge=="true"?"PASS":"FAIL")+": injected bridge");await web.CoreWebView2.ExecuteScriptAsync("window.__patchRejected=false;window.nativeAction('apply-patches',{name:'../invalid.zip'}).catch(()=>window.__patchRejected=true);");await Task.Delay(200);var rejected=await web.CoreWebView2.ExecuteScriptAsync("window.__patchRejected===true");Program.SmokeWrite((rejected=="true"?"PASS":"FAIL")+": invalid update rejects without closing or freezing launcher");await web.CoreWebView2.ExecuteScriptAsync("window.nativeAction('launch-game',{});");}
  else {
   Program.SmokeWrite(Program.Launcher.WindowState==FormWindowState.Minimized?"PASS: launcher minimized after game ready":"FAIL: launcher not minimized");
   await Program.Launcher.SmokeWait("window.lxLauncherAudio && window.lxLauncherAudio.getPlaybackState().blocked===true && window.lxLauncherAudio.getPlaybackState().activeSources===0 && document.getElementById('launcherMusicToggle').disabled && document.getElementById('launcherMusicNext').disabled","launcher audio stops and controls lock while game runs");
   Program.SmokeWrite((Program.Launcher.web.CoreWebView2.IsMuted?"PASS":"FAIL")+": native launcher mute enforces game ownership");
   Program.Launcher.WindowState=FormWindowState.Normal;
   await Program.Launcher.web.CoreWebView2.ExecuteScriptAsync("window.lxLauncherAudio.unlock();window.lxLauncherAudio.nextTrack();window.lxLauncherAudio.setEnabled(true);document.dispatchEvent(new Event('visibilitychange'));");
   await Program.Launcher.SmokeWait("window.lxLauncherAudio.getPlaybackState().blocked && window.lxLauncherAudio.getPlaybackState().activeSources===0","manual launcher restore cannot bypass game audio lock");
   await web.CoreWebView2.ExecuteScriptAsync("window.__gameStatus=null;window.nativeAction('game-status').then(s=>window.__gameStatus=s).catch(()=>{});");
   await SmokeWait("window.__gameStatus && window.__gameStatus.active===true","game status reports live game");
   Program.Launcher.WindowState=FormWindowState.Minimized;
   Program.SmokeWrite((AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(),new IntPtr(-4))?"PASS":"FAIL")+": UI thread is PerMonitorV2 DPI aware, scale="+ScaleFactor);
   await web.CoreWebView2.ExecuteScriptAsync("window.__displayEvents=[];window.addEventListener('lx:display-changed',e=>window.__displayEvents.push(e.detail));window.__windowStatus=null;window.nativeAction('window-status').then(s=>window.__windowStatus=s);");
   await SmokeWait("window.__windowStatus && window.__windowStatus.width>0 && window.__windowStatus.scaleFactor>0","window-status returns applied display state");
   await web.CoreWebView2.ExecuteScriptAsync("window.__applied=null;window.nativeAction('window-settings',{mode:'windowed',width:1000,height:700}).then(s=>window.__applied=s);");
   await SmokeWait("window.__applied && window.__applied.mode==='windowed' && window.__applied.requestedWidth===1000 && window.__applied.requestedHeight===700 && Math.abs(innerWidth-window.__applied.width)<=1 && Math.abs(innerHeight-window.__applied.height)<=1","applied settings match browser client dimensions");
   Program.SmokeWrite("INFO: applied="+await web.CoreWebView2.ExecuteScriptAsync("JSON.stringify({applied:window.__applied,innerWidth,innerHeight,devicePixelRatio})")+" controllerScale="+web.CoreWebView2Controller.RasterizationScale+" native="+Patches.Json.Serialize(DisplayStatus()));
   var normalBounds=Bounds;
   await web.CoreWebView2.ExecuteScriptAsync("window.nativeAction('window-settings',{mode:'fullscreen'});");await Task.Delay(300);Program.SmokeWrite(full&&FormBorderStyle==FormBorderStyle.None?"PASS: native fullscreen":"FAIL: fullscreen");
   await web.CoreWebView2.ExecuteScriptAsync("window.nativeAction('window-settings',{mode:'windowed'});");await Task.Delay(300);Program.SmokeWrite(!full&&FormBorderStyle==FormBorderStyle.Sizable&&Bounds==normalBounds?"PASS: native windowed exact bounds restore":"FAIL: windowed restore");Program.SmokeWrite("INFO: before="+normalBounds+" after="+Bounds);
   await web.CoreWebView2.ExecuteScriptAsync("window.__large=null;window.nativeAction('window-settings',{mode:'windowed',width:100000,height:100000}).then(s=>window.__large=s);");
   await SmokeWait("window.__large && window.__large.clamped===true","oversized request reports clamping");
   Program.SmokeWrite((Screen.FromControl(this).WorkingArea.Contains(Bounds)?"PASS":"FAIL")+": window chrome remains inside work area");
   await SmokeWait("window.__displayEvents.length>=3 && window.__displayEvents[window.__displayEvents.length-1].mode==='windowed'","native display changes reach frontend");
   await SmokeHotkey(Keys.F11,false,true,"F11 accelerator enters fullscreen");
   await SmokeHotkey(Keys.Enter,true,false,"Alt+Enter accelerator restores window");
   foreach(var monitor in Screen.AllScreens) {
    SetMode("windowed",1000,700);Location=new Point(monitor.WorkingArea.X+30,monitor.WorkingArea.Y+30);await Task.Delay(500);
    SetMode("windowed",1000,700);await Task.Delay(200);
    var current=DisplayStatus();var serialized=Patches.Json.Serialize(current);
    await SmokeWait("Math.abs(devicePixelRatio-"+ScaleFactor.ToString(System.Globalization.CultureInfo.InvariantCulture)+")<0.01 && Math.abs(innerWidth-"+Logical(ClientSize.Width)+")<=1 && Math.abs(innerHeight-"+Logical(ClientSize.Height)+")<=1","browser and native DPI agree on "+monitor.DeviceName);
    Program.SmokeWrite((monitor.WorkingArea.Contains(Bounds)?"PASS":"FAIL")+": window fits "+monitor.DeviceName+" "+serialized);
   }
   var timer=new System.Windows.Forms.Timer{Interval=500};timer.Tick+=async(s,e)=>{timer.Stop();timer.Dispose();Program.SmokeWrite(Program.Game==null&&Program.Launcher.WindowState==FormWindowState.Normal?"PASS: game close restores launcher":"FAIL: launcher restore");Program.SmokeWrite(Program.Backend!=null&&!Program.Backend.HasExited?"PASS: runtime remains for launcher":"FAIL: runtime stopped early");await Program.Launcher.SmokeWait("window.lxLauncherAudio.getPlaybackState().blocked===false && window.lxLauncherAudio.getPlaybackState().activeSources===1 && !document.getElementById('launcherMusicToggle').disabled && !document.getElementById('launcherMusicNext').disabled","game close resumes launcher music automatically");Program.SmokeWrite((!Program.Launcher.web.CoreWebView2.IsMuted?"PASS":"FAIL")+": game close removes native launcher mute");Program.Launcher.Close();};timer.Start();
   await web.CoreWebView2.ExecuteScriptAsync("window.nativeAction('close');");
  }
 }
 async Task SmokeWait(string expression,string label) {
  var watch=Stopwatch.StartNew();bool passed=false;
  while(watch.ElapsedMilliseconds<5000){if(await web.CoreWebView2.ExecuteScriptAsync("Boolean("+expression+")")=="true"){passed=true;break;}await Task.Delay(50);}
  Program.SmokeWrite((passed?"PASS: ":"FAIL: ")+label);
 }
 async Task SmokeHotkey(Keys key,bool alt,bool expectedFull,string label) {
  Activate();web.Focus();web.CoreWebView2Controller.MoveFocus(CoreWebView2MoveFocusReason.Programmatic);await Task.Delay(100);
  IntPtr target=GetFocus();int keyFlags=1|(alt?1<<29:0);
  byte[] keyboard=new byte[256];GetKeyboardState(keyboard);if(alt){byte[] pressed=(byte[])keyboard.Clone();pressed[(int)Keys.Menu]=0x80;SetKeyboardState(pressed);}
  PostMessage(target,alt?0x0104u:0x0100u,new IntPtr((int)key),new IntPtr(keyFlags));
  PostMessage(target,alt?0x0105u:0x0101u,new IntPtr((int)key),new IntPtr(unchecked(keyFlags|((int)0xC0000000))));
  await Task.Delay(500);if(alt)SetKeyboardState(keyboard);Program.SmokeWrite((full==expectedFull?"PASS: ":"FAIL: ")+label);
 }
 internal async void OpenSettings(){if(web.CoreWebView2!=null)await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('lx-open-settings')); if(typeof window.openSettings==='function')window.openSettings();");}
 internal void SetGameActive(bool active){
  if(isGame||IsDisposed||web.CoreWebView2==null)return;
  // Mute synchronously, before the game can create audio; the event also retires sources.
  web.CoreWebView2.IsMuted=active;
  web.CoreWebView2.PostWebMessageAsJson(Patches.Json.Serialize(new { @event="lx:game-active",detail=new {active=active}}));
 }
 async void Message(object sender,CoreWebView2WebMessageReceivedEventArgs e) {
  string id="";
  try {
   Uri uri; if(!Uri.TryCreate(e.Source,UriKind.Absolute,out uri)||uri.GetLeftPart(UriPartial.Authority)!=Program.Origin)return;
   var m=Patches.Json.Deserialize<Dictionary<string,object>>(e.WebMessageAsJson);id=Convert.ToString(m["id"]);var action=Convert.ToString(m["action"]);var p=m.ContainsKey("payload")?m["payload"] as Dictionary<string,object>:null;p=p??new Dictionary<string,object>();object result=new {ok=true};
   switch(action){
    case "launch-game":Program.LaunchGame(p.ContainsKey("settings")&&Convert.ToBoolean(p["settings"]));break;
    case "game-status":result=new {active=Program.Game!=null&&!Program.Game.IsDisposed};break;
    case "minimize":WindowState=FormWindowState.Minimized;break;
    case "maximize":WindowState=WindowState==FormWindowState.Maximized?FormWindowState.Normal:FormWindowState.Maximized;break;
    case "close-guard":closeGuard=true;break;
    case "close":if(isGame&&p.ContainsKey("confirmed")&&Convert.ToBoolean(p["confirmed"]))closeConfirmed=true;BeginInvoke(new Action(()=>Close()));break;
    case "window-settings":result=SetMode(p.ContainsKey("mode")?Convert.ToString(p["mode"]):"windowed",Number(p,"width"),Number(p,"height"));break;
    case "window-status":result=DisplayStatus();break;
    case "open-patches":var dir=Path.Combine(Program.Root,"Patches");Patches.NoLinks(dir);Directory.CreateDirectory(dir);Process.Start("explorer.exe","\""+dir+"\"");break;
    case "open-save":var saveDir=Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData),"LuoXian","Saves");Directory.CreateDirectory(saveDir);Process.Start("explorer.exe","\""+saveDir+"\"");break;
    case "scan-patches":result=await Task.Run(()=>Patches.Scan(Program.Root));break;
    case "apply-patches":await Program.ApplyPatch(p.ContainsKey("name")?Convert.ToString(p["name"]):null);result=new{restarting=true};break;
    case "model-status":result=await Task.Run(()=>ModelManager.Status());break;
    case "model-download":result=ModelManager.StartDownload(Convert.ToString(p["id"]),detail=>{
     if(!IsDisposed&&IsHandleCreated)BeginInvoke(new Action(()=>{if(!IsDisposed&&web.CoreWebView2!=null)
      web.CoreWebView2.PostWebMessageAsJson(Patches.Json.Serialize(new{@event="lx:model-progress",detail=detail}));}));});break;
    case "model-select":if(Program.Game!=null&&!Program.Game.IsDisposed)throw new IOException("请先退出游戏再切换模型。");result=await Task.Run(()=>ModelManager.Select(Convert.ToString(p["id"])));break;
    case "model-custom":
     if(Program.Game!=null&&!Program.Game.IsDisposed)throw new IOException("请先退出游戏再切换模型。");
     using(var picker=new OpenFileDialog{Title="选择本地 GGUF 模型",Filter="GGUF 模型 (*.gguf)|*.gguf",CheckFileExists=true,Multiselect=false})
      result=picker.ShowDialog(this)==DialogResult.OK?await Task.Run(()=>ModelManager.SelectCustom(picker.FileName)):new{selected=""};
     break;
    case "model-bundled":if(Program.Game!=null&&!Program.Game.IsDisposed)throw new IOException("请先退出游戏再切换模型。");result=await Task.Run(()=>ModelManager.RestoreBundled());break;
    case "model-delete":if(Program.Game!=null&&!Program.Game.IsDisposed)throw new IOException("请先退出游戏再删除模型。");result=await Task.Run(()=>ModelManager.Delete(Convert.ToString(p["id"])));break;
    case "world-save":result=await Task.Run(()=>WorldDatabase.Save(p.ContainsKey("record")?p["record"]:null,p.ContainsKey("turn")?p["turn"]:null));break;
    case "world-load":result=await Task.Run(()=>WorldDatabase.Load());break;
    case "world-memory-search":result=await Task.Run(()=>WorldDatabase.Search(Convert.ToString(p["worldId"]),p.ContainsKey("query")?Convert.ToString(p["query"]):""));break;
    default:throw new InvalidOperationException("未知本机操作："+action);
   }
   if(!IsDisposed&&web.CoreWebView2!=null)web.CoreWebView2.PostWebMessageAsJson(Patches.Json.Serialize(new{id=id,ok=true,result=result}));
  } catch(Exception ex) {if(!IsDisposed&&web.CoreWebView2!=null)web.CoreWebView2.PostWebMessageAsJson(Patches.Json.Serialize(new{id=id,ok=false,error=ex.Message}));}
 }
 static int Number(Dictionary<string,object> p,string key){return p.ContainsKey(key)?Convert.ToInt32(p[key]):0;}
 double ScaleFactor {get {try {return Math.Max(96,GetDpiForWindow(Handle))/96.0;}catch(EntryPointNotFoundException){return Math.Max(96,DeviceDpi)/96.0;}}}
 int Logical(int pixels){return (int)Math.Round(pixels/ScaleFactor);}
 object DisplayStatus() {return new {mode=displayMode,width=Logical(ClientSize.Width),height=Logical(ClientSize.Height),scaleFactor=ScaleFactor,physicalWidth=ClientSize.Width,physicalHeight=ClientSize.Height,requestedWidth=requestedWidth,requestedHeight=requestedHeight,clamped=!full&&(Logical(ClientSize.Width)!=requestedWidth||Logical(ClientSize.Height)!=requestedHeight),maximized=WindowState==FormWindowState.Maximized};}
 void QueueDisplayChanged() {
  if(applyingDisplay||displayQueued||!IsHandleCreated||IsDisposed||web.CoreWebView2==null)return;
  displayQueued=true;BeginInvoke(new Action(()=>{displayQueued=false;if(!IsDisposed&&web.CoreWebView2!=null&&WindowState!=FormWindowState.Minimized)web.CoreWebView2.PostWebMessageAsJson(Patches.Json.Serialize(new { @event="lx:display-changed",detail=DisplayStatus()}));}));
 }
 void ToggleFullscreen(){SetMode(full?"windowed":"fullscreen",0,0);}
 object SetMode(string mode,int width,int height) {
  if(mode!="windowed"&&mode!="borderless"&&mode!="fullscreen")throw new ArgumentException("未知窗口模式。");
  if(width<0||height<0||(width==0)!=(height==0))throw new ArgumentException("请提供有效的窗口宽度和高度。");
  applyingDisplay=true;
  try {
   var screen=Screen.FromControl(this);var area=screen.WorkingArea;
   if(width>0){requestedWidth=width;requestedHeight=height;}
   if(mode!="windowed") {
    if(!full){restoreBounds=WindowState==FormWindowState.Normal?Bounds:RestoreBounds;restoreState=WindowState;}
    full=true;WindowState=FormWindowState.Normal;MinimumSize=Size.Empty;FormBorderStyle=FormBorderStyle.None;Bounds=screen.Bounds;
   } else {
    bool restored=full;
    if(full){full=false;WindowState=FormWindowState.Normal;FormBorderStyle=FormBorderStyle.Sizable;Bounds=restoreBounds;}
    if(width>0||!restored){WindowState=FormWindowState.Normal;FitWindow(area,requestedWidth,requestedHeight,true);}
    else {if(!area.Contains(Bounds))FitWindow(area,Logical(ClientSize.Width),Logical(ClientSize.Height),false);SetWindowMinimum(area);if(restoreState==FormWindowState.Maximized)WindowState=restoreState;}
   }
   displayMode=mode;
  } finally {applyingDisplay=false;}
  QueueDisplayChanged();return DisplayStatus();
 }
 void FitWindow(Rectangle area,int width,int height,bool center) {
  MinimumSize=Size.Empty;
  // Measure the real nonclient area: Framework DeviceDpi can lag while crossing monitors.
  var chrome=new Size(Width-ClientSize.Width,Height-ClientSize.Height);
  int maxWidth=Math.Max(1,area.Width-chrome.Width),maxHeight=Math.Max(1,area.Height-chrome.Height);
  int targetWidth=(int)Math.Min(maxWidth,Math.Max(Math.Min(800*ScaleFactor,maxWidth),(double)width*ScaleFactor));
  int targetHeight=(int)Math.Min(maxHeight,Math.Max(Math.Min(560*ScaleFactor,maxHeight),(double)height*ScaleFactor));
  Size=new Size(targetWidth+chrome.Width,targetHeight+chrome.Height);
  SetWindowMinimum(area);
  int x=center?area.X+(area.Width-Width)/2:Left,y=center?area.Y+(area.Height-Height)/2:Top;
  Location=new Point(Math.Max(area.Left,Math.Min(x,area.Right-Width)),Math.Max(area.Top,Math.Min(y,area.Bottom-Height)));
 }
 void SetWindowMinimum(Rectangle area) {MinimumSize=new Size(Math.Min(area.Width,(int)(800*ScaleFactor)+Width-ClientSize.Width),Math.Min(area.Height,(int)(560*ScaleFactor)+Height-ClientSize.Height));}
}
}
