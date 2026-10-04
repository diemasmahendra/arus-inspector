const {_electron:electron}=require('playwright');
const http=require('node:http'),https=require('node:https'),forge=require('node-forge'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const start=Date.now();while(Date.now()-start<20000){if(await fn())return;await wait(100);}throw new Error(`Timed out: ${label}`);}
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arus-desktop-'));
 const keys=forge.pki.rsa.generateKeyPair(2048),cert=forge.pki.createCertificate();cert.publicKey=keys.publicKey;cert.serialNumber='02';cert.validity.notBefore=new Date(Date.now()-60000);cert.validity.notAfter=new Date(Date.now()+86400000);const attrs=[{name:'commonName',value:'localhost'}];cert.setSubject(attrs);cert.setIssuer(attrs);cert.setExtensions([{name:'basicConstraints',cA:true},{name:'keyUsage',digitalSignature:true,keyCertSign:true,keyEncipherment:true},{name:'subjectAltName',altNames:[{type:2,value:'localhost'},{type:7,ip:'127.0.0.1'}]}]);cert.sign(keys.privateKey,forge.md.sha256.create());const pem=forge.pki.certificateToPem(cert),caPath=path.join(directory,'upstream.crt');fs.writeFileSync(caPath,pem);
 const secure=https.createServer({key:forge.pki.privateKeyToPem(keys.privateKey),cert:pem},(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>HTTPS captured</h1>');});const tlsPort=await new Promise(r=>secure.listen(0,'127.0.0.1',()=>r(secure.address().port)));
 let aiCalls=0;const aiPayloads=[];
 const server=http.createServer((req,res)=>{
   if(req.url==='/v1/chat/completions'){
     let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
       const data=JSON.parse(body);aiPayloads.push(data);assert.equal(req.headers.authorization,'Bearer local-test-key');res.setHeader('Content-Type','application/json');
       if(data.messages.some(m=>m.role==='user' && m.content==='TEST_CANCEL')){const timer=setTimeout(()=>{if(!res.destroyed)res.end(JSON.stringify({choices:[{message:{content:'late'}}]}));},5000);res.on('close',()=>clearTimeout(timer));return;}
       const last=data.messages.at(-1);let message;
       const call=(id,name,args={})=>({content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
       if(last.role==='user' && last.content==='TEST_BROWSER')message=call('web-tabs','browser_tabs');
       else if(last.tool_call_id==='web-tabs')message=call('web-read','browser_read');
       else if(last.tool_call_id==='web-read'){
         const result=JSON.parse(last.content);assert(!JSON.stringify(result).includes('browser-password-secret'));assert(!JSON.stringify(result).includes('browser-input-secret'));assert(result.text.includes('Browser agent fixture'));
         const find=label=>result.elements.find(e=>e.label===label).ref;
         message={content:null,tool_calls:[{id:'web-fill',type:'function',function:{name:'browser_fill',arguments:JSON.stringify({ref:find('Display name'),text:'Arus Agent'})}},{id:'web-select',type:'function',function:{name:'browser_select',arguments:JSON.stringify({ref:find('Plan'),value:'pro'})}},{id:'web-toggle',type:'function',function:{name:'browser_click',arguments:JSON.stringify({ref:find('Show details')})}}]};
       }
       else if(last.tool_call_id==='web-toggle')message=call('web-after','browser_read');
       else if(last.tool_call_id==='web-after'){const result=JSON.parse(last.content);assert(result.text.includes('Details opened'));message=call('web-submit','browser_click',{ref:result.elements.find(e=>e.label==='Save changes').ref});}
       else if(last.tool_call_id==='web-submit')message=call('web-wait','browser_wait',{ms:400});
       else if(last.tool_call_id==='web-wait')message=call('web-result','browser_read');
       else if(last.tool_call_id==='web-result'){assert(JSON.parse(last.content).url?.includes('/agent-submit'),last.content);message={content:'Browser selesai: form disimpan dan traffic diverifikasi.'};}
       else if(last.role==='user' && last.content==='TEST_BROWSER_CANCEL')message=call('web-cancel-read','browser_read');
       else if(last.tool_call_id==='web-cancel-read')message=call('web-cancel-click','browser_click',{ref:JSON.parse(last.content).elements.find(e=>e.label==='Show details').ref});
       else if(last.tool_call_id==='web-cancel-click'){assert(JSON.parse(last.content).cancelled);message={content:'Klik browser dibatalkan.'};}
       else if(last.role==='user' && last.content==='TEST_BROWSER_SECRET')message=call('web-secret-read','browser_read');
       else if(last.tool_call_id==='web-secret-read')message=call('web-secret-fill','browser_fill',{ref:JSON.parse(last.content).elements.find(e=>e.sensitive).ref,text:'should-not-enter'});
       else if(last.tool_call_id==='web-secret-fill'){assert(JSON.parse(last.content).error.includes('manual'));message={content:'Kolom sensitif harus diisi manual.'};}
       else if(last.role==='user' && last.content==='TEST_BROWSER_FRAME')message=call('web-frame-root','browser_read');
       else if(last.tool_call_id==='web-frame-root'){const r=JSON.parse(last.content);message=call('web-frame-read','browser_read',{frameId:r.frames.find(f=>f.url.includes('/agent-frame')).id});}
       else if(last.tool_call_id==='web-frame-read'){const r=JSON.parse(last.content);assert(r.text.includes('Frame fixture'));message=call('web-frame-fill','browser_fill',{ref:r.elements.find(e=>e.label==='Frame name').ref,text:'Frame Agent'});}
       else if(last.tool_call_id==='web-frame-fill')message={content:'Frame berhasil diisi.'};
       else if(last.role==='user' && last.content==='TEST_BROWSER_MORE')message=call('more-tabs','browser_tabs');
       else if(last.tool_call_id==='more-tabs')message=call('more-new','browser_tab',{action:'new'});
       else if(last.tool_call_id==='more-new'){const tabs=JSON.parse(last.content).tabs;message=call('more-select','browser_tab',{action:'select',tabId:tabs.find(t=>t.url.endsWith('/agent-page')).id});}
       else if(last.tool_call_id==='more-select')message=call('more-read','browser_read');
       else if(last.tool_call_id==='more-read'){const ref=JSON.parse(last.content).elements.find(e=>e.label==='Shadow name').ref;message={content:null,tool_calls:[{id:'more-shadow',type:'function',function:{name:'browser_fill',arguments:JSON.stringify({ref,text:'Shadow Agent'})}},{id:'more-key',type:'function',function:{name:'browser_press',arguments:JSON.stringify({ref,key:'Tab'})}},{id:'more-scroll',type:'function',function:{name:'browser_scroll',arguments:'{"direction":"down","amount":600}'}},{id:'more-close',type:'function',function:{name:'browser_tab',arguments:JSON.stringify({action:'close',tabId:JSON.parse(data.messages.find(m=>m.tool_call_id==='more-new').content).created})}}]};}
       else if(last.tool_call_id==='more-close')message={content:'Tab, shadow DOM, keyboard, dan scroll selesai.'};
       else if(last.role==='user' && last.content==='TEST_FORM'){
         const ctx=JSON.parse(data.messages[0].content.split('CURRENT CONTEXT (DATA):\n')[1]);message={content:null,tool_calls:[{id:'form-test',type:'function',function:{name:'inspect_request',arguments:JSON.stringify({id:ctx.selected.id})}}]};
       }
       else if(last.tool_call_id==='form-test'){const form=JSON.parse(JSON.parse(last.content).requestBody);assert.equal(form.format,'form-urlencoded');assert.equal(form.fields.find(f=>f.name==='Action').value,'UploadLog');message={content:'Form berhasil diparse.'};}
       else if(last.role==='user' && ['TEST_PREPARE','TEST_REPLAY'].includes(last.content)){
         const ctx=JSON.parse(data.messages[0].content.split('CURRENT CONTEXT (DATA):\n')[1]);
         message={content:null,tool_calls:[{id:'request-test',type:'function',function:{name:last.content==='TEST_PREPARE'?'prepare_replay':'replay_request',arguments:JSON.stringify({id:ctx.selected.id,method:'POST',headers:'{"X-Edited":"yes"}',body:'{"hello":"world"}'})}}]};
       }
       else if(last.tool_call_id==='request-test')message={content:JSON.parse(last.content).cancelled?'Permintaan dibatalkan.':JSON.parse(last.content).prepared?'Request sudah disiapkan, belum dikirim.':'Request dikirim.'};
       else if(last.role==='user')message={content:null,tool_calls:[{id:'list1',type:'function',function:{name:'list_traffic',arguments:'{"errors":true}'}}]};
       else if(last.tool_call_id==='list1'){const id=JSON.parse(last.content).rows.find(r=>r.url.includes('/api/missing')).id;message={content:null,tool_calls:[{id:'filter1',type:'function',function:{name:'filter_traffic',arguments:'{"filter":"errors"}'}},{id:'select1',type:'function',function:{name:'select_request',arguments:JSON.stringify({id,tab:'response'})}}]};}
       else message={content:'Ada request 404. Filter error sudah aktif. <img src=x onerror="window.compromised=true">'};
       aiCalls++;res.end(JSON.stringify({choices:[{message}]}));
     });return;
   }
   if(req.url==='/agent-page'){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><title>Browser agent fixture</title><h1>Browser agent fixture</h1><form action="/agent-submit"><label>Display name<input name="display" value="browser-input-secret"></label><label>Plan<select name="plan"><option value="free">Free</option><option value="pro">Pro</option></select></label><label>Password<input id="agent-password" type="password" value="browser-password-secret"></label><button type="button" onclick="document.querySelector('#details').hidden=false">Show details</button><p id="details" hidden>Details opened</p><button>Save changes</button></form><iframe src="http://localhost:${server.address().port}/agent-frame"></iframe><div id="shadow"></div><script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<label>Shadow name<input></label>';</script>`);return;}
   if(req.url==='/agent-frame'){res.setHeader('Content-Type','text/html');res.end('<h1>Frame fixture</h1><label>Frame name<input></label>');return;}
   if(req.url.startsWith('/agent-submit')){res.setHeader('Content-Type','text/html');res.end('<h1>Saved changes</h1>');return;}
   if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><title>Arus test store</title><h1>Arus local test</h1><script>Promise.all(['/api/products','/api/profile','/api/orders','/api/categories','/api/notifications','/api/config','/api/missing'].map(url=>fetch(url,url==='/api/products'?{headers:{Authorization:'Bearer original-only-secret'}}:{}))).then(()=>fetch('/api/cart',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:42,quantity:2})}));</script>`);return;}
   res.setHeader('Content-Type','application/json');res.setHeader('X-Arus-Test','true');
   if(req.url==='/api/missing')res.statusCode=404;
   res.end(JSON.stringify({ok:res.statusCode===200,path:req.url,products:[{id:42,name:'Everyday notebook',price:49000},{id:43,name:'Desk lamp',price:189000}],...(req.url==='/api/profile'?{message:'<img src=x onerror="window.compromised=true">'}:{}),token:'never-send-this-token'}));
 });
 const port=await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
 let app;
 try{
   app=await electron.launch({...(process.env.ARUS_E2E_EXECUTABLE?{executablePath:path.resolve(process.env.ARUS_E2E_EXECUTABLE)}:{}),args:[...(process.env.ARUS_E2E_EXECUTABLE?[]:[path.join(__dirname,'..')]),`--user-data-dir=${directory}`,...(process.platform==='linux'?['--no-sandbox','--disable-dev-shm-usage']:[])],env:{...process.env,NODE_EXTRA_CA_CERTS:caPath},timeout:30000});
   const page=await app.firstWindow();await page.waitForSelector('#open-button');
   async function workspace(name){const tab=page.locator(`[data-workspace-view="${name}"]`);if(await tab.isVisible())await tab.click();}
   async function selectRow(row){await workspace('traffic');await row.click();}
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await until(()=>page.evaluate(async()=>(await window.arus.state()).engine==='ready'),'proxy ready');
   fs.mkdirSync(path.join(__dirname,'../artifacts'),{recursive:true});
   await page.screenshot({path:path.join(__dirname,'../artifacts/empty.png')});
   await page.locator('#target-url').fill(`http://127.0.0.1:${port}/`);await page.locator('#open-button').click();
   await until(()=>page.evaluate(async()=>(await window.arus.state()).rows.some(r=>r.url.endsWith('/api/cart') && r.status===200)),'capture requests');
   const browser=(await app.windows()).find(w=>w.url().startsWith('http://'));assert(browser,'capture browser exists');
   const chrome=(await app.windows()).find(w=>w.url().endsWith('/browser.html'));assert(chrome,'browser tab bar exists');
   await chrome.waitForSelector('.tab');assert.equal(await chrome.locator('.tab').count(),1);
   assert.equal(await browser.evaluate(()=>typeof window.arusBrowser),'undefined');
   assert.equal(await browser.evaluate(()=>typeof window.arus),'undefined');assert.equal(await browser.evaluate(()=>typeof require),'undefined');
   const parentUrl=browser.url();
   await browser.evaluate(()=>{document.cookie='popup_session=shared; path=/';window.popupMessages=[];window.addEventListener('message',e=>window.popupMessages.push(e.data));});

   assert.equal(await browser.evaluate(()=>{window.testPopup=window.open('about:blank','arus-popup','width=600,height=500,nodeIntegration=yes,contextIsolation=no,sandbox=no');return !!window.testPopup;}),true);
   let popup;await until(async()=>{popup=(await app.windows()).find(w=>w.url()==='about:blank');return !!popup;},'popup tab created');popup.on('dialog',dialog=>dialog.dismiss().catch(()=>{}));
   assert.equal(browser.url(),parentUrl);assert.equal(await popup.evaluate(()=>typeof require),'undefined');assert.equal(await popup.evaluate(()=>typeof window.arus),'undefined');
   await popup.evaluate(()=>window.opener.postMessage('popup-ready','*'));
   await until(()=>browser.evaluate(()=>window.popupMessages.includes('popup-ready')),'popup opener communication');
   await browser.evaluate(()=>window.testPopup.location='/popup-captured');await popup.waitForURL('**/popup-captured');
   assert((await popup.evaluate(()=>document.cookie)).includes('popup_session=shared'));
   await until(()=>page.evaluate(async()=>(await window.arus.state()).rows.some(r=>r.url.endsWith('/popup-captured') && r.status===200)),'popup traffic capture');

   await popup.evaluate(()=>{const form=document.createElement('form');form.method='POST';form.action='/popup-form';form.target='_blank';form.innerHTML='<input name="popup" value="works">';document.body.append(form);form.submit();});
   let nested;await until(async()=>{nested=(await app.windows()).find(w=>w.url().endsWith('/popup-form'));return !!nested;},'form popup tab created');
   await until(()=>page.evaluate(async()=>(await window.arus.state()).rows.some(r=>r.url.endsWith('/popup-form') && r.method==='POST' && r.status===200)),'popup form POST capture');
   assert.equal(await nested.evaluate(()=>typeof require),'undefined');
   assert.equal(await popup.evaluate(()=>window.open('file:///etc/passwd')===null),true);
   await popup.evaluate(()=>{window.onbeforeunload=()=>false;});
   await app.evaluate(({BrowserWindow},url)=>{BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===url).close();},popup.url());await until(()=>Promise.resolve(popup.isClosed()),'popup closes despite beforeunload');await until(()=>Promise.resolve(nested.isClosed()),'nested popup closes with opener');
   assert.equal(browser.url(),parentUrl);
   const originalTab=(await chrome.evaluate(()=>window.arusBrowser.state())).active;
   await chrome.locator('#new-tab').click();await until(async()=>await chrome.locator('.tab').count()===2,'new tab button');
   await chrome.locator('#address').fill(`http://127.0.0.1:${port}/tab-second`);await chrome.locator('#address').press('Enter');
   await until(()=>page.evaluate(async()=>(await window.arus.state()).rows.some(r=>r.url.endsWith('/tab-second')&&r.status===200)),'second tab capture');
   await chrome.locator('#address').fill(`http://127.0.0.1:${port}/tab-third`);await chrome.locator('#address').press('Enter');
   await until(()=>chrome.evaluate(async()=>(await window.arusBrowser.state()).canBack),'tab history');await chrome.locator('#back').click();
   await until(()=>chrome.evaluate(async()=>{const s=await window.arusBrowser.state();return s.tabs.find(t=>t.id===s.active).url.endsWith('/tab-second');}),'back navigation');
   await chrome.locator('#forward').click();await until(async()=>(await chrome.locator('#address').inputValue()).endsWith('/tab-third'),'forward navigation');
   await chrome.evaluate(id=>window.arusBrowser.action('select',{id}),originalTab);
   assert.equal(browser.url(),parentUrl);await chrome.screenshot({path:path.join(__dirname,'../artifacts/browser-tabs.png')});
   await chrome.locator('.tab:not(.selected) .tab-close').click();await until(async()=>await chrome.locator('.tab').count()===1,'close inactive tab');
   await chrome.keyboard.press('Control+t');await until(async()=>await chrome.locator('.tab').count()===2,'Ctrl+T creates tab');await chrome.keyboard.press('Control+w');await until(async()=>await chrome.locator('.tab').count()===1,'Ctrl+W closes tab');
   await chrome.keyboard.press('Control+l');await until(()=>chrome.locator('#address').evaluate(el=>document.activeElement===el),'Ctrl+L focuses address');
   await page.bringToFront();
   await until(async()=>await page.locator('.traffic-row').count()>=8,'table rows');
   await selectRow(page.locator('.traffic-row').filter({hasText:'/api/profile'}).first());
   await until(async()=>await page.locator('#detail-view').textContent().then(t=>t.includes('window.compromised')),'untrusted response displayed safely');
   assert.equal(await page.locator('#detail-view img').count(),0);
   const request=page.locator('.traffic-row').filter({hasText:'/api/products'}).first();await selectRow(request);
   await until(async()=>await page.locator('#detail-view').textContent().then(t=>t.includes('Everyday notebook')),'response body');
   assert.equal(await page.evaluate(()=>window.compromised),undefined);assert.equal(await page.locator('#detail-view img').count(),0);
   await page.evaluate(()=>document.querySelector('#toast').hidden=true);
   await page.screenshot({path:path.join(__dirname,'../artifacts/interface.png')});
   await page.evaluate(async()=>{await document.fonts.load('14px "Geist Sans"');await document.fonts.load('13px "Geist Mono"');});
   assert(await page.evaluate(()=>document.fonts.check('14px "Geist Sans"')));
   await page.locator('#appearance-button').click();await page.locator('[data-size="large"]').click();
   assert.equal(await page.evaluate(()=>getComputedStyle(document.body).fontSize),'16px');await page.keyboard.press('Escape');
   await page.screenshot({path:path.join(__dirname,'../artifacts/interface-large.png')});
   await page.locator('#appearance-button').click();await page.locator('[data-size="comfortable"]').click();await page.keyboard.press('Escape');
   if(!await page.locator('#agent-panel').isVisible())await page.locator('#agent-toggle').click();await page.locator('#agent-settings-open').click();
   await page.locator('#agent-base-url').fill(`http://127.0.0.1:${port}/v1`);await page.locator('#agent-model').fill('local-test-model');await page.locator('#agent-key').fill('local-test-key');
   await page.locator('[data-settings-pane="profiles"]').click();await page.locator('#agent-file').selectOption('MEMORY.md');await page.locator('#agent-file-editor').fill('# Memori\nGunakan bahasa Indonesia.');await page.locator('#agent-file').selectOption('SOUL.md');await page.locator('#agent-file').selectOption('MEMORY.md');
   assert((await page.locator('#agent-file-editor').inputValue()).includes('bahasa Indonesia'));
   await page.screenshot({path:path.join(__dirname,'../artifacts/agent-settings.png')});
   await page.locator('#agent-settings-save').click();await until(async()=>!await page.locator('#agent-settings').isVisible(),'save settings');
   assert((await page.evaluate(async()=>window.arus.agentState())).files['MEMORY.md'].includes('bahasa Indonesia'));
   const importPath=path.join(directory,'identity.md'),exportDirectory=path.join(directory,'exported-profiles');fs.writeFileSync(importPath,'# Identitas\nNama: Agent Diemas');fs.mkdirSync(exportDirectory);
   await app.evaluate(({dialog},file)=>{globalThis.__arusOriginalOpenDialog=dialog.showOpenDialog;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},importPath);
   try{assert.equal((await page.evaluate(async()=>window.arus.agentImport()))['IDENTITY.md'],'# Identitas\nNama: Agent Diemas');}
   finally{await app.evaluate(({dialog})=>{dialog.showOpenDialog=globalThis.__arusOriginalOpenDialog;});}
   await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},exportDirectory);
   try{assert.equal(await page.evaluate(async()=>window.arus.agentExportFiles()),true);for(const name of ['IDENTITY.md','SOUL.md','AGENTS.md','TOOLS.md','MEMORY.md'])assert(fs.statSync(path.join(exportDirectory,name)).size>0);assert(fs.readFileSync(path.join(exportDirectory,'MEMORY.md'),'utf8').includes('bahasa Indonesia'));}
   finally{await app.evaluate(({dialog})=>{dialog.showOpenDialog=globalThis.__arusOriginalOpenDialog;});}
   const settingsFile=fs.readFileSync(path.join(directory,'agent-settings.json'),'utf8');assert(!settingsFile.includes('local-test-key'));
   await page.locator('#agent-input').fill('Cari request error dan pilih requestnya.');await page.locator('#agent-send').click();
   await until(async()=>await page.locator('.agent-message.assistant').count()===1,'agent tool calling');
   assert.equal(aiCalls,3);assert(!JSON.stringify(aiPayloads).includes('never-send-this-token'));assert(!JSON.stringify(aiPayloads).includes('original-only-secret'));assert(JSON.stringify(aiPayloads).includes('Gunakan bahasa Indonesia.'));
   assert.equal(await page.locator('.traffic-row .status:not(.error)').count(),0);assert((await page.locator('#detail-url').textContent()).includes('/api/missing'));assert.equal(await page.locator('#agent-panel img').count(),0);assert.equal(await page.evaluate(()=>window.compromised),undefined);
   await page.evaluate(()=>{document.querySelector('.agent-message.assistant>div').textContent='Ada request 404 pada /api/missing. Filter error sudah aktif dan requestnya sudah dipilih. Periksa path endpoint atau route server untuk memastikan URL tersedia.';});
   await page.screenshot({path:path.join(__dirname,'../artifacts/agent.png')});
   await page.locator('#agent-close').click();await page.locator('[data-filter="all"]').click();await selectRow(request);await page.locator('#agent-toggle').click();
   await page.locator('#agent-new').click();await page.locator('#agent-input').fill('TEST_PREPARE');await page.locator('#agent-send').click();
   await until(async()=>await page.locator('#replay-dialog').isVisible(),'agent composer');assert((await page.locator('#replay-headers').inputValue()).includes('original-only-secret'));assert((await page.locator('#replay-headers').inputValue()).includes('X-Edited'));assert.equal(await page.locator('#replay-method').inputValue(),'POST');assert.equal(await page.locator('#replay-body').inputValue(),'{"hello":"world"}');await page.keyboard.press('Escape');
   await until(()=>page.evaluate(async()=>!(await window.arus.agentState()).busy),'prepare finished');
   const beforeReplay=await page.evaluate(async()=>(await window.arus.state()).rows.length);
   await app.evaluate(({dialog})=>{globalThis.__arusOriginalDialog=dialog.showMessageBox;globalThis.__arusConfirmCount=0;dialog.showMessageBox=async()=>{globalThis.__arusConfirmCount++;return {response:0};};});
   try{
     await page.locator('#agent-new').click();await page.locator('#agent-input').fill('TEST_REPLAY');await page.locator('#agent-send').click();await until(async()=>(await page.locator('#agent-messages').textContent()).includes('Permintaan dibatalkan.'),'replay cancellation');
     assert.equal(await app.evaluate(()=>globalThis.__arusConfirmCount),1);assert.equal(await page.evaluate(async()=>(await window.arus.state()).rows.length),beforeReplay);
   }finally{await app.evaluate(({dialog})=>{dialog.showMessageBox=globalThis.__arusOriginalDialog;});}
   await app.evaluate(({dialog})=>{globalThis.__arusConfirmCount=0;dialog.showMessageBox=async()=>{globalThis.__arusConfirmCount++;return {response:1};};});
   try{
     await page.locator('#agent-new').click();await page.locator('#agent-input').fill('TEST_REPLAY');await page.locator('#agent-send').click();await until(async()=>(await page.locator('#agent-messages').textContent()).includes('Request dikirim.'),'approved replay');
     assert.equal(await app.evaluate(()=>globalThis.__arusConfirmCount),1);
     const state=await page.evaluate(async()=>window.arus.state()),posted=state.rows.find(r=>r.type==='Replay' && r.method==='POST');assert.equal(posted.status,200,JSON.stringify(posted));const original=await page.evaluate(id=>window.arus.detail(id),posted.id);assert.equal(original.requestBody,'{"hello":"world"}');assert(Object.values(original.requestHeaders).some(v=>v==='Bearer original-only-secret'));assert(!JSON.stringify(aiPayloads).includes('original-only-secret'));
   }finally{await app.evaluate(({dialog})=>{dialog.showMessageBox=globalThis.__arusOriginalDialog;});}
   await page.locator('#agent-new').click();await page.locator('#agent-input').fill('TEST_CANCEL');await page.locator('#agent-send').click();
   await until(()=>page.evaluate(async()=>(await window.arus.agentState()).busy),'agent busy');await page.locator('#agent-close').click();assert.equal(await page.locator('#agent-rail').isVisible(),true);assert.equal((await page.evaluate(async()=>window.arus.agentState())).busy,true);await page.locator('#agent-expand').click();await page.locator('#agent-stop').click();await until(()=>page.evaluate(async()=>!(await window.arus.agentState()).busy),'stop agent');
   await until(async()=>(await page.locator('#agent-messages').textContent()).includes('dihentikan'),'cancel feedback');
   await page.locator('#agent-close').click();await page.locator('[data-filter="all"]').click();
   await page.locator('#search').fill('/api/products');await until(async()=>await page.locator('.traffic-row').count()===2,'filter');await page.locator('#search').fill('');
   await page.locator('[data-filter="errors"]').click();await until(async()=>await page.locator('.traffic-row').count()>=1,'error filter');assert(await page.locator('.traffic-row').filter({hasText:'/api/missing'}).count());assert.equal(await page.locator('.traffic-row .status:not(.error)').count(),0);await page.locator('[data-filter="all"]').click();
   await page.locator('#pause-button').click();const before=await page.evaluate(async()=>(await window.arus.state()).rows.length);
   await browser.evaluate(()=>fetch('/paused'));await wait(750);assert.equal(await page.evaluate(async()=>(await window.arus.state()).rows.length),before);
   await page.locator('#pause-button').click();await browser.evaluate(()=>fetch('/resumed'));await until(()=>page.evaluate(async()=>(await window.arus.state()).rows.some(r=>r.url.endsWith('/resumed'))),'resume');
   const id=await page.evaluate(async url=>window.arus.replay({url,method:'GET',headers:'{}',body:''}),`http://127.0.0.1:${port}/replayed`);
   const replay=await page.evaluate(id=>window.arus.detail(id),id);assert.equal(replay.status,200);assert(replay.responseBody.includes('/replayed'));
   await page.locator('#guide-button').click();assert.equal(await page.locator('#guide-dialog').isVisible(),true);await page.keyboard.press('Escape');
   await page.evaluate(()=>{window.__formId=null;});
   await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
   const formId=await page.evaluate(async()=>{const url=new URL(document.querySelector('#target-url').value);const body=new URLSearchParams([['Action','UploadLog'],['note','hello + world'],['tag','one'],['tag','two'],['Signature','signature-secret'],['log',JSON.stringify({event:'clicked',token:'nested-form-secret'})],['payload','<img src=x onerror="window.compromised=true">']]).toString();return window.arus.replay({url:url.origin+'/form',method:'POST',headers:JSON.stringify({'Content-Type':'application/x-www-form-urlencoded'}),body});});
   await app.evaluate(({dialog})=>{dialog.showMessageBox=globalThis.__arusOriginalDialog;});
   await selectRow(page.locator(`.traffic-row[data-id="${formId}"]`));await page.locator('[data-tab="request"]').click();await until(async()=>await page.locator('.form-table').count()===1,'form view');assert((await page.locator('.form-table').textContent()).includes('hello + world'));assert.equal(await page.locator('.form-table img').count(),0);
   await page.locator('[data-body-mode="raw"]').click();assert((await page.locator('.raw-body').textContent()).includes('Signature=signature-secret'));await page.locator('[data-body-mode="form"]').click();
   await page.screenshot({path:path.join(__dirname,'../artifacts/form.png')});
   await page.locator('#agent-expand').click();await page.locator('#agent-new').click();await page.locator('#agent-input').fill('TEST_FORM');await page.locator('#agent-send').click();await until(async()=>(await page.locator('#agent-messages').textContent()).includes('Form berhasil diparse.'),'AI reads form');assert(!JSON.stringify(aiPayloads).includes('signature-secret'));assert(!JSON.stringify(aiPayloads).includes('nested-form-secret'));await page.locator('#agent-close').click();
   await page.evaluate(url=>window.arus.open(url),`http://127.0.0.1:${port}/agent-page`);
   await until(()=>page.evaluate(async()=>(await window.arus.state()).rows.some(r=>r.url.endsWith('/agent-page')&&r.status===200)),'agent browser fixture');
   let agentPage;await until(async()=>{agentPage=(await app.windows()).find(w=>w.url().endsWith('/agent-page'));return !!agentPage;},'agent page attaches');
   await page.locator('#agent-expand').click();
   async function browserChat(text,answer){await page.locator('#agent-new').click();await page.locator('#agent-input').fill(text);await page.locator('#agent-send').click();try{await until(async()=>(await page.locator('#agent-messages').textContent()).includes(answer),text);}catch(e){throw Error(e.message+' '+await page.locator('#agent-messages').textContent());}await until(()=>page.evaluate(async()=>!(await window.arus.agentState()).busy),'browser agent idle');}
   await app.evaluate(({dialog})=>{globalThis.__browserConfirms=0;dialog.showMessageBox=async()=>{globalThis.__browserConfirms++;return {response:0};};});
   await browserChat('TEST_BROWSER_CANCEL','Klik browser dibatalkan.');assert.equal(await agentPage.locator('#details').isVisible(),false);assert.equal(await app.evaluate(()=>globalThis.__browserConfirms),1);
   await browserChat('TEST_BROWSER_SECRET','Kolom sensitif harus diisi manual.');assert.equal(await agentPage.locator('#agent-password').inputValue(),'browser-password-secret');
   await browserChat('TEST_BROWSER_FRAME','Frame berhasil diisi.');assert.equal(await agentPage.frameLocator('iframe').locator('input').inputValue(),'Frame Agent');
   await app.evaluate(({dialog})=>{globalThis.__browserConfirms=0;dialog.showMessageBox=async()=>{globalThis.__browserConfirms++;return {response:1};};});
   await browserChat('TEST_BROWSER','Browser selesai: form disimpan');assert.equal(await app.evaluate(()=>globalThis.__browserConfirms),2);
   await until(()=>page.evaluate(async()=>(await window.arus.state()).rows.some(r=>r.url.includes('/agent-submit?display=Arus+Agent&plan=pro')&&r.status===200)),'AI form traffic capture');
   assert(!JSON.stringify(aiPayloads).includes('browser-password-secret'));assert(!JSON.stringify(aiPayloads).includes('browser-input-secret'));
   await app.evaluate(({dialog})=>{dialog.showMessageBox=globalThis.__arusOriginalDialog;});await page.locator('#agent-close').click();
   await page.evaluate(url=>window.arus.open(url),`http://127.0.0.1:${port}/agent-page`);await until(async()=>(await app.windows()).filter(w=>w.url().endsWith('/agent-page')).length===1,'fresh agent page');
   const freshAgent=(await app.windows()).find(w=>w.url().endsWith('/agent-page'));await page.locator('#agent-expand').click();await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
   await browserChat('TEST_BROWSER_MORE','Tab, shadow DOM, keyboard, dan scroll selesai.');assert.equal(await freshAgent.locator('#shadow input').inputValue(),'Shadow Agent');await app.evaluate(({dialog})=>{dialog.showMessageBox=globalThis.__arusOriginalDialog;});await page.locator('#agent-close').click();
   for(const width of [1280,1000]){
     await app.evaluate(({BrowserWindow},width)=>{BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).setSize(width,850);},width);
     await page.locator('#agent-expand').click();
     await until(()=>page.evaluate(()=>{const main=document.querySelector('main'),agent=document.querySelector('#agent-dock');return main.getBoundingClientRect().right<=agent.getBoundingClientRect().left+1;}),'docked without overlap');
     if(width===1000){await page.locator('[data-workspace-view="detail"]').click();assert.equal(await page.locator('.detail-panel').isVisible(),true);}
     await page.screenshot({path:path.join(__dirname,`../artifacts/interface-${width}.png`)});
     await page.locator('#agent-close').click();
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   }
   await page.locator('#agent-expand').click();await page.locator('#agent-resize').focus();await page.keyboard.press('ArrowLeft');await page.locator('#agent-close').click();
   const saved=await page.evaluate(()=>localStorage.getItem('arus-agent-layout'));assert.equal(JSON.parse(saved).width,420);assert.equal(JSON.parse(saved).expanded,false);await page.reload();await page.waitForSelector('#agent-expand');assert.equal(await page.locator('#agent-rail').isVisible(),true);assert.equal(await page.evaluate(()=>localStorage.getItem('arus-agent-layout')),saved);
   await page.evaluate(url=>window.arus.open(url),`https://localhost:${tlsPort}/secure-browser`);
   await until(()=>page.evaluate(async()=>(await window.arus.state()).rows.some(r=>r.url.includes('/secure-browser') && r.status===200)),'HTTPS built-in browser');
   assert((await browser.title())!==undefined);
   await page.locator('#clear-button').click();await until(()=>page.evaluate(async()=>(await window.arus.state()).rows.length===0),'clear');await workspace('detail');assert.equal(await page.locator('#detail-empty').isVisible(),true);
   browser.on('dialog',dialog=>dialog.dismiss().catch(()=>{}));
   await browser.evaluate(()=>{window.onbeforeunload=()=>false;});
   await page.locator('#close-browser').click();await until(()=>page.evaluate(async()=>!(await window.arus.state()).browserOpen),'browser closes despite beforeunload');
   assert.deepEqual(errors,[]);console.log('PASS: desktop launch, Whistle IPC, HTTP/HTTPS capture, browser tabs/history, popup opener/session/form capture, request bodies, filters, pause/resume, replay, XSS isolation, dialogs, five Markdown profiles, safe agent tools, browser AI form/iframe/shadow/tab/keyboard/scroll controls, provider redaction, stop and clear');
 }catch(error){console.error('Desktop test failure:',error);throw error;}finally{if(app)await app.close();server.closeAllConnections();secure.closeAllConnections();await new Promise(r=>server.close(r));await new Promise(r=>secure.close(r));fs.rmSync(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
