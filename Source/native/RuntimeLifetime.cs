using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Luoxian {
// Only the launcher owns this non-inheritable job handle. Windows closes it on
// normal exit, crashes, or forced termination, removing the runtime process tree.
sealed class RuntimeLifetime : IDisposable {
 sealed class JobHandle : SafeHandleZeroOrMinusOneIsInvalid {
  public JobHandle():base(true){} protected override bool ReleaseHandle(){return CloseHandle(handle);}
 }
 [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
  public long PerProcessUserTimeLimit,PerJobUserTimeLimit;public uint LimitFlags;
  public UIntPtr MinimumWorkingSetSize,MaximumWorkingSetSize;public uint ActiveProcessLimit;
  public UIntPtr Affinity;public uint PriorityClass,SchedulingClass;
 }
 [StructLayout(LayoutKind.Sequential)] struct IoCounters {public ulong ReadOperationCount,WriteOperationCount,OtherOperationCount,ReadTransferCount,WriteTransferCount,OtherTransferCount;}
 [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {public BasicLimits Basic;public IoCounters Io;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct StartupInfo {
  public int cb;public string reserved,desktop,title;public uint x,y,xSize,ySize,xCountChars,yCountChars,fillAttribute,flags;
  public ushort showWindow,reserved2;public IntPtr reservedPointer,stdInput,stdOutput,stdError;
 }
 [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {public IntPtr process,thread;public uint processId,threadId;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern JobHandle CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(JobHandle job,int informationClass,ref ExtendedLimits limits,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(JobHandle job,IntPtr process);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inheritHandles,uint flags,IntPtr environment,string directory,ref StartupInfo startup,out ProcessInfo process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 readonly JobHandle job;
 public RuntimeLifetime(){job=CreateJobObject(IntPtr.Zero,null);if(job.IsInvalid)throw new Win32Exception(Marshal.GetLastWin32Error());var limits=new ExtendedLimits();limits.Basic.LimitFlags=0x2000; // KILL_ON_JOB_CLOSE
  if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits)))){int error=Marshal.GetLastWin32Error();job.Dispose();throw new Win32Exception(error);}
 }
 public Process Start(string executable,string directory){
  var startup=new StartupInfo{cb=Marshal.SizeOf(typeof(StartupInfo)),flags=1,showWindow=0};ProcessInfo info;
  if(!CreateProcess(executable,new StringBuilder("\""+executable+"\""),IntPtr.Zero,IntPtr.Zero,false,0x08000004,IntPtr.Zero,directory,ref startup,out info))throw new Win32Exception(Marshal.GetLastWin32Error());
  try{
   // Assign before resuming: the runtime cannot spawn an unowned child first.
   if(!AssignProcessToJobObject(job,info.process))throw new Win32Exception(Marshal.GetLastWin32Error());
   var process=Process.GetProcessById((int)info.processId);
   if(ResumeThread(info.thread)==uint.MaxValue){process.Dispose();throw new Win32Exception(Marshal.GetLastWin32Error());}
   return process;
  }catch{TerminateProcess(info.process,1);throw;}finally{CloseHandle(info.thread);CloseHandle(info.process);}
 }
 public void Dispose(){job.Dispose();}
}
}
