import fs from 'node:fs';
import path from 'node:path';
const [root,destination]=process.argv.slice(2);
if(!root||!destination)throw Error('Usage: node summarize-native-evidence.mjs evidence-root output.json');
const sessions=[];
for(const directory of fs.readdirSync(root).filter(name=>name.startsWith('v413-')).sort()){
  const file=path.join(root,directory,'report.json');
  if(!fs.existsSync(file))continue;
  const report=JSON.parse(fs.readFileSync(file,'utf8'));
  const turns=(report.results||[]).filter(row=>Object.hasOwn(row,'speech')).map(row=>({
    speech:row.speech,action:row.action,committed:row.committed,
    blocks:row.turn?.blocks.map(block=>({type:block.type,name:block.name,text:block.text})),
    diagnostics:row.turn?.diagnostics,location:row.after?.location,
    requestStatus:(row.requests||[]).map(q=>q.status||q.error),
    transfers:(row.after?.items||[]).filter(item=>item.transferHistory?.length).map(item=>({id:item.id,name:item.name,ownerId:item.ownerId,history:item.transferHistory})),
    agreements:row.after?.commitments||[],quests:(row.after?.quests||[]).map(q=>({id:q.id,title:q.title,state:q.state}))
  }));
  const last=report.results?.at(-1)?.after;
  const invalidFixture=turns.some(row=>/把undefined交给/u.test(row.action||''));
  sessions.push({directory,validSession:!report.error&&!invalidFixture&&turns.length>0,invalidFixture,error:report.error,
    openingLocation:report.results?.find(row=>row.opening)?.opening.location,
    openingPeople:report.results?.find(row=>row.opening)?.opening.people?.map(n=>({id:n.id,name:n.name})),
    turns,requests:(report.trace||[]).map(q=>({status:q.status,seconds:q.seconds})),
    browserErrors:report.errors||[],durableCheckpointMatches:!!last&&report.durable?.endId===last.endId,
    durableTransfers:report.durable?.items?.filter(item=>item.transferHistory?.length).map(item=>({id:item.id,ownerId:item.ownerId})),
    durableAgreements:report.durable?.commitments});
}
const valid=sessions.filter(s=>s.validSession);
const result={generatedAt:new Date().toISOString(),notes:'Actual native UI/model sessions; earlier failures are retained as debugging evidence, not successful final validation. The fixture lacking an NPC or item name is excluded from valid sessions. Local model remains user-selected Qwen3 14B Q4_K_M; groq-named sessions use the configured Groq route.',
  completedSessions:valid.length,attemptedTurns:valid.reduce((sum,s)=>sum+s.turns.length,0),
  committedTurns:valid.reduce((sum,s)=>sum+s.turns.filter(t=>t.committed).length,0),sessions};
fs.mkdirSync(path.dirname(destination),{recursive:true});
fs.writeFileSync(destination,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({sessions:result.completedSessions,attempted:result.attemptedTurns,committed:result.committedTurns}));
