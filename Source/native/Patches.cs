using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace Luoxian {
public sealed class PatchFile { public string path; public string sha256; }
public sealed class PatchManifest { public string format; public string fromVersion; public string toVersion; public PatchFile[] files; }
public static class Patches {
 public static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 };
 public static string Version(string root) { var p=Path.Combine(root,"version.json"); if(!File.Exists(p)) throw new InvalidDataException("Missing version.json."); return Convert.ToString(Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(p))["version"]); }
 public static string Hash(Stream stream) { using(var h=SHA256.Create()) return BitConverter.ToString(h.ComputeHash(stream)).Replace("-","").ToLowerInvariant(); }
 public static void NoLinks(string path) { var p=Path.GetFullPath(path); while(!String.IsNullOrEmpty(p)) { if((File.Exists(p)||Directory.Exists(p))&&(File.GetAttributes(p)&FileAttributes.ReparsePoint)!=0) throw new InvalidDataException("Symbolic links and reparse points are not allowed: "+p); p=Path.GetDirectoryName(p); } }
 public static string Target(string root,string relative) {
  if(String.IsNullOrEmpty(relative)||relative.Contains("\\")||relative.Contains(":")||relative.StartsWith("/")||relative.Length>220) throw new InvalidDataException("Unsafe path: "+relative);
  foreach(var part in relative.Split('/')) if(part=="."||part==".."||part.Length==0||part.EndsWith(".")||part.EndsWith(" ")||part.IndexOfAny(Path.GetInvalidFileNameChars())>=0||Regex.IsMatch(part,@"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)",RegexOptions.IgnoreCase)) throw new InvalidDataException("Unsafe path: "+relative);
  var lower=relative.ToLowerInvariant();
  var rootFiles=new[]{"luoxian.exe","luoxian.exe.config","runtimehost.exe","luoxian.updater.exe","microsoft.web.webview2.core.dll","microsoft.web.webview2.winforms.dll","webview2loader.dll"};
  if(!(lower.StartsWith("game/")||lower.StartsWith("launcher/")||lower=="repair/game.bundle.zip"||rootFiles.Contains(lower))) throw new InvalidDataException("Path is outside patchable application files: "+relative);
  if(relative.Split('/').Any(p=>new[]{"saves","save","credentials","userdata","profiles"}.Contains(p.ToLowerInvariant()))) throw new InvalidDataException("User data cannot be patched.");
  var full=Path.GetFullPath(Path.Combine(root,relative.Replace('/',Path.DirectorySeparatorChar)));
  if(!full.StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Path escaped installation.");
  NoLinks(full); return full;
 }
 public static PatchManifest Validate(string zipPath,string root,string stage) {
  NoLinks(zipPath); NoLinks(root); if(stage!=null) { NoLinks(stage); Directory.CreateDirectory(stage); }
  using(var zip=ZipFile.OpenRead(zipPath)) {
   if(zip.Entries.Count>5001) throw new InvalidDataException("Too many patch entries.");
   if(zip.Entries.GroupBy(e=>e.FullName,StringComparer.OrdinalIgnoreCase).Any(g=>g.Count()>1)) throw new InvalidDataException("Duplicate ZIP entry.");
   var entry=zip.GetEntry("manifest.json"); if(entry==null||entry.Length>1024*1024) throw new InvalidDataException("Missing or oversized manifest.json.");
   PatchManifest m; using(var r=new StreamReader(entry.Open())) m=Json.Deserialize<PatchManifest>(r.ReadToEnd());
   if(m==null||m.format!="luoxian-beta4-patch-1"||!Regex.IsMatch(m.fromVersion??"",@"^4\.\d+\.\d+$")||!Regex.IsMatch(m.toVersion??"",@"^4\.\d+\.\d+$")||new System.Version(m.toVersion)<=new System.Version(m.fromVersion)) throw new InvalidDataException("Unsupported patch format or version.");
   if(m.fromVersion!=Version(root)) throw new InvalidDataException("Patch requires version "+m.fromVersion+"; installed "+Version(root)+".");
   if(m.files==null||m.files.Length==0||m.files.Length>5000) throw new InvalidDataException("Patch file list is empty or too large.");
   var names=new HashSet<string>(StringComparer.OrdinalIgnoreCase); names.Add("manifest.json"); long total=0;
   foreach(var f in m.files) {
    Target(root,f.path); if(!Regex.IsMatch(f.sha256??"",@"^[a-fA-F0-9]{64}$")) throw new InvalidDataException("Invalid SHA-256: "+f.path);
    var name="payload/"+f.path; if(!names.Add(name)) throw new InvalidDataException("Duplicate target: "+f.path);
    var data=zip.GetEntry(name); if(data==null) throw new InvalidDataException("Missing payload: "+f.path);
    int unixType=(data.ExternalAttributes>>16)&0xF000; if(unixType==0xA000||(data.ExternalAttributes&0x400)!=0) throw new InvalidDataException("ZIP links are forbidden.");
    total+=data.Length; if(total>1024L*1024*1024||data.Length>512L*1024*1024) throw new InvalidDataException("Patch exceeds size limit.");
    using(var input=data.Open()) if(!String.Equals(Hash(input),f.sha256,StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("SHA-256 mismatch: "+f.path);
    if(stage!=null) { var outPath=Target(stage,f.path); Directory.CreateDirectory(Path.GetDirectoryName(outPath)); using(var input=data.Open()) using(var output=File.Create(outPath)) input.CopyTo(output); }
   }
   foreach(var item in zip.Entries) if(!names.Contains(item.FullName)) throw new InvalidDataException("Unlisted ZIP entry: "+item.FullName);
   return m;
  }
 }
 public static object Scan(string root) {
  var dir=Path.Combine(root,"Patches"); NoLinks(dir); Directory.CreateDirectory(dir); var list=new List<object>();
  foreach(var f in Directory.GetFiles(dir).Where(p=>new[]{".zip",".lxpatch"}.Contains(Path.GetExtension(p).ToLowerInvariant())).OrderBy(p=>p)) {
   try { var m=Validate(f,root,null); list.Add(new {name=Path.GetFileName(f),valid=true,fromVersion=m.fromVersion,toVersion=m.toVersion,error=""}); }
   catch(Exception e) { list.Add(new {name=Path.GetFileName(f),valid=false,error=e.Message}); }
  } return new {version=Version(root),patches=list};
 }
 // Every target is staged and verified first. File.Replace is atomic per file; the backup journal restores the entire patch on failure.
 public static void Apply(string zipPath,string root,int failAfter) {
  root=Path.GetFullPath(root); NoLinks(root); var transaction=Path.Combine(root,".patch-"+Guid.NewGuid().ToString("N")); var stage=Path.Combine(transaction,"stage"); var backup=Path.Combine(transaction,"backup");
  var changed=new List<string>(); bool success=false;
  try {
   var m=Validate(zipPath,root,stage); Directory.CreateDirectory(backup);
   var paths=m.files.Select(f=>f.path).Concat(new[]{"version.json"}).ToList();
   File.WriteAllText(Path.Combine(stage,"version.json"),Json.Serialize(new {version=m.toVersion}),new UTF8Encoding(false));
   foreach(var rel in paths) {
    string dest=rel=="version.json"?Path.Combine(root,rel):Target(root,rel); NoLinks(dest);
    string src=Path.Combine(stage,rel.Replace('/',Path.DirectorySeparatorChar)); string old=Path.Combine(backup,rel.Replace('/',Path.DirectorySeparatorChar));
    Directory.CreateDirectory(Path.GetDirectoryName(dest)); Directory.CreateDirectory(Path.GetDirectoryName(old));
    if(File.Exists(dest)) File.Replace(src,dest,old,true); else File.Move(src,dest);
    changed.Add(rel); if(failAfter>0&&changed.Count==failAfter) throw new IOException("Injected write failure for rollback test.");
   }
   success=true;
  } catch {
   for(int i=changed.Count-1;i>=0;i--) { var rel=changed[i]; var dest=Path.Combine(root,rel.Replace('/',Path.DirectorySeparatorChar)); var old=Path.Combine(backup,rel.Replace('/',Path.DirectorySeparatorChar)); NoLinks(dest); if(File.Exists(old)) { if(File.Exists(dest)) File.Replace(old,dest,null,true); else File.Move(old,dest); } else if(File.Exists(dest)) File.Delete(dest); }
   throw;
  } finally { if(Directory.Exists(transaction)) { if(success||!Directory.Exists(backup)||!Directory.EnumerateFiles(backup,"*",SearchOption.AllDirectories).Any()) Directory.Delete(transaction,true); } }
 }
}
}
