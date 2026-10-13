using System;
using System.IO;
using System.Collections.Generic;
namespace Luoxian {
static class Program { internal static string Root=AppDomain.CurrentDomain.BaseDirectory; }
static class ModelBudgetProbe {
 static void Main(string[] args) {
  var path=Path.Combine(Path.GetFullPath(args[0]),"budget-fixture.json");Directory.CreateDirectory(Path.GetDirectoryName(path));
  File.WriteAllText(path,"{\"schemaVersion\":1,\"future\":\"keep\",\"profiles\":[{\"id\":\"lite\",\"model\":\"chosen.gguf\",\"contextSize\":8192,\"threads\":4,\"maxOutputTokens\":512,\"custom\":true},{\"contextSize\":8192,\"maxOutputTokens\":640},{\"contextSize\":2048,\"maxOutputTokens\":512},{\"contextSize\":8192,\"maxOutputTokens\":300},{\"contextSize\":8192,\"maxOutputTokens\":2000}]}");
  if(!ModelManager.UpgradeNarrativeBudget(path))throw new Exception("Legacy budget was not migrated");
  var data=Patches.Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(path));
  var rows=Patches.Json.Deserialize<LocalProfileFile>(File.ReadAllText(path)).profiles;
  if(rows[0].maxOutputTokens!=1024||rows[1].maxOutputTokens!=1024||rows[2].maxOutputTokens!=512||rows[3].maxOutputTokens!=300||rows[4].maxOutputTokens!=2000)throw new Exception("Budget preservation failure");
  if(rows[0].model!="chosen.gguf"||rows[0].threads!=4||!File.ReadAllText(path).Contains("\"custom\":true")||!data.ContainsKey("future"))throw new Exception("Other settings changed");
  var before=File.ReadAllText(path);if(ModelManager.UpgradeNarrativeBudget(path)||before!=File.ReadAllText(path))throw new Exception("Migration not idempotent");
  Console.WriteLine("PASS: legacy budgets, small context, custom settings, unknown fields, repeat startup");
 }
}}
