using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

namespace Luoxian {
// One SQLite database per journey. The complete validated checkpoint and its
// indexed Engine domains are committed in one transaction; no cloud service is
// involved. Legacy browser saves are imported by save-session.js on first boot.
public static class WorldDatabase {
 const int SqliteOk=0,SqliteRow=100,SqliteDone=101;
 [DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_open_v2(byte[] path,out IntPtr db,int flags,IntPtr vfs);
 [DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_close_v2(IntPtr db);
 [DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_exec(IntPtr db,byte[] sql,IntPtr callback,IntPtr arg,out IntPtr error);
 [DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern void sqlite3_free(IntPtr ptr);
 [DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern IntPtr sqlite3_errmsg(IntPtr db);
 [DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_prepare_v2(IntPtr db,byte[] sql,int length,out IntPtr statement,IntPtr tail);
 [DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_bind_text(IntPtr statement,int index,byte[] value,int length,IntPtr destructor);
 [DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_bind_null(IntPtr statement,int index);
 [DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_step(IntPtr statement);
 [DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_finalize(IntPtr statement);
 [DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern IntPtr sqlite3_column_text(IntPtr statement,int column);
 [DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_column_bytes(IntPtr statement,int column);
 [DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern IntPtr sqlite3_backup_init(IntPtr destination,byte[] destinationName,IntPtr source,byte[] sourceName);
 [DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_backup_step(IntPtr backup,int pages);
 [DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_backup_finish(IntPtr backup);
 static readonly IntPtr Transient=new IntPtr(-1);
 static readonly object Gate=new object();
 static readonly string[] DomainTables={"characters","character_state","character_relationships","character_memories","character_knowledge",
  "locations","location_edges","factions","faction_relations","quests","quest_states","quest_objectives","events","event_queue",
  "narrative_anchors","items","item_instances","inventories","effects","active_effects","player_state","cultivation_state",
  "skills","abilities","secrets","rumors","story_flags","world_flags","generated_entities","save_metadata","ai_session",
  "causal_events","world_beliefs","world_relations","world_rules","world_plans","companion_notifications","world_intents","world_commitments","causal_reports","world_transactions","rule_queue"};
 static readonly string[] HistoryTables={"world_history","turn_ledger","turn_summaries"};
 static byte[] Utf8(string value){return Encoding.UTF8.GetBytes(value+"\0");}
 static string Text(IntPtr ptr,int length){if(ptr==IntPtr.Zero||length<=0)return "";var bytes=new byte[length];Marshal.Copy(ptr,bytes,0,length);return Encoding.UTF8.GetString(bytes);}
 static Dictionary<string,object> Map(object obj){return obj as Dictionary<string,object> ?? new Dictionary<string,object>();}
 static object Field(object obj,string name){var map=Map(obj);object value;return map.TryGetValue(name,out value)?value:null;}
 static string Str(object value){return Convert.ToString(value)??"";}
 static IEnumerable<object> Values(object value){
  var map=value as Dictionary<string,object>;if(map!=null)return map.Values;
  var list=value as IEnumerable;if(list!=null&&!(value is string))return list.Cast<object>();
  return Enumerable.Empty<object>();
 }
 static string SaveRoot {get{return Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData),"LuoXian","Saves");}}
 static string DatabasePath(string root,string worldId){
  if(!Regex.IsMatch(worldId??"",@"^[\p{L}\p{N}_:-]{1,100}$"))throw new InvalidDataException("旅程编号无效。");
  return Path.Combine(root,worldId.Replace(':','_'),"world.db");
 }
 sealed class Db : IDisposable {
  internal IntPtr Handle;
  internal Db(string path,bool readOnly=false){
   if(!readOnly)Directory.CreateDirectory(Path.GetDirectoryName(path));
   var status=sqlite3_open_v2(Utf8(path),out Handle,readOnly?0x00000001:0x00000002|0x00000004,IntPtr.Zero);
   if(status!=SqliteOk)throw new IOException("SQLite 打开失败："+Error());
   Exec(readOnly?"PRAGMA busy_timeout=5000;PRAGMA query_only=ON;":"PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;");
  }
  internal bool HasColumn(string table,string column){
   IntPtr statement;var code=sqlite3_prepare_v2(Handle,Utf8("PRAGMA table_info("+table+");"),-1,out statement,IntPtr.Zero);
   if(code!=SqliteOk)throw new IOException("SQLite schema check: "+Error());
   try{
    while((code=sqlite3_step(statement))==SqliteRow)
     if(Text(sqlite3_column_text(statement,1),sqlite3_column_bytes(statement,1))==column)return true;
    if(code!=SqliteDone)throw new IOException("SQLite schema check: "+Error());
    return false;
   }finally{sqlite3_finalize(statement);}
  }
  internal string Error(){return Marshal.PtrToStringAnsi(sqlite3_errmsg(Handle))??"SQLite error";}
  internal void Exec(string sql){IntPtr error;var code=sqlite3_exec(Handle,Utf8(sql),IntPtr.Zero,IntPtr.Zero,out error);
   if(code!=SqliteOk){var message=error==IntPtr.Zero?Error():Marshal.PtrToStringAnsi(error);if(error!=IntPtr.Zero)sqlite3_free(error);throw new IOException("SQLite: "+message);}}
  internal string Scalar(string sql,params string[] args){return Query(sql,args,false);}
  internal void Run(string sql,params string[] args){Query(sql,args,true);}
  internal List<object> Memories(string sql,string first,string second){
   IntPtr statement;var code=sqlite3_prepare_v2(Handle,Utf8(sql),-1,out statement,IntPtr.Zero);
   if(code!=SqliteOk)throw new IOException("SQLite memory query: "+Error());
   try{
    var one=Encoding.UTF8.GetBytes(first);var two=Encoding.UTF8.GetBytes(second);
    if(sqlite3_bind_text(statement,1,one,one.Length,Transient)!=SqliteOk||sqlite3_bind_text(statement,2,two,two.Length,Transient)!=SqliteOk)
     throw new IOException("SQLite memory bind: "+Error());
    var found=new List<object>();
    while((code=sqlite3_step(statement))==SqliteRow){
     found.Add(new {summary=Text(sqlite3_column_text(statement,0),sqlite3_column_bytes(statement,0)),
      turnId=Text(sqlite3_column_text(statement,1),sqlite3_column_bytes(statement,1))});
    }
    if(code!=SqliteDone)throw new IOException("SQLite memory step: "+Error());
    return found;
   }finally{sqlite3_finalize(statement);}
  }
  string Query(string sql,string[] args,bool noResult){
   IntPtr statement;var code=sqlite3_prepare_v2(Handle,Utf8(sql),-1,out statement,IntPtr.Zero);
   if(code!=SqliteOk)throw new IOException("SQLite prepare: "+Error());
   try{
    for(int i=0;i<args.Length;i++){
     if(args[i]==null)code=sqlite3_bind_null(statement,i+1);
     else{var bytes=Encoding.UTF8.GetBytes(args[i]);code=sqlite3_bind_text(statement,i+1,bytes,bytes.Length,Transient);}
     if(code!=SqliteOk)throw new IOException("SQLite bind: "+Error());
    }
    code=sqlite3_step(statement);
    if(code==SqliteRow&&!noResult)return Text(sqlite3_column_text(statement,0),sqlite3_column_bytes(statement,0));
    if(code!=SqliteDone&&code!=SqliteRow)throw new IOException("SQLite step: "+Error());
    return null;
   }finally{sqlite3_finalize(statement);}
  }
  public void Dispose(){if(Handle!=IntPtr.Zero){sqlite3_close_v2(Handle);Handle=IntPtr.Zero;}}
 }
 static void Backup(Db source,string path){
  if(File.Exists(path))return;
  using(var destination=new Db(path)){
   var handle=sqlite3_backup_init(destination.Handle,Utf8("main"),source.Handle,Utf8("main"));
   if(handle==IntPtr.Zero)throw new IOException("数据库备份无法启动："+destination.Error());
   var step=sqlite3_backup_step(handle,-1);var finish=sqlite3_backup_finish(handle);
   if(step!=SqliteDone||finish!=SqliteOk)throw new IOException("数据库备份未完成："+destination.Error());
  }
 }
 static void Schema(Db db,string path,bool existing){
  int version;if(!Int32.TryParse(db.Scalar("PRAGMA user_version;"),out version))throw new IOException("数据库版本无法读取。");
  if(version>1)throw new IOException("当前游戏不支持更新的世界数据库格式。");
  if(existing&&db.Scalar("SELECT count(*) FROM sqlite_master WHERE type='table'")!="0"&&
   (!db.HasColumn("world_state","record")||!db.HasColumn("world_state","revision")))
   throw new IOException("此旅程使用旧版世界数据库格式，当前存档不会被覆盖。");
  if(existing&&version<1)Backup(db,path+".pre-v1.db");
  db.Exec("CREATE TABLE IF NOT EXISTS worlds(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);"+
   "CREATE TABLE IF NOT EXISTS world_state(world_id TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,revision INTEGER NOT NULL,record TEXT NOT NULL);"+
   "CREATE TABLE IF NOT EXISTS world_history(world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(world_id,id));"+
   "CREATE TABLE IF NOT EXISTS turn_ledger(world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(world_id,id));"+
   "CREATE TABLE IF NOT EXISTS turn_summaries(world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,turn_id TEXT NOT NULL,summary TEXT NOT NULL,world_time INTEGER,importance TEXT,PRIMARY KEY(world_id,turn_id));");
  foreach(var name in DomainTables)db.Exec("CREATE TABLE IF NOT EXISTS "+name+"(world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(world_id,id));");
  db.Exec("CREATE TABLE IF NOT EXISTS causal_links(world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,id TEXT NOT NULL,from_id TEXT NOT NULL,to_id TEXT NOT NULL,kind TEXT NOT NULL,minute INTEGER,payload TEXT NOT NULL,PRIMARY KEY(world_id,id));"+
   "CREATE TABLE IF NOT EXISTS belief_index(world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,id TEXT NOT NULL,holder_id TEXT NOT NULL,event_id TEXT NOT NULL,mode TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(world_id,id));"+
   "CREATE INDEX IF NOT EXISTS idx_causal_from ON causal_links(world_id,from_id,minute);"+
   "CREATE INDEX IF NOT EXISTS idx_causal_to ON causal_links(world_id,to_id,minute);"+
   "CREATE INDEX IF NOT EXISTS idx_causal_kind ON causal_links(world_id,kind,minute);"+
   "CREATE INDEX IF NOT EXISTS idx_belief_holder ON belief_index(world_id,holder_id,event_id);");
  db.Exec("CREATE INDEX IF NOT EXISTS idx_worlds_updated ON worlds(updated_at);"+
   "CREATE INDEX IF NOT EXISTS idx_turn_summary_time ON turn_summaries(world_id,world_time);");
  db.Exec("CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(world_id UNINDEXED,kind UNINDEXED,entity_id UNINDEXED,body,tokenize='unicode61');");
  db.Exec("PRAGMA user_version=1;");
 }
 static void Put(Db db,string table,string worldId,string id,object payload){
  if(String.IsNullOrEmpty(id))return;
  db.Run("INSERT OR REPLACE INTO "+table+"(world_id,id,payload) VALUES(?,?,?)",worldId,id,Patches.Json.Serialize(payload));
 }
 static void PutMap(Db db,string table,string worldId,object container){
  foreach(var entry in Map(container))Put(db,table,worldId,entry.Key,entry.Value);
 }
 static void PutList(Db db,string table,string worldId,object container){
  int index=0;foreach(var value in Values(container)){var id=Str(Field(value,"id"));if(id=="")id=table+":"+(index++);
   Put(db,table,worldId,id,value);}
 }
 static void PutNested(Db db,string table,string worldId,object owners,string field){
  foreach(var owner in Map(owners)){
   int index=0;foreach(var value in Values(Field(owner.Value,field))){var id=Str(Field(value,"id"));
    if(id=="")id=owner.Key+":"+(index++);Put(db,table,worldId,id,value);}
  }
 }
 static void Project(Db db,string worldId,object state,object turn){
  var world=Field(state,"astraWorld");var characters=Field(world,"characters");var factions=Field(world,"factions");
  foreach(var table in DomainTables)db.Run("DELETE FROM "+table+" WHERE world_id=?",worldId);
  db.Run("DELETE FROM causal_links WHERE world_id=?",worldId);
  db.Run("DELETE FROM belief_index WHERE world_id=?",worldId);
  var simulation=Field(world,"simulation");
  var simFields=new[]{"events","beliefs","relations","rules","notifications","intents","commitments","transactions"};
  var simTables=new[]{"causal_events","world_beliefs","world_relations","world_rules","companion_notifications","world_intents","world_commitments","world_transactions"};
  for(int i=0;i<simFields.Length;i++)PutMap(db,simTables[i],worldId,Field(simulation,simFields[i]));
  PutList(db,"causal_reports",worldId,Field(simulation,"pendingReports"));
  PutList(db,"rule_queue",worldId,Field(simulation,"pendingRuleEffects"));
  foreach(var owner in Map(characters))if(Field(owner.Value,"currentPlan")!=null)
   Put(db,"world_plans",worldId,owner.Key,Field(owner.Value,"currentPlan"));
  foreach(var eventRow in Map(Field(simulation,"events")))foreach(var target in Values(Field(eventRow.Value,"targetIds")))
   db.Run("INSERT INTO causal_links(world_id,id,from_id,to_id,kind,minute,payload) VALUES(?,?,?,?,?,?,?)",
    worldId,eventRow.Key+":"+Str(target),Str(Field(eventRow.Value,"actorId")),Str(target),"event",Str(Field(eventRow.Value,"minute")),Patches.Json.Serialize(eventRow.Value));
  foreach(var relation in Map(Field(simulation,"relations")))
   db.Run("INSERT INTO causal_links(world_id,id,from_id,to_id,kind,minute,payload) VALUES(?,?,?,?,?,?,?)",
    worldId,"relation:"+relation.Key,Str(Field(relation.Value,"fromId")),Str(Field(relation.Value,"toId")),Str(Field(relation.Value,"kind")),
    Str(Field(relation.Value,"minute")),Patches.Json.Serialize(relation.Value));
  foreach(var belief in Map(Field(simulation,"beliefs")))
   db.Run("INSERT INTO belief_index(world_id,id,holder_id,event_id,mode,payload) VALUES(?,?,?,?,?,?)",
    worldId,belief.Key,Str(Field(belief.Value,"holderId")),Str(Field(belief.Value,"eventId")),Str(Field(belief.Value,"mode")),Patches.Json.Serialize(belief.Value));
  PutMap(db,"characters",worldId,characters);PutMap(db,"character_state",worldId,characters);
  PutNested(db,"character_memories",worldId,characters,"memories");PutNested(db,"character_knowledge",worldId,characters,"knowledge");
  foreach(var owner in Map(characters))foreach(var relation in Map(Field(owner.Value,"relationships")))
   Put(db,"character_relationships",worldId,owner.Key+":"+relation.Key,relation.Value);
  PutMap(db,"locations",worldId,Field(world,"locations"));PutList(db,"location_edges",worldId,Field(world,"edges"));
  PutMap(db,"factions",worldId,factions);
  foreach(var owner in Map(factions))foreach(var relation in Map(Field(owner.Value,"relations")))
   Put(db,"faction_relations",worldId,owner.Key+":"+relation.Key,relation.Value);
  PutMap(db,"quests",worldId,Field(world,"quests"));PutMap(db,"quest_states",worldId,Field(world,"quests"));
  PutNested(db,"quest_objectives",worldId,Field(world,"quests"),"objectives");
  PutMap(db,"narrative_anchors",worldId,Field(world,"anchors"));PutMap(db,"items",worldId,Field(world,"items"));
  PutMap(db,"item_instances",worldId,Field(world,"items"));PutNested(db,"effects",worldId,Field(world,"items"),"effects");
  PutList(db,"event_queue",worldId,Field(world,"eventQueue"));PutList(db,"events",worldId,Field(world,"history"));
  PutList(db,"rumors",worldId,Field(world,"rumors"));PutList(db,"secrets",worldId,Field(world,"secrets"));
  PutMap(db,"world_flags",worldId,Field(world,"flags"));PutMap(db,"story_flags",worldId,Field(Field(state,"story"),"flags"));
  Put(db,"player_state",worldId,"player",Field(world,"player"));
  Put(db,"cultivation_state",worldId,"player",Field(Field(world,"player"),"cultivation"));
  Put(db,"inventories",worldId,"player",Field(Field(world,"player"),"inventory"));
  PutList(db,"active_effects",worldId,Field(Field(world,"player"),"activeEffects"));
  PutList(db,"skills",worldId,Field(Field(world,"player"),"skills"));
  PutList(db,"abilities",worldId,Field(Field(world,"player"),"abilities"));
  foreach(var domain in new[]{"items","characters","locations","factions","quests"})
   foreach(var entity in Map(Field(world,domain)))if(Field(entity.Value,"generated") is bool&&(bool)Field(entity.Value,"generated"))
    Put(db,"generated_entities",worldId,domain+":"+entity.Key,entity.Value);
  Put(db,"save_metadata",worldId,"checkpoint",new {updatedAt=Field(state,"updatedAt"),revision=Field(state,"revision")});
  Put(db,"ai_session",worldId,"latest",new {provider=Field(turn,"provider"),model=Field(turn,"model")});
  foreach(var rule in Map(Field(world,"rules")))Put(db,"world_rules",worldId,"engine:"+rule.Key,rule.Value);
  foreach(var entry in Values(Field(world,"history"))){var id=Str(Field(entry,"id"));if(id!="")Put(db,"world_history",worldId,id,entry);}
  if(turn!=null){var turnId=Str(Field(turn,"id"));if(turnId!=""){
   Put(db,"turn_ledger",worldId,turnId,turn);
   var summary=Str(Field(turn,"summary"));if(summary!="")db.Run("INSERT OR REPLACE INTO turn_summaries(world_id,turn_id,summary,world_time,importance) VALUES(?,?,?,?,?)",
    worldId,turnId,summary,Str(Field(world,"minute")),Str(Field(turn,"importance")));
  }}
  db.Run("DELETE FROM memory_fts WHERE world_id=? AND kind IN ('history','character')",worldId);
  if(turn!=null){var summary=Str(Field(turn,"summary"));var turnId=Str(Field(turn,"id"));
   if(summary!=""&&turnId!=""){
    db.Run("DELETE FROM memory_fts WHERE world_id=? AND kind='turn' AND entity_id=?",worldId,turnId);
    db.Run("INSERT INTO memory_fts(world_id,kind,entity_id,body) VALUES(?,?,?,?)",worldId,"turn",turnId,summary);
   }}
  foreach(var entry in Values(Field(world,"history"))){var id=Str(Field(entry,"id"));var body=Str(Field(entry,"summary"));
   if(body!="")db.Run("INSERT INTO memory_fts(world_id,kind,entity_id,body) VALUES(?,?,?,?)",worldId,"history",id,body);}
  foreach(var owner in Map(characters))foreach(var memory in Values(Field(owner.Value,"memories"))){var body=Str(Field(memory,"summary"));
   if(body=="")body=Str(Field(memory,"text"));if(body!="")db.Run("INSERT INTO memory_fts(world_id,kind,entity_id,body) VALUES(?,?,?,?)",worldId,"character",owner.Key,body);}
 }
 public static object Save(object record,object turn){return SaveAt(SaveRoot,record,turn);}
 static object SaveAt(string root,object record,object turn){
  var state=Field(record,"state");var worldId=Str(Field(state,"journeyId"));var path=DatabasePath(root,worldId);
  var revision=Str(Field(state,"revision"));int rev;if(!Int32.TryParse(revision,out rev)||rev<0)throw new InvalidDataException("存档修订号无效。");
  lock(Gate){var existed=File.Exists(path);
   if(existed)using(var old=new Db(path,true)){
    if(old.Scalar("SELECT count(*) FROM sqlite_master WHERE type='table'")!="0"&&
     (!old.HasColumn("world_state","record")||!old.HasColumn("world_state","revision")))
     throw new IOException("此旅程使用旧版世界数据库格式，当前存档不会被覆盖。");
   }
   using(var db=new Db(path)){
   Schema(db,path,existed);db.Exec("BEGIN IMMEDIATE;");
   try{
    var previous=db.Scalar("SELECT revision FROM world_state WHERE world_id=?",worldId);int old;
    if(Int32.TryParse(previous,out old)&&old>rev)throw new IOException("数据库中已有更新的旅程修订；旧回合不能覆盖。");
    var now=DateTime.UtcNow.ToString("o");
    db.Run("INSERT OR IGNORE INTO worlds(id,created_at,updated_at) VALUES(?,?,?)",worldId,now,now);
    db.Run("UPDATE worlds SET updated_at=? WHERE id=?",now,worldId);
    Project(db,worldId,state,turn);
    db.Run("INSERT OR REPLACE INTO world_state(world_id,revision,record) VALUES(?,?,?)",worldId,revision,Patches.Json.Serialize(record));
    db.Exec("COMMIT;");
    string backupWarning=null;
    if(rev>0&&rev%50==0)try{Backup(db,Path.Combine(Path.GetDirectoryName(path),"world-r"+rev+".backup.db"));}
     catch(Exception e){backupWarning=e.Message;}
    return new{saved=true,worldId=worldId,revision=rev,backupWarning=backupWarning};
   }catch{db.Exec("ROLLBACK;");throw;}
  }}
 }
 public static object Load(){return LoadAt(SaveRoot);}
 public static object Search(string worldId,string query){return SearchAt(SaveRoot,worldId,query);}
 static List<object> SearchAt(string root,string worldId,string query){
  var path=DatabasePath(root,worldId);if(!File.Exists(path))return new List<object>();
  query=Regex.Replace(query??"",@"[^\p{L}\p{N}\s]"," ").Trim();
  lock(Gate)using(var db=new Db(path,true)){
   if(!db.HasColumn("world_state","record"))return new List<object>();
   if(db.Scalar("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='memory_fts'")!="1")return new List<object>();
   if(query.Length>=2){
    var phrase="\""+query.Substring(0,Math.Min(80,query.Length)).Replace('"',' ')+"\"";
    var matched=db.Memories("SELECT body,entity_id FROM memory_fts WHERE memory_fts MATCH ? AND world_id=? AND kind='turn' ORDER BY rank LIMIT 6",phrase,worldId);
    if(matched.Count>0)return matched;
   }
   return db.Memories("SELECT summary,turn_id FROM turn_summaries WHERE world_id=? AND ? IS NOT NULL ORDER BY world_time DESC,rowid DESC LIMIT 4",worldId,"fallback");
  }
 }
 static object LoadAt(string root){
  if(!Directory.Exists(root))return null;
  string latest=null;DateTime newest=DateTime.MinValue;
  foreach(var directory in Directory.GetDirectories(root)){
   var path=Path.Combine(directory,"world.db");if(!File.Exists(path))continue;
   using(var db=new Db(path,true)){
    if(!db.HasColumn("world_state","record")||!db.HasColumn("world_state","revision"))continue;
    if(db.Scalar("PRAGMA integrity_check;")!="ok")throw new IOException("世界数据库完整性检查失败："+path);
    var raw=db.Scalar("SELECT record FROM world_state LIMIT 1");
    if(raw==null)continue;
    var record=Patches.Json.Deserialize<Dictionary<string,object>>(raw);
    DateTime saved;DateTime.TryParse(Str(Field(record,"savedAt")),out saved);
    if(latest==null||saved>newest){latest=raw;newest=saved;}
   }
  }
  return latest==null?null:Patches.Json.Deserialize<object>(latest);
 }
 public static object SelfTest(string root){
  root=Path.Combine(root,"run-"+Guid.NewGuid().ToString("N"));
  var state=new Dictionary<string,object>{{"journeyId","db-test"},{"revision",1},{"astraWorld",new Dictionary<string,object>{
   {"minute",5},{"player",new Dictionary<string,object>{{"id","player"},{"cultivation",new Dictionary<string,object>{{"realm","none"}}}}},
   {"items",new Dictionary<string,object>{{"pill",new Dictionary<string,object>{{"id","pill"},{"name","无敌破境丹"},{"generated",true},
    {"effects",new object[]{new Dictionary<string,object>{{"type","cultivation.advance_major_realm"},{"magnitude",1}}}}}}}}}}};
  var record=new Dictionary<string,object>{{"state",state},{"savedAt",DateTime.UtcNow.ToString("o")}};
  var simulation=Patches.Json.Deserialize<Dictionary<string,object>>(
   "{\"events\":{\"cause:1\":{\"id\":\"cause:1\",\"actorId\":\"player\",\"locationId\":\"town\",\"minute\":5,\"targetIds\":[\"npc:1\"]}},"+
   "\"beliefs\":{\"belief:1\":{\"id\":\"belief:1\",\"holderId\":\"npc:1\",\"eventId\":\"cause:1\",\"mode\":\"witness\"}},"+
   "\"relations\":{\"rel:1\":{\"id\":\"rel:1\",\"fromId\":\"npc:1\",\"toId\":\"player\",\"kind\":\"trust\"}},"+
   "\"rules\":{\"rule:1\":{\"id\":\"rule:1\",\"version\":1}},\"notifications\":{\"notice:1\":{\"id\":\"notice:1\",\"sourceId\":\"cause:1\"}},"+
   "\"intents\":{\"intent:1\":{\"id\":\"intent:1\"}},\"commitments\":{\"promise:1\":{\"id\":\"promise:1\"}},\"pendingReports\":[]}");
  Map(Field(state,"astraWorld"))["simulation"]=simulation;
  var turn=new Dictionary<string,object>{{"id","turn-1"},{"summary","获得了无敌破境丹。"}};
  SaveAt(root,record,turn);
  state["revision"]=2;record["savedAt"]=DateTime.UtcNow.AddSeconds(1).ToString("o");
  var second=new Dictionary<string,object>{{"id","turn-2"},{"summary","境界已经提升。"}};
  SaveAt(root,record,second);
  var cause=Map(Map(Field(simulation,"events"))["cause:1"]);
  cause["targetIds"]=new object[]{"npc:1","npc:1"};
  state["revision"]=3;
  bool rollbackRejected=false;try{SaveAt(root,record,null);}catch(IOException){rollbackRejected=true;}
  cause["targetIds"]=new object[]{"npc:1"};
  using(var check=new Db(DatabasePath(root,"db-test"),true)){
   if(!rollbackRejected||check.Scalar("SELECT revision FROM world_state")!="2"
    ||check.Scalar("SELECT count(*) FROM causal_links WHERE kind='event'")!="1")
    throw new IOException("中途失败未原子回滚。");
  }
  state["revision"]=1;
  bool staleRejected=false;try{SaveAt(root,record,turn);}catch(IOException){staleRejected=true;}
  for(int revision=3;revision<=50;revision++){state["revision"]=revision;SaveAt(root,record,null);}
  var legacyPath=DatabasePath(root,"legacy-world");
  using(var legacy=new Db(legacyPath)){
   legacy.Exec("CREATE TABLE world_state(world_id TEXT PRIMARY KEY,state_json TEXT NOT NULL,updated_at TEXT NOT NULL);");
   legacy.Run("INSERT INTO world_state(world_id,state_json,updated_at) VALUES(?,?,?)","legacy-world","{}",DateTime.UtcNow.ToString("o"));
  }
  var legacyBytes=File.ReadAllBytes(legacyPath);
  var read=Map(LoadAt(root));var path=DatabasePath(root,"db-test");
  state["journeyId"]="legacy-world";
  bool legacyWriteRejected=false;try{SaveAt(root,record,null);}catch(IOException){legacyWriteRejected=true;}
  state["journeyId"]="db-test";
  if(!legacyWriteRejected)throw new IOException("旧世界数据库未拒绝不兼容的写入。");
  if(!legacyBytes.SequenceEqual(File.ReadAllBytes(legacyPath)))throw new IOException("旧世界数据库在读取时被修改。");
  var recalled=SearchAt(root,"db-test","无敌破境丹");
  var backupPresent=File.Exists(Path.Combine(Path.GetDirectoryName(path),"world-r50.backup.db"));
  using(var db=new Db(path)){
   var item=db.Scalar("SELECT payload FROM generated_entities WHERE id='items:pill'");
   var summary=db.Scalar("SELECT summary FROM turn_summaries WHERE turn_id='turn-1'");
   var fts=db.Scalar("SELECT body FROM memory_fts LIMIT 1");
   foreach(var table in new[]{"causal_events","world_beliefs","world_relations","world_rules","companion_notifications","world_intents","world_commitments"})
    if(db.Scalar("SELECT count(*) FROM "+table)!="1")throw new IOException("因果域未保存："+table);
   if(db.Scalar("SELECT count(*) FROM causal_links WHERE from_id='player' AND to_id='npc:1'")!="1"
    ||db.Scalar("SELECT count(*) FROM belief_index WHERE holder_id='npc:1' AND event_id='cause:1'")!="1")
    throw new IOException("因果查询索引未保存。");
   if(Str(Field(Field(read,"state"),"journeyId"))!="db-test"||item==null||summary!="获得了无敌破境丹。"||fts!=summary||recalled.Count<1
    ||db.Scalar("SELECT count(*) FROM turn_summaries")!="2"||db.Scalar("SELECT count(*) FROM memory_fts WHERE kind='turn'")!="2"
    ||db.Scalar("SELECT count(*) FROM effects")!="1"||!staleRejected||!backupPresent)
    throw new IOException("SQLite 自测读写失败。");
   return new{passed=true,path=path,summary=summary,generatedItem=item!=null,ftsAvailable=fts!=null,staleRejected=staleRejected,
    backupPresent=backupPresent,rollbackRejected=rollbackRejected,causalProjections=true,integrity=db.Scalar("PRAGMA integrity_check;")};
  }
 }
}
}
