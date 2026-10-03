const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),https=require('node:https'),tls=require('node:tls'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{fork}=require('node:child_process');
const forge=require('node-forge');
function certificate(){const keys=forge.pki.rsa.generateKeyPair(2048),c=forge.pki.createCertificate();c.publicKey=keys.publicKey;c.serialNumber='01';c.validity.notBefore=new Date(Date.now()-60000);c.validity.notAfter=new Date(Date.now()+86400000);const attrs=[{name:'commonName',value:'localhost'}];c.setSubject(attrs);c.setIssuer(attrs);c.setExtensions([{name:'basicConstraints',cA:true},{name:'keyUsage',keyCertSign:true,digitalSignature:true,keyEncipherment:true},{name:'subjectAltName',altNames:[{type:2,value:'localhost'},{type:7,ip:'127.0.0.1'}]}]);c.sign(keys.privateKey,forge.md.sha256.create());return {key:forge.pki.privateKeyToPem(keys.privateKey),cert:forge.pki.certificateToPem(c)};}
function listen(s){return new Promise(resolve=>s.listen(0,'127.0.0.1',()=>resolve(s.address().port)));}
function waitFor(child,predicate){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.removeListener('message',on);reject(new Error('Engine event timeout'));},15000);const on=msg=>{if(predicate(msg)){clearTimeout(timer);child.removeListener('message',on);resolve(msg);}};child.on('message',on);});}
function proxyGet(port,url){return new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port,path:url,headers:{host:new URL(url).host}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);});}
function proxyTls(port,target,ca){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,method:'CONNECT',path:`127.0.0.1:${target}`});req.on('error',reject);req.on('connect',(_res,socket)=>{const secure=tls.connect({socket,servername:'localhost',ca},()=>secure.write(`GET /secure HTTP/1.1\r\nHost: localhost:${target}\r\nConnection: close\r\n\r\n`));let data='';secure.on('data',b=>data+=b);secure.on('end',()=>resolve(data));secure.on('error',reject);});req.end();});}
test('Whistle captures HTTP and HTTPS, trusts upstream certs and rejects invalid TLS', {timeout:60000},async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arus-test-')),keys=certificate(),caPath=path.join(directory,'upstream.crt');fs.writeFileSync(caPath,keys.cert);
 const handler=(req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,path:req.url}));};
 const upstream=http.createServer(handler),secure=https.createServer(keys,handler),untrusted=https.createServer(certificate(),handler);
 const port=await listen(upstream),tlsPort=await listen(secure),badPort=await listen(untrusted);
 const child=fork(path.join(__dirname,'../src/engine.cjs'),[],{stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,NODE_EXTRA_CA_CERTS:caPath}});let stderr='';child.stderr.on('data',b=>stderr+=b);
 t.after(()=>{child.kill();upstream.close();secure.close();untrusted.close();fs.rmSync(directory,{recursive:true,force:true});});
 const ready=waitFor(child,m=>m.kind==='ready');child.send({kind:'start',directory});const engine=await ready;
 const capture=waitFor(child,m=>m.kind==='rows' && m.rows.some(r=>r.url.endsWith('/hello') && r.status===200 && r.responseBody.includes('"ok":true')));
 const response=await proxyGet(engine.port,`http://127.0.0.1:${port}/hello`);assert.equal(response.status,200);await capture;
 const httpsCapture=waitFor(child,m=>m.kind==='rows' && m.rows.some(r=>r.url.includes('/secure') && r.status===200 && r.responseBody.includes('"ok":true')));
 const raw=await proxyTls(engine.port,tlsPort,engine.certificate);assert(raw.includes('200 OK'));assert(raw.includes('"ok":true'));await httpsCapture;
 const bad=await proxyTls(engine.port,badPort,engine.certificate);assert(!bad.includes('"ok":true'),'untrusted upstream must not pass through');
 child.send({kind:'clear',epoch:5});
 const next=waitFor(child,m=>m.kind==='rows' && m.epoch===5 && m.rows.some(r=>r.url.endsWith('/after-clear')));await proxyGet(engine.port,`http://127.0.0.1:${port}/after-clear`);await next;
 assert(!stderr.includes('uncaught'),stderr);
});
