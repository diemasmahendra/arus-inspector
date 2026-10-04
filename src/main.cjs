const {app, BrowserWindow, ipcMain, clipboard, dialog, session, utilityProcess, safeStorage} = require('electron');
const path = require('node:path');
const {X509Certificate,randomUUID} = require('node:crypto');
const fs = require('node:fs/promises');
const {CaptureStore, validUrl, isText, clip, curl, replayHeaders, MAX_BODY} = require('./capture.cjs');
const {Agent, FILES, MAX_FILE, safeRow} = require('./agent.cjs');
const {CamoufoxBrowser}=require('./camoufox.cjs');
const {BrowserTabs}=require('./browser-tabs.cjs');
const {BrowserAgent}=require('./browser-agent.cjs');
const {compareRequests}=require('./compare.cjs');
const {embeddedAdapter,camoufoxAdapter}=require('./browser-drivers.cjs');
let browserAgent;
const AGENT_APPROVED=Symbol('agent-approved');
const actions = {}; const uiPending = new Map(); let agent;
let camoufox,browserKind='embedded',quitting=false;
let inspector, browser, capturing = true, updater, updateState = {status:'idle'};
let pending = [], timer, engine, enginePort, rootCertificate, enginePromise, engineState = 'starting';
function startEngine() {
  enginePromise = new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Mesin capture belum siap.')),30000);
    engine=utilityProcess.fork(path.join(__dirname,'engine.cjs'),[],{stdio:'pipe',serviceName:'Arus Capture'});
    engine.on('message', msg=>{
      if(msg.kind==='ready'){clearTimeout(timeout);enginePort=msg.port;rootCertificate=new X509Certificate(msg.certificate);engineState='ready';resolve();status();}
      else if(msg.kind==='error'){clearTimeout(timeout);engineState='error';reject(new Error(msg.message));status();}
      else if(msg.kind==='rows' && capturing && msg.epoch===store.generation){
        for(const data of msg.rows){const key=data.engineId;let id=store.ids.get(key);if(!id){const row=store.add(data,key);id=row.id;}else store.update(id,data);}
      }
    });
    engine.on('exit',()=>{clearTimeout(timeout);engineState='error';reject(new Error('Mesin capture berhenti.'));status();});
    engine.postMessage({kind:'start',directory:app.getPath('userData')});
    engine.postMessage({kind:'clear',epoch:store.generation});
  });
  enginePromise.catch(()=>{});
}
function send(event) { if (inspector && !inspector.isDestroyed()) inspector.webContents.send('arus-event', event); }
const store = new CaptureStore((kind, data) => {
  if (kind === 'clear') { pending = []; send({kind}); return; }
  pending.push({kind,data}); if (!timer) timer = setTimeout(() => {send({kind:'batch',data:pending}); pending=[];timer=null;}, 80);
});
function status() { send({kind:'status', data:{capturing, browserOpen:!!browser || !!camoufox?.isOpen, browserKind, camoufox:camoufox?.state || 'idle', engine:engineState, port:enginePort, update:updateState}}); }
function secureWindow(options) { return new BrowserWindow({...options, webPreferences:{contextIsolation:true, nodeIntegration:false, sandbox:true, ...options.webPreferences}}); }
function setupUpdates() {
  if (!app.isPackaged) { updateState={status:'development'}; return; }
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = false; updater.autoInstallOnAppQuit = false;
    const set = data => { updateState=data; status(); };
    updater.on('checking-for-update',()=>set({status:'checking'}));
    updater.on('update-available', info=>set({status:'available',version:info.version}));
    updater.on('update-not-available',()=>set({status:'current'}));
    updater.on('download-progress', p=>set({status:'downloading',percent:Math.round(p.percent)}));
    updater.on('update-downloaded', info=>set({status:'ready',version:info.version}));
    updater.on('error', ()=>set({status:'error',message:'Tidak bisa memeriksa pembaruan. Coba lagi nanti.'}));
    setTimeout(()=>updater.checkForUpdates().catch(()=>{}), 8000);
  } catch { updateState={status:'error',message:'Updater tidak tersedia.'}; }
}
async function makeBrowser(url) {
  await enginePromise;
  const capture=session.fromPartition('arus-capture');
  await capture.setProxy({proxyRules:`http=127.0.0.1:${enginePort};https=127.0.0.1:${enginePort}`,proxyBypassRules:'<-loopback>'});
  capture.setCertificateVerifyProc((request,callback)=>{
    try{const cert=new X509Certificate(request.certificate.data),host=cert.checkHost(request.hostname)||cert.checkIP(request.hostname),now=Date.now();if(host && cert.verify(rootCertificate.publicKey) && now>=Date.parse(cert.validFrom) && now<=Date.parse(cert.validTo))return callback(0);}catch{}callback(-3);
  });
  capture.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));capture.setPermissionCheckHandler(()=>false);
  if(!capture.__arusDownloadsBlocked){capture.on('will-download',event=>event.preventDefault());capture.__arusDownloadsBlocked=true;}
  if(!browser || browser.isDestroyed())browser=new BrowserTabs({onClosed:()=>{browser=null;store.ids.clear();status();}});
  browser.open(url);status();
}
function handle(channel, fn) {
  actions[channel] = fn;
  ipcMain.handle(channel, async (event, ...args)=>{
    if (!inspector || event.sender !== inspector.webContents || event.senderFrame !== inspector.webContents.mainFrame) throw new Error('Akses ditolak.');
    return fn(...args);
  });
}
function setupIpc() {
  handle('agent-ui-result',(id,result)=>{const pending=uiPending.get(id);if(pending)pending.finish(result);return true;});
  handle('agent-state',async()=>{await agent.ready;return agent.state();});
  handle('agent-save',data=>agent.save(data));
  handle('agent-chat',data=>agent.chat(data));
  handle('agent-cancel',()=>agent.cancel());
  handle('agent-pause',kind=>agent.pause(kind));
  handle('agent-resume',()=>{if(agent.controller)throw Error('Agent sedang bekerja.');browserAgent.refs.clear();return agent.resume();});
  handle('agent-reset',()=>agent.reset());
  handle('agent-import',async()=>{
    const {canceled,filePaths}=await dialog.showOpenDialog(inspector,{title:'Import arahan agent',properties:['openFile','multiSelections'],filters:[{name:'Markdown',extensions:['md']}]});
    if(canceled)return null;const files={};
    for(const file of filePaths){const name=FILES.find(n=>n.toLowerCase()===path.basename(file).toLowerCase());if(!name)throw new Error('Pilih IDENTITY.md, SOUL.md, AGENTS.md, TOOLS.md, atau MEMORY.md.');const stat=await fs.stat(file);if(stat.size>MAX_FILE)throw new Error(`${name} maksimal 24 kB.`);files[name]=await fs.readFile(file,'utf8');}return files;
  });
  handle('agent-export-files',async()=>{
    await agent.ready;const {canceled,filePaths}=await dialog.showOpenDialog(inspector,{title:'Simpan lima file Markdown',properties:['openDirectory','createDirectory']});if(canceled)return false;
    const directory=filePaths[0];for(const name of FILES){try{await fs.access(path.join(directory,name));const {response}=await dialog.showMessageBox(inspector,{buttons:['Batal','Timpa file'],defaultId:0,cancelId:0,message:'Folder ini sudah memiliki file arahan. Timpa lima file Markdown?'});if(response!==1)return false;break;}catch{}}
    for(const name of FILES)await fs.writeFile(path.join(directory,name),agent.config.files[name]);return true;
  });
  handle('state',()=>({rows:store.list(),capturing,browserOpen:!!browser || !!camoufox?.isOpen,browserKind,camoufox:camoufox?.state || 'idle',engine:engineState,port:enginePort,version:app.getVersion(),update:updateState}));
  handle('open',async (input,kind=browserKind)=>{
    const url=validUrl(input);if(!['embedded','camoufox'].includes(kind))throw Error('Browser tidak dikenal.');await enginePromise;
    if(kind==='camoufox'){browser?.destroy();browserKind=kind;status();await camoufox.open(url,enginePort);}
    else{await camoufox.close();browserKind=kind;await makeBrowser(url);}
    status();return true;
  });
  handle('control', async action=>{
    if(action==='pause') capturing=false;
    else if(action==='resume') capturing=true;
    else if(['focus','reload','close'].includes(action)){
      if(browserKind==='camoufox')await camoufox.control(action);
      else if(action==='focus')browser?.show();else if(action==='reload')browser?.reload();else browser?.destroy();
    }
    else throw new Error('Kontrol tidak dikenal.');
    if(action==='pause' || action==='resume') engine?.postMessage({kind:'capture',active:capturing});
    status();return capturing;
  });
  handle('clear',()=>{store.clear();engine?.postMessage({kind:'clear',epoch:store.generation});return true;});
  handle('certificate',async()=>{await enginePromise;const {canceled,filePath}=await dialog.showSaveDialog(inspector,{defaultPath:'Arus-Root-CA.crt',filters:[{name:'Certificate',extensions:['crt']}]});if(canceled)return false;await fs.writeFile(filePath,rootCertificate.toString());return true;});
  handle('detail',id=>store.get(id));
  handle('compare',(leftId,rightId)=>{if(typeof leftId!=='string'||typeof rightId!=='string'||leftId.length>100||rightId.length>100)throw Error('Request tidak valid.');const a=store.get(leftId),b=store.get(rightId);if(!a||!b)throw Error('Request sudah tidak tersedia. Pilih ulang request A dan B.');return compareRequests(a,b);});
  handle('copy',async (id,kind)=>{
    const row=store.get(id);if(!row) throw new Error('Request sudah tidak tersedia.');
    let value;
    if(kind==='url') value=row.url;
    else if(kind==='curl') value=curl(row);
    else if(kind==='curl-full') {
      const {response}=await dialog.showMessageBox(inspector,{type:'warning',buttons:['Batal','Salin lengkap'],defaultId:0,cancelId:0,message:'Salin cURL dengan data sensitif?',detail:'Header login dan body request ikut disalin. Jangan bagikan ke publik.'});
      if(response!==1) return false; value=curl(row,true);
    } else if(kind==='response') value=row.responseBody || '';
    else throw new Error('Jenis salinan tidak dikenal.');
    clipboard.writeText(value);return true;
  });
  handle('export',async sensitive=>{
    if(typeof sensitive!=='boolean') throw new Error('Pilihan ekspor tidak valid.');
    if(sensitive) {const {response}=await dialog.showMessageBox(inspector,{type:'warning',buttons:['Batal','Export lengkap'],defaultId:0,cancelId:0,message:'Export dengan data sensitif?',detail:'Cookie, token, dan semua body tersimpan di file. Simpan hanya untuk penggunaan pribadi.'});if(response!==1)return false;}
    const {canceled,filePath}=await dialog.showSaveDialog(inspector,{defaultPath:`arus-${Date.now()}.har`,filters:[{name:'HTTP Archive',extensions:['har']}]});
    if(canceled || !filePath) return false; await fs.writeFile(filePath,JSON.stringify(store.har(sensitive),null,2));return true;
  });
  handle('replay',async (data,approval)=>{
    const url=validUrl(data?.url), method=String(data?.method || 'GET').toUpperCase();
    if(!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method)) throw new Error('Metode tidak valid.');
    if(typeof data.headers!=='string' || data.headers.length>64000 || typeof data.body!=='string' || data.body.length>MAX_BODY) throw new Error('Request terlalu besar.');
    const parsed=JSON.parse(data.headers || '{}');
    if(!parsed || Array.isArray(parsed) || typeof parsed!=='object' || Object.entries(parsed).some(([k,v])=>typeof v!=='string' || /[\r\n]/.test(k+v))) throw new Error('Header harus berupa objek JSON dengan nilai teks.');
    const headers=replayHeaders(parsed);
    if (method!=='GET' && method!=='HEAD' && approval!==AGENT_APPROVED) {const {response}=await dialog.showMessageBox(inspector,{type:'question',buttons:['Batal',`Kirim ${method}`],defaultId:0,cancelId:0,message:`Kirim request ${method}?`,detail:`Request ini dapat mengubah data di server.\n${url}`});if(response!==1)return null;}
    const row=store.add({url,method,type:'Replay',requestHeaders:headers,requestBody:['GET','HEAD'].includes(method)?'':data.body});
    const start=performance.now(), generation=store.generation;
    try {
      const response=await session.fromPartition('arus-replay').fetch(url,{method,headers,body:['GET','HEAD'].includes(method)?undefined:data.body,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)});
      const mime=response.headers.get('content-type') || '', chunks=[];let size=0, truncated=false;
      for await (const chunk of response.body || []) {size+=chunk.length;if(size>MAX_BODY){truncated=true;break;}chunks.push(Buffer.from(chunk));}
      if(generation===store.generation) store.update(row.id,{status:response.status,statusText:response.statusText,responseHeaders:Object.fromEntries(response.headers),mime,size,duration:performance.now()-start,responseBody:isText(mime)?Buffer.concat(chunks).toString('utf8'):'',bodyNote:truncated?'Body dipotong pada 1 MiB.':!isText(mime)?'Konten biner.':''});
    } catch(error) {if(generation===store.generation) store.update(row.id,{status:0,error:error.message,duration:performance.now()-start});}
    return row.id;
  });
  handle('update',async action=>{
    if(!updater) throw new Error('Pembaruan tersedia pada versi yang sudah diinstal.');
    if(action==='check') await updater.checkForUpdates();
    else if(action==='download' && updateState.status==='available') await updater.downloadUpdate();
    else if(action==='install' && updateState.status==='ready') {updater.quitAndInstall();}
    else throw new Error('Aksi pembaruan tidak tersedia.');return true;
  });
}
function replayData(args){
  const row=store.get(args.id);if(!row)throw Error('Request sudah tidak tersedia.');
  const headers=replayHeaders(row.requestHeaders);
  let edited=headers;
  if(args.headers!==undefined){const patch=JSON.parse(args.headers);if(!patch || typeof patch!=='object' || Array.isArray(patch) || Object.values(patch).some(v=>typeof v!=='string' || v.includes('[REDACTED]')))throw Error('Header edit harus JSON object tanpa placeholder rahasia.');edited={...headers,...patch};}
  if(args.body?.includes('[REDACTED]'))throw Error('Isi body asli atau perubahan tanpa placeholder rahasia.');
  const method=args.method===undefined?row.method:args.method.toUpperCase();if(!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method))throw Error('Metode tidak valid.');
  return {url:validUrl(args.url===undefined?row.url:args.url),method,headers:JSON.stringify(replayHeaders(edited),null,2),body:args.body===undefined?row.requestBody:args.body};
}
async function confirmAgent(message,detail,signal){
  signal.throwIfAborted();const {response}=await dialog.showMessageBox(inspector,{type:'question',buttons:['Batal','Setujui'],defaultId:0,cancelId:0,message,detail,signal});signal.throwIfAborted();return response===1;
}
function agentUi(name,args,signal){
  signal.throwIfAborted();return new Promise((resolve,reject)=>{
    const id=randomUUID();let timeout;
    const finish=result=>{clearTimeout(timeout);signal.removeEventListener('abort',abort);uiPending.delete(id);result?.ok?resolve({ok:true}):reject(Error('Tindakan UI belum selesai.'));};
    const abort=()=>finish(null);uiPending.set(id,{finish});signal.addEventListener('abort',abort,{once:true});timeout=setTimeout(()=>finish(null),10000);send({kind:'agent-ui',id,name,args});
  });
}
async function executeAgent(name,args,signal){
  signal.throwIfAborted();
  if(name==='compare_requests'){const a=store.get(args.leftId),b=store.get(args.rightId);if(!a||!b)throw Error('Request tidak ditemukan.');return {comparison:compareRequests(safeRow(a,true),safeRow(b,true)),note:'Field sensitif disamarkan; nilai tersembunyi tidak dapat dibandingkan secara penuh.'};}
  if(name.startsWith('browser_'))return browserAgent.run(name,args,signal);
  if(name==='list_traffic'){
    const list=store.list().filter(r=>(!args.domain || new URL(r.url).hostname===args.domain) && (!args.errors || r.error || r.status>=400) && (!args.query || `${r.url} ${r.method} ${r.status}`.toLowerCase().includes(args.query.toLowerCase())));
    return {total:list.length,rows:list.slice(-80).map(r=>safeRow(r))};
  }
  if(name==='inspect_request'){const row=store.get(args.id);if(!row)throw Error('Request tidak ditemukan.');return safeRow(row,true);}
  if(name==='filter_traffic' || name==='select_request' || name==='set_display'){
    if(name==='select_request' && !store.get(args.id))throw Error('Request tidak ditemukan.');return agentUi(name,args,signal);
  }
  if(name==='control_capture'){if(args.action==='reload' && !await confirmAgent('Agent ingin memuat ulang browser.', 'Halaman akan dibuka ulang.',signal))return {cancelled:true};return {capturing:await actions.control(args.action)};}
  if(name==='open_browser'){const url=validUrl(args.url);if(!await confirmAgent('Agent ingin membuka website.',url,signal))return {cancelled:true};await actions.open(url);return {opened:true};}
  if(name==='prepare_replay'){await agentUi(name,replayData(args),signal);return {prepared:true,sent:false};}
  if(name==='replay_request'){
    const data=replayData(args);if(!await confirmAgent(`Agent ingin mengirim ${data.method}.`,`${data.url}\n\nHEADERS\n${data.headers.slice(0,12000)}\n\nBODY\n${data.body.slice(0,12000)}\n\nRequest memakai data asli dari perangkat. Periksa sebelum menyetujui.`,signal))return {cancelled:true};
    const id=await actions.replay(data,AGENT_APPROVED);return id?{id,result:safeRow(store.get(id),true)}:{cancelled:true};
  }
  if(name==='copy_curl'){return {copied:await actions.copy(args.id,'curl')};}
  if(name==='export_har')return {exported:await actions.export(false)};
  if(name==='clear_traffic'){if(!await confirmAgent('Bersihkan seluruh traffic?', 'Request yang tersimpan di sesi ini akan dihapus.',signal))return {cancelled:true};return {cleared:await actions.clear()};}
  if(name==='check_update')return {checked:await actions.update('check')};
  if(name==='remember'){
    if(!args.note.trim())throw Error('Catatan kosong.');if(!await confirmAgent('Simpan ke MEMORY.md?',args.note,signal))return {cancelled:true};
    const old=agent.config.files['MEMORY.md'],next=old+'\n\n- '+args.note.trim();if(Buffer.byteLength(next)>MAX_FILE)throw Error('MEMORY.md penuh. Edit catatan melalui pengaturan.');agent.config.files['MEMORY.md']=next;try{await agent.persist();}catch(e){agent.config.files['MEMORY.md']=old;throw e;}return {remembered:true};
  }
  throw Error('Alat tidak tersedia.');
}
app.whenReady().then(()=>{
  inspector=secureWindow({width:1440,height:920,minWidth:1000,minHeight:650,title:'Arus',autoHideMenuBar:true,backgroundColor:'#121518',icon:path.join(__dirname,'../assets/icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs')}});
  inspector.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  inspector.webContents.on('will-navigate',e=>e.preventDefault());
  agent=new Agent({directory:app.getPath('userData'),safeStorage,execute:executeAgent,notify:data=>send({kind:'agent-progress',data}),context:data=>({capturing,browserKind,browserTools:'Use browser_tabs to inspect open tabs and browser_read to read a page.',total:store.rows.size,selected:data.selectedId?safeRow(store.get(data.selectedId),true):null})});
  camoufox=new CamoufoxBrowser({directory:app.getPath('userData'),notify:status});
  browserAgent=new BrowserAgent({adapter:()=>browserKind==='camoufox'?camoufoxAdapter(camoufox):embeddedAdapter(browser),confirm:confirmAgent});
  setupIpc();startEngine();setupUpdates();inspector.loadFile(path.join(__dirname,'index.html'));
  inspector.on('closed',()=>{inspector=null;browser?.close();app.quit();});
});
app.on('before-quit',event=>{
  agent?.cancel();
  if(!quitting && (camoufox?.browser || camoufox?.opening)){event.preventDefault();quitting=true;camoufox.close().catch(()=>{}).finally(()=>app.quit());return;}
  engine?.kill();
});
app.on('window-all-closed',()=>app.quit());
