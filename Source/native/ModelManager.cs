using System;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace Luoxian {
public sealed class CatalogFile { public int schemaVersion; public CatalogModel[] models; }
public sealed class CatalogModel {
 public string id,label,fileName,url,sha256,source;
 public long estimatedBytes; public int minimumRamGiB,recommendedRamGiB,contextSize,minimumLlamaBuild;
}
public sealed class LocalProfileFile { public int schemaVersion; public LocalProfile[] profiles; }
public sealed class LocalProfile {
 public string id,label,model,gpuLayers; public int minRamGB,contextSize,threads,maxOutputTokens;
}

// Downloads are outside the patch tree. Only a verified file is linked into
// runtime/models; the bundled small model remains available at all times.
public static class ModelManager {
 [StructLayout(LayoutKind.Sequential)] struct MemoryStatus {
  public uint length,load; public ulong totalPhysical,availablePhysical,totalPage,availablePage,totalVirtual,availableVirtual,availableExtended;
 }
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GlobalMemoryStatusEx(ref MemoryStatus status);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateHardLink(string fileName,string existingFile,IntPtr securityAttributes);
 const int InstalledLlamaBuild=10343;
 static readonly object guard=new object();
 static bool downloading;
 static string currentDownload="",progress="";
 static readonly string DataRoot=Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData),"LuoXian");
 static readonly string ModelRoot=Path.Combine(DataRoot,"Models");
 static string CatalogPath { get { return Path.Combine(Program.Root,"launcher","model-catalog.json"); } }
 static string ProfilePath { get { return Path.Combine(Program.Root,"runtime","models","profiles.json"); } }
 static string ProfileBackup { get { return Path.Combine(DataRoot,"original-profiles.json"); } }
 static CatalogFile ReadCatalog() {
  var catalog=Patches.Json.Deserialize<CatalogFile>(File.ReadAllText(CatalogPath));
  if(catalog==null||catalog.schemaVersion!=1||catalog.models==null)throw new InvalidDataException("模型目录版本无法读取。");
  return catalog;
 }
 static CatalogModel Find(string id) {
  var model=ReadCatalog().models.FirstOrDefault(x=>x.id==id);
  if(model==null||String.IsNullOrEmpty(model.fileName)||Path.GetFileName(model.fileName)!=model.fileName
   ||!ValidDownloadUrl(model.url)
   ||model.sha256==null||model.sha256.Length!=64)throw new InvalidDataException("模型条目无效。");
  return model;
 }
 static bool ValidDownloadUrl(string address) { Uri uri;return Uri.TryCreate(address,UriKind.Absolute,out uri)
  &&uri.Scheme=="https"&&uri.Host=="huggingface.co"; }
 static string ModelPath(CatalogModel model) { return Path.Combine(ModelRoot,model.fileName); }
 static string Hash(string path) { using(var stream=File.OpenRead(path))using(var sha=SHA256.Create())
  return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant(); }
 static double GiB(ulong bytes) { return Math.Round(bytes/1073741824.0,1); }
 static object Hardware() {
  var mem=new MemoryStatus{length=(uint)Marshal.SizeOf(typeof(MemoryStatus))};
  if(!GlobalMemoryStatusEx(ref mem))throw new Win32Exception(Marshal.GetLastWin32Error());
  string cpu="未知";try{using(var key=Registry.LocalMachine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\CentralProcessor\0"))
   cpu=Convert.ToString(key.GetValue("ProcessorNameString"))??cpu;}catch{}
  string gpu="未知";long vram=0;
  try { using(var searcher=new System.Management.ManagementObjectSearcher("SELECT Name,AdapterRAM FROM Win32_VideoController"))
   foreach(System.Management.ManagementObject card in searcher.Get()) {gpu=Convert.ToString(card["Name"]);vram=Math.Max(vram,Convert.ToInt64(card["AdapterRAM"]));} }catch{}
  var drive=new DriveInfo(Path.GetPathRoot(ModelRoot));
  return new {totalRamGiB=GiB(mem.totalPhysical),availableRamGiB=GiB(mem.availablePhysical),cpu=cpu,
   logicalCores=System.Environment.ProcessorCount,gpu=gpu,vramGiB=Math.Round(vram/1073741824.0,1),
   freeDiskGiB=Math.Round(drive.AvailableFreeSpace/1073741824.0,1),architecture=System.Environment.Is64BitOperatingSystem?"x64":"x86"};
 }
 public static object Status() {
  var catalog=ReadCatalog();var hardware=Hardware();
  var memory=new MemoryStatus{length=(uint)Marshal.SizeOf(typeof(MemoryStatus))};GlobalMemoryStatusEx(ref memory);
  var totalGiB=GiB(memory.totalPhysical);
  var recommendation=catalog.models.Where(x=>x.minimumRamGiB<=totalGiB&&x.minimumLlamaBuild<=InstalledLlamaBuild)
   .OrderByDescending(x=>x.recommendedRamGiB<=totalGiB).ThenByDescending(x=>x.minimumRamGiB).FirstOrDefault();
  var profiles=Patches.Json.Deserialize<LocalProfileFile>(File.ReadAllText(ProfilePath));
   var lite=profiles.profiles.FirstOrDefault(x=>x.id=="lite");var active=lite==null?"":lite.model;
   return new {hardware=hardware,recommended=recommendation==null?"bundled-lite":recommendation.id,active=active,
   llamaBuild=InstalledLlamaBuild,downloadInProgress=downloading,downloadModel=currentDownload,progress=progress,
   models=catalog.models.Select(x=>new{id=x.id,label=x.label,fileName=x.fileName,estimatedBytes=x.estimatedBytes,minimumRamGiB=x.minimumRamGiB,
    recommendedRamGiB=x.recommendedRamGiB,compatible=x.minimumLlamaBuild<=InstalledLlamaBuild,
    hardwareEligible=totalGiB>=x.minimumRamGiB,installed=File.Exists(ModelPath(x)),source=x.source}).ToArray()};
 }
 public static object StartDownload(string id,Action<object> notify) {
  var model=Find(id);Directory.CreateDirectory(ModelRoot);
  lock(guard) {if(downloading)throw new IOException("另一个模型正在下载。");downloading=true;currentDownload=id;progress="准备下载";}
  Task.Run(()=>{
   object result;
   try { Download(model,notify);result=new{phase="complete",id=id,message="下载并校验完成；可在启动器选择模型。"}; }
   catch(Exception e) {progress="下载中断："+e.Message;result=new{phase="error",id=id,message=e.Message};}
   finally {lock(guard){downloading=false;currentDownload="";}}
   try{notify(result);}catch{/* Window closed; the verified/partial model remains on disk. */}
  });
  return new{started=true,id=id};
 }
 static void Download(CatalogModel model,Action<object> notify) {
  var path=ModelPath(model);if(File.Exists(path)&&Hash(path)==model.sha256)return;
  var part=path+".part";long existing=File.Exists(part)?new FileInfo(part).Length:0;
  var drive=new DriveInfo(Path.GetPathRoot(ModelRoot));
  if(drive.AvailableFreeSpace<Math.Max(0,model.estimatedBytes-existing)+1073741824L)
   throw new IOException("模型磁盘空间不足；需要预留模型大小和至少 1 GiB 余量。");
  var request=(HttpWebRequest)WebRequest.Create(model.url);request.UserAgent="LuoXian-ModelManager/1.0";
  request.Timeout=30000;request.ReadWriteTimeout=60000;if(existing>0)request.AddRange(existing);
  using(var response=(HttpWebResponse)request.GetResponse()) {
   var resume=existing>0&&response.StatusCode==HttpStatusCode.PartialContent;
   if(existing>0&&!resume)existing=0;
   var total=existing+response.ContentLength;
   using(var input=response.GetResponseStream())using(var output=new FileStream(part,resume?FileMode.Append:FileMode.Create,FileAccess.Write,FileShare.Read,1048576)) {
    var buffer=new byte[1048576];int count;long written=existing;long last=0;
    while((count=input.Read(buffer,0,buffer.Length))>0) {
     output.Write(buffer,0,count);written+=count;
     if(written-last>=32L*1048576){last=written;progress=(written/1048576)+" MiB";
      notify(new{phase="downloading",id=model.id,bytes=written,totalBytes=total,message=progress});}
    }
    output.Flush(true);
   }
  }
  progress="正在核验 SHA256";notify(new{phase="verifying",id=model.id,message=progress});
  if(Hash(part)!=model.sha256){File.Delete(part);throw new InvalidDataException("下载的 GGUF 校验失败；已清除损坏文件。");}
  if(File.Exists(path))File.Delete(path);
  File.Move(part,path);
 }
 public static object Select(string id) {
  var model=Find(id);var mem=new MemoryStatus{length=(uint)Marshal.SizeOf(typeof(MemoryStatus))};GlobalMemoryStatusEx(ref mem);
  if(GiB(mem.totalPhysical)<model.minimumRamGiB)throw new IOException("此模型所需内存超过本机容量；请选较小的配置。");
  if(model.minimumLlamaBuild>InstalledLlamaBuild)throw new IOException("此模型需要更新的 llama.cpp 运行时；当前版本暂不能加载它。");
  var source=ModelPath(model);if(!File.Exists(source)||Hash(source)!=model.sha256)throw new IOException("模型尚未下载完成或 SHA256 校验失败。");
  var link=Path.Combine(Program.Root,"runtime","models",model.fileName);
  Patches.NoLinks(link);
  if(File.Exists(link)&&Hash(link)!=model.sha256)File.Delete(link);
  if(!File.Exists(link)&&!CreateHardLink(link,source,IntPtr.Zero))
   throw new IOException("无法把模型连接到运行时；请确认模型目录与游戏在同一磁盘。",new Win32Exception(Marshal.GetLastWin32Error()));
  Directory.CreateDirectory(DataRoot);if(!File.Exists(ProfileBackup))File.Copy(ProfilePath,ProfileBackup);
  var profiles=Patches.Json.Deserialize<LocalProfileFile>(File.ReadAllText(ProfilePath));
  foreach(var profile in profiles.profiles) {profile.model=model.fileName;profile.minRamGB=model.minimumRamGiB;
   profile.contextSize=model.contextSize;profile.maxOutputTokens=Math.Max(512,profile.maxOutputTokens);}
  var temp=ProfilePath+".new";File.WriteAllText(temp,Patches.Json.Serialize(profiles));
  if(File.Exists(ProfilePath+".previous"))File.Delete(ProfilePath+".previous");
  File.Replace(temp,ProfilePath,ProfilePath+".previous");
  return new{selected=id,restartRequired=true};
 }
 public static object SelectCustom(string source) {
  if(String.IsNullOrWhiteSpace(source)||!Path.IsPathRooted(source)||!File.Exists(source))throw new IOException("请选择有效的 GGUF 文件。");
  source=Path.GetFullPath(source);
  using(var input=File.OpenRead(source)) {
   var magic=new byte[4];if(input.Read(magic,0,4)!=4||magic[0]!='G'||magic[1]!='G'||magic[2]!='U'||magic[3]!='F')
    throw new InvalidDataException("自选文件不是 GGUF 模型。");
  }
  var size=new FileInfo(source).Length;
  var mem=new MemoryStatus{length=(uint)Marshal.SizeOf(typeof(MemoryStatus))};GlobalMemoryStatusEx(ref mem);
  if(size+3L*1073741824L>(long)mem.totalPhysical)throw new IOException("此 GGUF 加载后预计超过本机内存容量。");
  Directory.CreateDirectory(ModelRoot);
  var hash=Hash(source);var fileName="custom-"+hash.Substring(0,16)+".gguf";
  var path=Path.Combine(ModelRoot,fileName);
  if(!File.Exists(path)||Hash(path)!=hash) {
   if(File.Exists(path))File.Delete(path);
   if(!CreateHardLink(path,source,IntPtr.Zero))
    throw new IOException("自选模型需要位于游戏相同磁盘才能建立连接。",new Win32Exception(Marshal.GetLastWin32Error()));
  }
  var runtimePath=Path.Combine(Program.Root,"runtime","models",fileName);
  Patches.NoLinks(runtimePath);
  if(File.Exists(runtimePath)&&Hash(runtimePath)!=hash)File.Delete(runtimePath);
  if(!File.Exists(runtimePath)&&!CreateHardLink(runtimePath,path,IntPtr.Zero))
   throw new IOException("无法将自选模型连接至游戏运行时。",new Win32Exception(Marshal.GetLastWin32Error()));
  Directory.CreateDirectory(DataRoot);if(!File.Exists(ProfileBackup))File.Copy(ProfilePath,ProfileBackup);
  var profiles=Patches.Json.Deserialize<LocalProfileFile>(File.ReadAllText(ProfilePath));
  foreach(var profile in profiles.profiles){profile.model=fileName;profile.minRamGB=(int)Math.Ceiling((size+3L*1073741824L)/1073741824.0);profile.contextSize=8192;}
  var temp=ProfilePath+".new";File.WriteAllText(temp,Patches.Json.Serialize(profiles));
  if(File.Exists(ProfilePath+".previous"))File.Delete(ProfilePath+".previous");
  File.Replace(temp,ProfilePath,ProfilePath+".previous");
  return new{selected=fileName,restartRequired=true,compatibility="unverified",sha256=hash};
 }
 public static object RestoreBundled() {
  if(!File.Exists(ProfileBackup))return new{selected="bundled-lite",restartRequired=false};
  var temp=ProfilePath+".new";File.Copy(ProfileBackup,temp,true);File.Replace(temp,ProfilePath,ProfilePath+".previous");
  return new{selected="bundled-lite",restartRequired=true};
 }
 public static object Delete(string id) {
  var model=Find(id);var profiles=Patches.Json.Deserialize<LocalProfileFile>(File.ReadAllText(ProfilePath));
  if(profiles.profiles.Any(x=>x.model==model.fileName))throw new IOException("当前模型正在使用，请先切换到随包本地模型。");
  var path=ModelPath(model);if(File.Exists(path))File.Delete(path);
  if(File.Exists(path+".part"))File.Delete(path+".part");
  var link=Path.Combine(Program.Root,"runtime","models",model.fileName);if(File.Exists(link))File.Delete(link);
  return new{deleted=id};
 }
}
}
