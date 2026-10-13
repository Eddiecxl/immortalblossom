// Diagnostic only: replay one captured, credential-free local request directly
// against an explicitly started llama.cpp. Never commits a game turn.
import fs from 'node:fs';
const [reportPath,outputPath,endpoint='http://127.0.0.1:24826/v1/chat/completions',index='2']=process.argv.slice(2);
const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
const row=report.results.filter(row=>row.speech)[Number(index)];
const captured=row.requests.find(row=>row.status===200)?.request;
if(!captured||captured.provider)throw Error('Choose a captured LOCAL request only.');
const started=Date.now();
const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({model:'local',messages:captured.messages,temperature:captured.temperature,
 max_tokens:captured.maxTokens,response_format:{type:'json_object'}}),signal:AbortSignal.timeout(180000)});
const data=await response.json();
const result={input:row.speech,status:response.status,seconds:(Date.now()-started)/1000,
 maxTokens:captured.maxTokens,usage:data.usage,finishReason:data.choices?.[0]?.finish_reason,
 direct:data.choices?.[0]?.message,native:row.requests.filter(r=>r.status===200).map(r=>r.response.text)};
fs.writeFileSync(outputPath,JSON.stringify(result,null,2));
console.log(JSON.stringify({status:result.status,seconds:result.seconds,usage:result.usage,finishReason:result.finishReason}));
if(!response.ok)process.exitCode=1;
