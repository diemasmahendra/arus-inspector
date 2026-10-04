'use strict';
const {BrowserWindow,WebContentsView,ipcMain}=require('electron');
const path=require('node:path');
const {validUrl}=require('./capture.cjs');
const shells=new Map();
function allowed(url){if(url==='about:blank')return true;try{validUrl(url);return true;}catch{return false;}}
ipcMain.handle('browser-state',event=>owner(event).snapshot());
ipcMain.handle('browser-action',(event,action,data)=>owner(event).action(action,data));
function owner(event){const shell=shells.get(event.sender.id);if(!shell || event.senderFrame!==shell.win.webContents.mainFrame)throw Error('Akses ditolak.');return shell;}
function configurePopup(wc){
  wc.setWindowOpenHandler(({url})=>allowed(url)?{action:'allow',outlivesOpener:false,overrideBrowserWindowOptions:{title:'Arus Popup',autoHideMenuBar:true,frame:true,minWidth:400,minHeight:320,webPreferences:{partition:'arus-capture',contextIsolation:true,nodeIntegration:false,sandbox:true,webviewTag:false}}}:{action:'deny'});
  wc.on('did-create-window',child=>{configurePopup(child.webContents);child.webContents.on('will-prevent-unload',e=>e.preventDefault());for(const event of ['will-navigate','will-redirect'])child.webContents.on(event,(e,url)=>{if(!allowed(url))e.preventDefault();});});
}
class BrowserTabs {
  constructor({onClosed}){
    this.tabs=[];this.active=null;this.sequence=0;this.onClosed=onClosed;this.disposed=false;
    this.win=new BrowserWindow({width:1180,height:800,minWidth:640,minHeight:440,title:'Arus Browser',autoHideMenuBar:true,backgroundColor:'#121518',webPreferences:{preload:path.join(__dirname,'browser-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    this.shellId=this.win.webContents.id;shells.set(this.shellId,this);
    this.win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    this.win.webContents.on('will-navigate',e=>e.preventDefault());
    this.win.webContents.on('did-finish-load',()=>this.emit());
    this.win.on('resize',()=>this.layout());
    this.win.on('closed',()=>{this.disposed=true;shells.delete(this.shellId);for(const tab of this.tabs){clearTimeout(tab.timeout);if(!tab.wc.isDestroyed())tab.wc.close({waitForBeforeUnload:false});}this.tabs=[];this.onClosed();});
    this.win.loadFile(path.join(__dirname,'browser.html'));
  }
  snapshot(){const tab=this.tabs.find(t=>t.id===this.active);return {active:this.active,tabs:this.tabs.map(t=>({id:t.id,title:t.title,url:t.url,loading:t.loading,error:t.error})),canBack:!!tab?.wc.navigationHistory.canGoBack(),canForward:!!tab?.wc.navigationHistory.canGoForward()};}
  emit(){if(!this.disposed && !this.win.isDestroyed()){this.layout();this.win.webContents.send('browser-state',this.snapshot());}}
  layout(){if(this.disposed)return;const [width,height]=this.win.getContentSize(),top=this.tabs.find(t=>t.id===this.active)?.error?126:96;for(const tab of this.tabs){tab.view.setBounds({x:0,y:top,width,height:Math.max(1,height-top)});tab.view.setVisible(tab.id===this.active);}}
  select(id){if(!this.tabs.some(t=>t.id===id))return;this.active=id;this.layout();this.emit();this.tabs.find(t=>t.id===id).wc.focus();}
  create({parent=null,preferences={},activate=true}={}){
    const view=new WebContentsView({webPreferences:{...preferences,preload:undefined,partition:'arus-capture',contextIsolation:true,nodeIntegration:false,sandbox:true,webviewTag:false}});
    const wc=view.webContents,tab={id:String(++this.sequence),view,wc,parent,title:'Tab baru',url:'about:blank',loading:false,error:''};
    this.tabs.push(tab);this.win.contentView.addChildView(view);
    configurePopup(wc);
    for(const event of ['will-navigate','will-redirect'])wc.on(event,(e,url)=>{if(!allowed(url))e.preventDefault();});
    wc.on('will-prevent-unload',e=>e.preventDefault());
    wc.on('page-title-updated',(_e,title)=>{tab.title=title||'Tab baru';this.emit();});
    const navigated=()=>{tab.url=wc.getURL()||'about:blank';this.emit();};
    wc.on('did-navigate',navigated);wc.on('did-navigate-in-page',navigated);
    wc.on('did-start-loading',()=>{tab.loading=true;tab.error='';clearTimeout(tab.timeout);tab.timeout=setTimeout(()=>{if(!wc.isDestroyed() && wc.isLoading()){wc.stop();tab.loading=false;tab.error='Loading terlalu lama. Kamu bisa mencoba reload.';this.emit();}},30000);this.emit();});
    wc.on('did-stop-loading',()=>{tab.loading=false;clearTimeout(tab.timeout);navigated();});
    wc.on('did-fail-load',(_e,code,message,_url,main)=>{if(!main || code===-3)return;tab.error=`Halaman gagal dimuat: ${message}`;tab.loading=false;clearTimeout(tab.timeout);this.emit();});
    wc.on('render-process-gone',()=>{tab.loading=false;tab.error='Tab berhenti merespons. Coba reload.';this.emit();});
    wc.on('destroyed',()=>{if(!this.disposed && this.tabs.includes(tab))this.remove(tab.id,false);});
    wc.on('before-input-event',(event,input)=>this.shortcut(event,input));
    if(activate)this.select(tab.id);else{view.setVisible(false);this.layout();}return tab;
  }
  open(url){const tab=this.create();this.navigate(tab,url);this.show();return tab.id;}
  navigate(tab,url){if(!allowed(url))throw Error('URL tidak valid.');tab.url=url;tab.error='';tab.wc.loadURL(url).catch(()=>{});this.emit();}
  remove(id,close=true){const tab=this.tabs.find(t=>t.id===id);if(!tab)return;for(const child of [...this.tabs].filter(t=>t.parent===id))this.remove(child.id);const index=this.tabs.indexOf(tab);this.tabs.splice(index,1);clearTimeout(tab.timeout);this.win.contentView.removeChildView(tab.view);if(close && !tab.wc.isDestroyed())tab.wc.close({waitForBeforeUnload:false});if(!this.tabs.length){this.win.destroy();return;}if(this.active===id)this.active=this.tabs[Math.min(index,this.tabs.length-1)].id;this.layout();this.emit();}
  shortcut(event,input){if(input.type!=='keyDown')return;const key=input.key.toLowerCase(),ctrl=input.control||input.meta;if(ctrl && ['t','w','l','tab'].includes(key)){event.preventDefault();if(key==='t'){this.open('about:blank');this.address();}else if(key==='w')this.remove(this.active);else if(key==='l')this.address();else{const i=this.tabs.findIndex(t=>t.id===this.active);this.select(this.tabs[(i+(input.shift?-1:1)+this.tabs.length)%this.tabs.length].id);}}}
  address(){this.win.webContents.focus();this.win.webContents.send('browser-focus-address');}
  action(action,data={}){const tab=this.tabs.find(t=>t.id===this.active);if(action==='new'){this.open('about:blank');this.address();}else if(action==='select' && typeof data.id==='string')this.select(data.id);else if(action==='close' && typeof data.id==='string')this.remove(data.id);else if(action==='navigate' && typeof data.url==='string'){this.navigate(tab,data.url==='about:blank'?data.url:validUrl(data.url));}else if(action==='back' && tab?.wc.navigationHistory.canGoBack())tab.wc.navigationHistory.goBack();else if(action==='forward' && tab?.wc.navigationHistory.canGoForward())tab.wc.navigationHistory.goForward();else if(action==='reload' && tab)tab.loading?tab.wc.stop():tab.wc.reload();else throw Error('Aksi browser tidak tersedia.');return true;}
  show(){if(!this.win.isDestroyed()){this.win.show();this.win.focus();}}
  reload(){const tab=this.tabs.find(t=>t.id===this.active);tab?.wc.reload();}
  isDestroyed(){return this.win.isDestroyed();}
  destroy(){if(!this.win.isDestroyed())this.win.destroy();}
  close(){this.destroy();}
}
module.exports={BrowserTabs};
