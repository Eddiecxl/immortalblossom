using System;
using System.IO;
using System.Linq;
using Luoxian;

// Compiled with the production Patches.cs by Build-AstraPatch.ps1.
internal static class PatchProbe {
 static int Main(string[] args) {
  try {
   if(args.Length!=3) throw new Exception("Expected <patch> <scratch install> <target version>.");
   string patch=args[0], root=args[1], target=args[2];
   string sentinel=Path.Combine(root,"Saves","sentinel.txt");
   var manifest=Patches.Validate(patch,root,null);
   if(manifest.toVersion!=target) throw new Exception("Unexpected target version.");
   Patches.Apply(patch,root,0);
   if(Patches.Version(root)!=target) throw new Exception("Root version was not advanced.");
   if(File.ReadAllText(sentinel)!="keep-this-save") throw new Exception("Save sentinel changed.");
   foreach(var file in manifest.files) {
    string installed=Patches.Target(root,file.path);
    if(!File.Exists(installed)) throw new Exception("Missing installed file: "+file.path);
    using(var stream=File.OpenRead(installed)) if(Patches.Hash(stream)!=file.sha256) throw new Exception("Installed hash mismatch: "+file.path);
   }
   Console.WriteLine("PASS: native Validate and Apply, installed hashes, version and save sentinel ("+manifest.fromVersion+")");
   return 0;
  } catch(Exception error) { Console.Error.WriteLine(error); return 1; }
 }
}
