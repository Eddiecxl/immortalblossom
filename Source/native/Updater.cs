using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Windows.Forms;

namespace Luoxian {
static class Updater {
 [STAThread] static int Main(string[] args) {
  if(args.Length==1&&args[0]=="--self-test") return SelfTest.Run();
  if(args.Length!=5||args[0]!="--apply") { Console.WriteLine("Luoxian.Updater --apply <install-root> <patch> <parent-pid> <runtime-pid>"); return 2; }
  string root=Path.GetFullPath(args[1]); bool good=false;
  try {
   foreach(var s in new[]{args[3],args[4]}) { int pid; if(Int32.TryParse(s,out pid)&&pid>0) { try { using(var p=Process.GetProcessById(pid)) if(!p.WaitForExit(30000)) throw new IOException("Application is still running; close it before updating."); } catch(ArgumentException){} } }
   using(var guard=new System.Threading.Mutex(false,"Local\\LuoxianBeta3Host")) {
    bool acquired;try{acquired=guard.WaitOne(0);}catch(System.Threading.AbandonedMutexException){acquired=true;}
    if(!acquired) throw new IOException("Another application instance or update is running.");
    try {
     Patches.Apply(args[2],root,0); good=true;
     try {var applied=Path.Combine(root,"Patches","Applied");Patches.NoLinks(applied);Directory.CreateDirectory(applied);var destination=Path.Combine(applied,DateTime.Now.ToString("yyyyMMdd-HHmmss")+"-"+Guid.NewGuid().ToString("N").Substring(0,8)+"-"+Path.GetFileName(args[2]));File.Move(args[2],destination);}
     catch(Exception e){MessageBox.Show("更新已完成，但补丁归档失败。可手动移走已安装的补丁。\n"+e.Message,"落仙 · 更新",MessageBoxButtons.OK,MessageBoxIcon.Information);}
    } finally {guard.ReleaseMutex();}
   }
  } catch(Exception e) { MessageBox.Show("更新未完成，已保留原版本。\n"+e.Message,"落仙 · 更新",MessageBoxButtons.OK,MessageBoxIcon.Error); }
  try { Process.Start(new ProcessStartInfo(Path.Combine(root,"LuoXian.exe")){WorkingDirectory=root}); } catch(Exception e) { MessageBox.Show(e.Message,"请重新启动落仙"); }
  return good?0:1;
 }
}
static class SelfTest {
 static void Check(bool condition,string name) { if(!condition) throw new Exception("FAIL: "+name); Console.WriteLine("PASS: "+name); }
 static void Reject(Action action,string name) { bool failed=false; try {action();} catch(InvalidDataException){failed=true;} Check(failed,name); }
 static string Make(string root,string path,string content,bool badHash) {
  var zipPath=Path.Combine(root,Guid.NewGuid().ToString("N")+".lxpatch"); string hash; using(var bytes=new MemoryStream(Encoding.UTF8.GetBytes(content))) hash=Patches.Hash(bytes);
  var m=new PatchManifest{format="luoxian-beta4-patch-1",fromVersion="4.0.0",toVersion="4.0.1",files=new[]{new PatchFile{path=path,sha256=badHash?new String('0',64):hash}}};
  using(var zip=ZipFile.Open(zipPath,ZipArchiveMode.Create)) {using(var w=new StreamWriter(zip.CreateEntry("manifest.json").Open())) w.Write(Patches.Json.Serialize(m)); using(var w=new StreamWriter(zip.CreateEntry("payload/"+path).Open(),new UTF8Encoding(false))) w.Write(content); } return zipPath;
 }
 static string MakeGamePatch(string root) {
  var payload=new System.Collections.Generic.Dictionary<string,string>{{"game/v4/test.js","new-game"},{"game/manifest.json","{\"version\":\"4.0.1\",\"files\":[]}"},{"game/version.json","{\"version\":\"4.0.1\"}"},{"repair/game.bundle.zip","repair-fixture"}};
  var files=new System.Collections.Generic.List<PatchFile>();foreach(var item in payload)using(var b=new MemoryStream(Encoding.UTF8.GetBytes(item.Value)))files.Add(new PatchFile{path=item.Key,sha256=Patches.Hash(b)});
  var m=new PatchManifest{format="luoxian-beta4-patch-1",fromVersion="4.0.0",toVersion="4.0.1",files=files.ToArray()};var path=Path.Combine(root,"game-patch.lxpatch");
  using(var zip=ZipFile.Open(path,ZipArchiveMode.Create)){using(var w=new StreamWriter(zip.CreateEntry("manifest.json").Open()))w.Write(Patches.Json.Serialize(m));foreach(var item in payload)using(var w=new StreamWriter(zip.CreateEntry("payload/"+item.Key).Open(),new UTF8Encoding(false)))w.Write(item.Value);}return path;
 }
 public static int Run() {
  var root=Path.Combine(Path.GetTempPath(),"LuoxianPatchTest-"+Guid.NewGuid().ToString("N")); Directory.CreateDirectory(Path.Combine(root,"game"));
  try {
   File.WriteAllText(Path.Combine(root,"version.json"),"{\"version\":\"4.0.0\"}");
   foreach(var p in new[]{"../outside.txt","game/../../outside.txt","game\\bad.js","game/a:stream","Saves/save.json","runtime/models/a.gguf","game/NUL.txt","game/a./x","game/saves/one.json","repair/evil.exe","repair/other.zip"}) Reject(()=>Patches.Target(root,p),"reject path "+p);
   Check(Patches.Target(root,"repair/game.bundle.zip")==Path.Combine(root,"repair","game.bundle.zip"),"allow exact repair game bundle");
   var traversal=Make(root,"../outside.txt","bad",false); Reject(()=>Patches.Validate(traversal,root,null),"ZIP traversal rejected");
   var bad=Make(root,"game/a.txt","new",true); Reject(()=>Patches.Apply(bad,root,0),"hash mismatch rejected before writes");
   var valid=Make(root,"game/a.txt","new",false); File.WriteAllText(Path.Combine(root,"game","a.txt"),"original");
   bool rolled=false; try {Patches.Apply(valid,root,1);} catch(IOException){rolled=true;} Check(rolled&&File.ReadAllText(Path.Combine(root,"game","a.txt"))=="original"&&Patches.Version(root)=="4.0.0","failed install rolls back existing files and version");
   var newFile=Make(root,"game/new.txt","new",false); try {Patches.Apply(newFile,root,1);} catch(IOException){} Check(!File.Exists(Path.Combine(root,"game","new.txt")),"rollback removes newly created file");
   Directory.CreateDirectory(Path.Combine(root,"Saves")); File.WriteAllText(Path.Combine(root,"Saves","keep.txt"),"save");
   Patches.Apply(valid,root,0); Check(File.ReadAllText(Path.Combine(root,"game","a.txt"))=="new"&&Patches.Version(root)=="4.0.1","valid patch installs and advances version");
   Check(File.ReadAllText(Path.Combine(root,"Saves","keep.txt"))=="save","saves remain untouched");
   Reject(()=>Patches.Validate(valid,root,null),"wrong base version rejected");
   var bundleRoot=Path.Combine(root,"bundle-test");Directory.CreateDirectory(Path.Combine(bundleRoot,"repair"));File.WriteAllText(Path.Combine(bundleRoot,"version.json"),"{\"version\":\"4.0.0\"}");File.WriteAllText(Path.Combine(bundleRoot,"repair","game.bundle.zip"),"old-repair");var bundled=MakeGamePatch(bundleRoot);
   try{Patches.Apply(bundled,bundleRoot,4);}catch(IOException){}
   Check(File.ReadAllText(Path.Combine(bundleRoot,"repair","game.bundle.zip"))=="old-repair"&&!File.Exists(Path.Combine(bundleRoot,"game","manifest.json")),"game patch failure rolls back repair bundle and manifest together");
   Patches.Apply(bundled,bundleRoot,0);Check(File.ReadAllText(Path.Combine(bundleRoot,"repair","game.bundle.zip"))=="repair-fixture"&&File.Exists(Path.Combine(bundleRoot,"game","manifest.json"))&&File.Exists(Path.Combine(bundleRoot,"game","version.json"))&&Patches.Version(bundleRoot)=="4.0.1","future game patch installs manifest version and repair bundle together");
   Console.WriteLine("ALL PATCH SELF-TESTS PASSED"); return 0;
  } catch(Exception e) { Console.Error.WriteLine(e); return 1; }
  finally {Directory.Delete(root,true);}
 }
}
}
