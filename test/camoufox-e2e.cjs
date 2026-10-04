'use strict';
const {_electron:electron}=require('playwright');
const http=require('node:http'),https=require('node:https'),forge=require('node-forge'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=60000){const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await delay(150);}throw Error(`Timed out: ${label}`);}
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arus-camoufox-test-'));
 const keys=forge.pki.rsa.generateKeyPair(2048),cert=forge.pki.createCertificate();cert.publicKey=keys.publicKey;cert.serialNumber='03';cert.validity.notBefore=new Date(Date.now()-60000);cert.validity.notAfter=new Date(Date.now()+86400000);const attrs=[{name:'commonName',value:'localhost'}];cert.setSubject(attrs);cert.setIssuer(attrs);cert.setExtensions([{name:'basicConstraints',cA:true},{name:'keyUsage',digitalSignature:true,keyCertSign:true,keyEncipherment:true},{name:'subjectAltName',altNames:[{type:2,value:'localhost'},{type:7,ip:'127.0.0.1'}]}]);cert.sign(keys.privateKey,forge.md.sha256.create());const pem=forge.pki.certificateToPem(cert),caPath=path.join(directory,'upstream.crt');fs.writeFileSync(caPath,pem);
 const secure=https.createServer({key:forge.pki.privateKeyToPem(keys.privateKey),cert:pem},(_req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type','application/json');res.end('{"secure":true}');});const tlsPort=await new Promise(r=>secure.listen(0,'127.0.0.1',()=>r(secure.address().port)));
 const seen=[];
 const server=http.createServer((req,res)=>{
   seen.push({url:req.url,method:req.method,cookie:req.headers.cookie||'',ua:req.headers['user-agent']||''});
   res.setHeader('Content-Type','text/html');
   if(req.url==='/start')res.end(`<!doctype html><h1>Camoufox fixture</h1><script>
     document.cookie='camoufox_session=shared; path=/';window.onbeforeunload=()=>false;
     addEventListener('message',e=>{if(e.origin===location.origin&&e.data==='popup-ready')fetch('/opener-ok');});
     const popup=window.open('about:blank','camoufox-popup');if(popup){popup.location='/popup';fetch('/popup-created');}else fetch('/popup-blocked');
     fetch('https://localhost:${tlsPort}/secure-camoufox');
   </script>`);
   else if(req.url==='/popup')res.end(`<!doctype html><h1>Popup fixture</h1><script>window.onbeforeunload=()=>false;window.opener.postMessage('popup-ready',location.origin);const f=document.createElement('form');f.action='/popup-post';f.method='POST';f.target='_blank';f.innerHTML='<input name="popup" value="works">';document.body.append(f);f.submit();</script>`);
   else res.end('<h1>Captured</h1>');
 });const port=await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
 let app;
 try{
   app=await electron.launch({...(process.env.ARUS_E2E_EXECUTABLE?{executablePath:path.resolve(process.env.ARUS_E2E_EXECUTABLE)}:{}),args:[...(process.env.ARUS_E2E_EXECUTABLE?[]:[path.join(__dirname,'..')]),`--user-data-dir=${directory}`,...(process.platform==='linux'?['--no-sandbox','--disable-dev-shm-usage']:[])],env:{...process.env,NODE_EXTRA_CA_CERTS:caPath,CAMOUFOX_INSTALL_DIR:process.env.CAMOUFOX_INSTALL_DIR||path.join(os.tmpdir(),'arus-camoufox-cache')},timeout:30000});
   const page=await app.firstWindow();await page.waitForSelector('#browser-kind');
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await until(()=>page.evaluate(async()=>(await window.arus.state()).engine==='ready'),'engine ready');
   await page.locator('#browser-kind').selectOption('camoufox');await page.locator('#target-url').fill(`http://127.0.0.1:${port}/start`);await page.locator('#open-button').click();
   await until(async()=>{const state=await page.evaluate(async()=>window.arus.state());if(state.camoufox==='error')throw Error(await page.locator('#toast').textContent());return state.browserOpen;},'Camoufox launch',300000);
   try{await until(()=>Promise.resolve(seen.some(r=>r.url==='/opener-ok')&&seen.some(r=>r.url==='/popup-post')),'popup/session/opener/form');}catch(error){const state=await page.evaluate(async()=>window.arus.state());throw Error(error.message+' '+JSON.stringify({seen,state:state.camoufox,rows:state.rows.map(r=>({url:r.url,status:r.status,error:r.error})),toast:await page.locator('#toast').textContent()}));}
   assert(!seen.some(r=>r.url==='/popup-blocked'));
   assert(seen.find(r=>r.url==='/popup').cookie.includes('camoufox_session=shared'));
   assert.equal(seen.find(r=>r.url==='/popup-post').method,'POST');assert(seen.find(r=>r.url==='/start').ua.includes('Firefox/'));
   await until(()=>page.evaluate(async()=>(await window.arus.state()).rows.some(r=>r.url.includes('/secure-camoufox')&&r.status===200)),'Camoufox HTTPS capture');
   const state=await page.evaluate(async()=>window.arus.state());assert.equal(state.browserKind,'camoufox');assert.equal(state.camoufox,'ready');
   const post=state.rows.find(r=>r.url.endsWith('/popup-post')&&r.status===200);assert(post,'popup POST captured');const detail=await page.evaluate(id=>window.arus.detail(id),post.id);assert.equal(detail.requestBody,'popup=works');
   await page.locator('#close-browser').click();await until(()=>page.evaluate(async()=>!(await window.arus.state()).browserOpen),'close root and popups');
   const openBefore=seen.filter(r=>r.url==='/reopened').length;
   await page.locator('#target-url').fill(`http://127.0.0.1:${port}/reopened`);await page.locator('#open-button').click();await until(()=>Promise.resolve(seen.filter(r=>r.url==='/reopened').length>openBefore),'reopen cached engine');
   await page.locator('#close-browser').click();await until(()=>page.evaluate(async()=>!(await window.arus.state()).browserOpen),'close reopened browser');
   assert.deepEqual(errors,[]);console.log('PASS: real Camoufox launch, Firefox UA, shared popup session, opener, nested form POST, HTTP/HTTPS capture, close despite beforeunload, cached relaunch');
 }finally{if(app)await app.close();await new Promise(r=>server.close(r));await new Promise(r=>secure.close(r));fs.rmSync(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
