const {_electron:electron}=require('playwright');
const http=require('node:http'),https=require('node:https'),forge=require('node-forge'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const start=Date.now();while(Date.now()-start<20000){if(await fn())return;await wait(100);}throw new Error(`Timed out: ${label}`);}
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arus-desktop-'));
 const keys=forge.pki.rsa.generateKeyPair(2048),cert=forge.pki.createCertificate();cert.publicKey=keys.publicKey;cert.serialNumber='02';cert.validity.notBefore=new Date(Date.now()-60000);cert.validity.notAfter=new Date(Date.now()+86400000);const attrs=[{name:'commonName',value:'localhost'}];cert.setSubject(attrs);cert.setIssuer(attrs);cert.setExtensions([{name:'basicConstraints',cA:true},{name:'keyUsage',digitalSignature:true,keyCertSign:true,keyEncipherment:true},{name:'subjectAltName',altNames:[{type:2,value:'localhost'},{type:7,ip:'127.0.0.1'}]}]);cert.sign(keys.privateKey,forge.md.sha256.create());const pem=forge.pki.certificateToPem(cert),caPath=path.join(directory,'upstream.crt');fs.writeFileSync(caPath,pem);
 const secure=https.createServer({key:forge.pki.privateKeyToPem(keys.privateKey),cert:pem},(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>HTTPS captured</h1>');});const tlsPort=await new Promise(r=>secure.listen(0,'127.0.0.1',()=>r(secure.address().port)));
 const server=http.createServer((req,res)=>{
   if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><title>Arus test store</title><h1>Arus local test</h1><script>Promise.all(['/api/products','/api/profile','/api/orders','/api/categories','/api/notifications','/api/config','/api/missing'].map(url=>fetch(url))).then(()=>fetch('/api/cart',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:42,quantity:2})}));</script>`);return;}
   res.setHeader('Content-Type','application/json');res.setHeader('X-Arus-Test','true');
   if(req.url==='/api/missing')res.statusCode=404;
   res.end(JSON.stringify({ok:res.statusCode===200,path:req.url,products:[{id:42,name:'Everyday notebook',price:49000},{id:43,name:'Desk lamp',price:189000}],message:'<img src=x onerror="window.compromised=true">'}));
 });
 const port=await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
 let app;
 try{
   app=await electron.launch({...(process.env.ARUS_E2E_EXECUTABLE?{executablePath:path.resolve(process.env.ARUS_E2E_EXECUTABLE)}:{}),args:[...(process.env.ARUS_E2E_EXECUTABLE?[]:[path.join(__dirname,'..')]),`--user-data-dir=${directory}`,...(process.platform==='linux'?['--no-sandbox','--disable-dev-shm-usage']:[])],env:{...process.env,NODE_EXTRA_CA_CERTS:caPath},timeout:30000});
   const page=await app.firstWindow();await page.waitForSelector('#open-button');
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await until(()=>page.evaluate(async()=>(await window.arus.state()).engine==='ready'),'proxy ready');
   fs.mkdirSync(path.join(__dirname,'../artifacts'),{recursive:true});
   await page.screenshot({path:path.join(__dirname,'../artifacts/empty.png')});
   await page.locator('#target-url').fill(`http://127.0.0.1:${port}/`);await page.locator('#open-button').click();
   await until(()=>page.evaluate(async()=>(await window.arus.state()).rows.some(r=>r.url.endsWith('/api/cart') && r.status===200)),'capture requests');
   const browser=(await app.windows()).find(w=>w!==page);assert(browser,'capture browser exists');
   assert.equal(await browser.evaluate(()=>typeof window.arus),'undefined');assert.equal(await browser.evaluate(()=>typeof require),'undefined');
   await page.bringToFront();
   await until(async()=>await page.locator('.traffic-row').count()>=8,'table rows');
   const request=page.locator('.traffic-row').filter({hasText:'/api/products'}).first();await request.click();
   await until(async()=>await page.locator('#detail-view').textContent().then(t=>t.includes('Everyday notebook')),'response body');
   assert.equal(await page.evaluate(()=>window.compromised),undefined);assert.equal(await page.locator('#detail-view img').count(),0);
   await page.evaluate(()=>document.querySelector('#toast').hidden=true);
   await page.screenshot({path:path.join(__dirname,'../artifacts/interface.png')});
   await page.locator('#search').fill('/api/products');await until(async()=>await page.locator('.traffic-row').count()===1,'filter');await page.locator('#search').fill('');
   await page.locator('[data-filter="errors"]').click();await until(async()=>await page.locator('.traffic-row').count()>=1,'error filter');assert(await page.locator('.traffic-row').filter({hasText:'/api/missing'}).count());assert.equal(await page.locator('.traffic-row .status:not(.error)').count(),0);await page.locator('[data-filter="all"]').click();
   await page.locator('#pause-button').click();const before=await page.evaluate(async()=>(await window.arus.state()).rows.length);
   await browser.evaluate(()=>fetch('/paused'));await wait(750);assert.equal(await page.evaluate(async()=>(await window.arus.state()).rows.length),before);
   await page.locator('#pause-button').click();await browser.evaluate(()=>fetch('/resumed'));await until(()=>page.evaluate(async()=>(await window.arus.state()).rows.some(r=>r.url.endsWith('/resumed'))),'resume');
   const id=await page.evaluate(async url=>window.arus.replay({url,method:'GET',headers:'{}',body:''}),`http://127.0.0.1:${port}/replayed`);
   const replay=await page.evaluate(id=>window.arus.detail(id),id);assert.equal(replay.status,200);assert(replay.responseBody.includes('/replayed'));
   await page.locator('#guide-button').click();assert.equal(await page.locator('#guide-dialog').isVisible(),true);await page.keyboard.press('Escape');
   await page.evaluate(url=>window.arus.open(url),`https://localhost:${tlsPort}/secure-browser`);
   await until(()=>page.evaluate(async()=>(await window.arus.state()).rows.some(r=>r.url.includes('/secure-browser') && r.status===200)),'HTTPS built-in browser');
   assert((await browser.title())!==undefined);
   await page.locator('#clear-button').click();await until(()=>page.evaluate(async()=>(await window.arus.state()).rows.length===0),'clear');assert.equal(await page.locator('#detail-empty').isVisible(),true);
   assert.deepEqual(errors,[]);console.log('PASS: desktop launch, Whistle IPC, HTTP/HTTPS capture, request bodies, filters, pause/resume, replay, XSS isolation, dialogs and clear');
 }finally{if(app)await app.close();await new Promise(r=>server.close(r));await new Promise(r=>secure.close(r));fs.rmSync(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
