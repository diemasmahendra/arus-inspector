const {app, BrowserWindow, ipcMain, clipboard, dialog, session, utilityProcess} = require('electron');
const path = require('node:path');
const {X509Certificate} = require('node:crypto');
const fs = require('node:fs/promises');
const {CaptureStore, validUrl, isText, clip, curl, MAX_BODY} = require('./capture.cjs');
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
function status() { send({kind:'status', data:{capturing, browserOpen:!!browser, engine:engineState, port:enginePort, update:updateState}}); }
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
  if (browser && !browser.isDestroyed()) { browser.show(); await browser.loadURL(url); return; }
  browser = secureWindow({width:1180,height:800,title:'Arus Browser',autoHideMenuBar:true,backgroundColor:'#ffffff', webPreferences:{partition:'arus-capture'}});
  const win = browser, wc = win.webContents;
  await enginePromise;
  await wc.session.setProxy({proxyRules:`http=127.0.0.1:${enginePort};https=127.0.0.1:${enginePort}`,proxyBypassRules:'<-loopback>'});
  wc.session.setCertificateVerifyProc((request,callback)=>{
    try {
      const cert=new X509Certificate(request.certificate.data);
      const host=cert.checkHost(request.hostname) || cert.checkIP(request.hostname);
      const now=Date.now();
      if(host && cert.verify(rootCertificate.publicKey) && now>=Date.parse(cert.validFrom) && now<=Date.parse(cert.validTo)) return callback(0);
    } catch {}
    callback(-3);
  });
  wc.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  wc.session.setPermissionCheckHandler(()=>false);
  wc.session.on('will-download', event=>event.preventDefault());
  wc.setWindowOpenHandler(({url:next})=>{ try {const target=validUrl(next); win.loadURL(target).catch(()=>{});} catch {} return {action:'deny'}; });
  wc.on('will-navigate', (event, next)=> {try {validUrl(next);} catch {event.preventDefault();}});
  wc.on('will-redirect', (event, next)=> {try {validUrl(next);} catch {event.preventDefault();}});
  win.on('closed',()=>{browser=null;store.ids.clear();status();});
  status(); await win.loadURL(url);
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args)=>{
    if (!inspector || event.sender !== inspector.webContents || event.senderFrame !== inspector.webContents.mainFrame) throw new Error('Akses ditolak.');
    return fn(...args);
  });
}
function setupIpc() {
  handle('state',()=>({rows:store.list(),capturing,browserOpen:!!browser,engine:engineState,port:enginePort,version:app.getVersion(),update:updateState}));
  handle('open',async url=>{await enginePromise;await makeBrowser(validUrl(url));return true;});
  handle('control', action=>{
    if(action==='pause') capturing=false;
    else if(action==='resume') capturing=true;
    else if(action==='focus') browser?.show();
    else if(action==='reload') browser?.webContents.reload();
    else throw new Error('Kontrol tidak dikenal.');
    if(action==='pause' || action==='resume') engine?.postMessage({kind:'capture',active:capturing});
    status();return capturing;
  });
  handle('clear',()=>{store.clear();engine?.postMessage({kind:'clear',epoch:store.generation});return true;});
  handle('certificate',async()=>{await enginePromise;const {canceled,filePath}=await dialog.showSaveDialog(inspector,{defaultPath:'Arus-Root-CA.crt',filters:[{name:'Certificate',extensions:['crt']}]});if(canceled)return false;await fs.writeFile(filePath,rootCertificate.toString());return true;});
  handle('detail',id=>store.get(id));
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
  handle('replay',async data=>{
    const url=validUrl(data?.url), method=String(data?.method || 'GET').toUpperCase();
    if(!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method)) throw new Error('Metode tidak valid.');
    if(typeof data.headers!=='string' || data.headers.length>64000 || typeof data.body!=='string' || data.body.length>MAX_BODY) throw new Error('Request terlalu besar.');
    const headers=JSON.parse(data.headers || '{}');
    if(!headers || Array.isArray(headers) || typeof headers!=='object' || Object.entries(headers).some(([k,v])=>typeof v!=='string' || /[\r\n]/.test(k+v))) throw new Error('Header harus berupa objek JSON dengan nilai teks.');
    if (method!=='GET' && method!=='HEAD') {const {response}=await dialog.showMessageBox(inspector,{type:'question',buttons:['Batal',`Kirim ${method}`],defaultId:0,cancelId:0,message:`Kirim request ${method}?`,detail:`Request ini dapat mengubah data di server.\n${url}`});if(response!==1)return null;}
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
app.whenReady().then(()=>{
  inspector=secureWindow({width:1440,height:920,minWidth:1000,minHeight:650,title:'Arus',autoHideMenuBar:true,backgroundColor:'#121518',icon:path.join(__dirname,'../assets/icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs')}});
  inspector.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  inspector.webContents.on('will-navigate',e=>e.preventDefault());
  setupIpc();startEngine();setupUpdates();inspector.loadFile(path.join(__dirname,'index.html'));
  inspector.on('closed',()=>{inspector=null;browser?.close();app.quit();});
});
app.on('before-quit',()=>engine?.kill());
app.on('window-all-closed',()=>app.quit());
