const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Agent,FILES,endpoint,safeRow,validateArgs,validateFiles}=require('../src/agent.cjs');
async function fixture(options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'arus-agent-'));
 const agent=new Agent({directory,context:async()=>({selected:null}),execute:async()=>({ok:true}),notify:()=>{},...options});await agent.ready;
 await agent.save({baseUrl:'http://127.0.0.1:20128/v1',model:'test-model',key:'private-key',files:agent.config.files});return {agent,directory,close:()=>fs.rm(directory,{recursive:true,force:true})};
}
const reply=message=>new Response(JSON.stringify({choices:[{message}]}),{status:200});
test('agent redacts nested secrets and omits non-JSON bodies',()=>{
 const row=safeRow({id:'a',url:'https://example.com/api?token=SECRET&sort=new',method:'GET',requestHeaders:{authorization:'Bearer SECRET','x-access-token':'SECRET'},responseHeaders:{'set-cookie':'SECRET'},requestBody:'password=SECRET',responseBody:JSON.stringify({ok:true,nested:{password:'SECRET',email:'SECRET'},token:'SECRET'})},true);
 assert(!JSON.stringify(row).includes('SECRET'));assert(row.requestBody.includes('omitted'));assert(row.responseBody.includes('REDACTED'));assert(row.url.includes('sort=new'));
});
test('agent validates provider endpoint and tool permissions',()=>{
 for(const url of ['http://example.com/v1','file:///tmp/key','https://a:b@example.com/v1','https://example.com/v1?key=foo'])assert.throws(()=>endpoint(url));
 assert.equal(endpoint('http://localhost:20128/v1/'),'http://localhost:20128/v1');assert.throws(()=>validateArgs('shell',{command:'whoami'}));assert.throws(()=>validateArgs('control_capture',{action:'delete'}));assert.throws(()=>validateArgs('filter_traffic',{extra:'bad'}));
 const files=Object.fromEntries(FILES.map(n=>[n,'okay']));assert.deepEqual(validateFiles(files),files);assert.throws(()=>validateFiles({...files,'../secret.md':'oops'}));assert.throws(()=>validateFiles({...files,'SOUL.md':'x'.repeat(24001)}));
});
test('profile persistence never stores plaintext key without OS encryption',async()=>{
 const f=await fixture();try{const saved=await fs.readFile(path.join(f.directory,'agent-settings.json'),'utf8');assert(!saved.includes('private-key'));assert(!JSON.stringify(f.agent.state()).includes('private-key'));assert.equal(f.agent.state().hasKey,true);
 const next=new Agent({directory:f.directory,context:async()=>({}),execute:async()=>{},notify:()=>{}});await next.ready;assert.equal(next.state().hasKey,false);assert.deepEqual(next.config.files,f.agent.config.files);}
 finally{await f.close();}
});
test('tool loop uses five profiles, validates calls, and retains complete turns',async()=>{
 const sent=[],executed=[];let step=0;
 const f=await fixture({fetch:async(url,options)=>{sent.push(JSON.parse(options.body));assert.equal(url,'http://127.0.0.1:20128/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer private-key');return ++step===1?reply({content:null,tool_calls:[{id:'call1',type:'function',function:{name:'filter_traffic',arguments:'{"filter":"errors"}'}}]}):reply({content:'Filter error sudah ditampilkan.'});},execute:async(name,args)=>{executed.push({name,args});return {ok:true};}});
 try{const result=await f.agent.chat({text:'Cari error'});assert(result.text.includes('error'));assert.equal(executed[0].name,'filter_traffic');for(const name of FILES)assert(sent[0].messages[0].content.includes(name));assert.equal(sent[1].messages.at(-1).role,'tool');assert.equal(f.agent.turns.length,1);assert.equal(f.agent.turns[0][2].role,'tool');f.agent.reset();assert.equal(f.agent.turns.length,0);}
 finally{await f.close();}
});
test('unsupported tools never execute and failed turns do not corrupt history',async()=>{
 let executed=0,step=0;const f=await fixture({execute:async()=>executed++,fetch:async()=>++step===1?reply({content:null,tool_calls:[{id:'x',type:'function',function:{name:'shell',arguments:'{}'}}]}):new Response('',{status:401})});
 try{await assert.rejects(f.agent.chat({text:'test'}),/401/);assert.equal(executed,0);assert.equal(f.agent.turns.length,0);assert.equal(f.agent.state().busy,false);}finally{await f.close();}
});
test('stop aborts pending provider request and releases busy state',async()=>{
 const f=await fixture({fetch:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
 try{const pending=f.agent.chat({text:'test'});await new Promise(r=>setTimeout(r,20));await assert.rejects(f.agent.save({}),/Tunggu/);f.agent.cancel();await assert.rejects(pending,/dihentikan/);assert.equal(f.agent.state().busy,false);}finally{await f.close();}
});

test('form bodies decode duplicates and nested JSON while masking login and signatures',()=>{
 const {parseForm}=require('../src/body.js');const body=new URLSearchParams([['Action','UploadLog'],['note','hello + world'],['tag','one'],['tag','two'],['Signature','signature-secret'],['password','password-secret'],['log',JSON.stringify({event:'clicked',token:'nested-secret'})],['payload','<img src=x onerror="alert(1)">']]).toString();
 assert.equal(parseForm(body).entries.find(([k])=>k==='note')[1],'hello + world');assert.equal(parseForm(body).entries.filter(([k])=>k==='tag').length,2);assert.equal(parseForm('a=1&b=2&c=3',2).truncated,true);
 const row=safeRow({id:'form',url:'https://example.com/form',requestHeaders:{'Content-Type':'Application/X-WWW-Form-Urlencoded; charset=UTF-8'},requestBody:body},true),form=JSON.parse(row.requestBody);
 assert.equal(form.format,'form-urlencoded');assert.equal(form.fields.find(f=>f.name==='Action').value,'UploadLog');assert.equal(form.fields.filter(f=>f.name==='tag').length,2);assert.equal(form.fields.find(f=>f.name==='log').value.event,'clicked');for(const value of ['signature-secret','password-secret','nested-secret'])assert(!row.requestBody.includes(value));assert.equal(form.fields.find(f=>f.name==='Signature').value,'[REDACTED]');
});
