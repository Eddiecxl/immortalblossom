using System;
using System.IO;
using Luoxian;
class WorldSimulationProbe {
 static int Main(string[] args) {
  try { Console.WriteLine(Patches.Json.Serialize(WorldDatabase.SelfTest(Path.GetFullPath(args[0])))); return 0; }
  catch(Exception e) { Console.Error.WriteLine(e); return 1; }
 }
}
