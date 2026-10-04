'use strict';
const path=require('node:path');
const fs=require('node:fs/promises');
class CamoufoxBrowser {
  constructor({directory,notify}){this.directory=directory;this.notify=notify;this.browser=null;this.context=null;this.page=null;this.generation=0;this.state='idle';this.opening=null;}
  get isOpen(){return this.state==='ready' && !!this.browser?.isConnected();}
  progress(state){this.state=state;this.notify();}
  async open(url,port){
    if(this.opening)throw Error('Camoufox masih disiapkan.');
    if(this.isOpen && this.page && !this.page.isClosed()){await this.page.bringToFront();await this.page.goto(url);return;}
    const generation=++this.generation;
    this.opening=this.launch(url,port,generation);
    try{await this.opening;}finally{this.opening=null;}
  }
  async launch(url,port,generation){
    let launched;
    try{
      process.env.CAMOUFOX_INSTALL_DIR||=path.join(this.directory,'camoufox');
      const manager=await import('camoufox-js/dist/pkgman.js');
      try{manager.camoufoxPath(false);}catch{this.progress('downloading');await new manager.CamoufoxFetcher().install();}
      if(generation!==this.generation)throw Error('Pembukaan Camoufox dibatalkan.');
      this.progress('starting');
      const properties=JSON.parse(await fs.readFile(manager.getPath('properties.json'),'utf8'));
      const supported=new Set(properties.map(p=>p.property));
      if(!supported.has('navigator.userAgent'))throw Error('Versi mesin Camoufox belum kompatibel.');
      // The wrapper still generates legacy options removed by newer native builds.
      // Keep only keys advertised by this installed engine, without changing upstream code.
      const config=new Proxy({}, {set(target,key,value){if(supported.has(key))target[key]=value;return true;}});
      const {launchOptions}=await import('camoufox-js');
      const {firefox}=require('playwright-core');
      const options=await launchOptions({config,headless:false,os:process.platform==='win32'?'windows':process.platform==='darwin'?'macos':'linux',geoip:false,exclude_addons:['UBO'],block_webrtc:true,
        firefox_user_prefs:{'dom.disable_open_during_load':false,'network.proxy.allow_hijacking_localhost':true,'network.proxy.no_proxies_on':'','security.enterprise_roots.enabled':false},
        proxy:{server:`http://127.0.0.1:${port}`,bypass:''}});
      launched=await firefox.launch({...options,timeout:60000});
      if(generation!==this.generation){await launched.close();throw Error('Pembukaan Camoufox dibatalkan.');}
      this.browser=launched;
      // TLS is terminated by the local capture proxy; it still validates upstream TLS.
      this.context=await launched.newContext({ignoreHTTPSErrors:true,acceptDownloads:false,viewport:null});
      const context=this.context;
      context.on('page',page=>{
        page.on('dialog',dialog=>(dialog.type()==='beforeunload'?dialog.accept():dialog.dismiss()).catch(()=>{}));
        page.on('download',download=>download.cancel().catch(()=>{}));
        page.on('close',()=>{
          if(this.context!==context || this.state!=='ready')return;
          const remaining=context.pages().filter(p=>!p.isClosed());this.page=remaining.at(-1)||null;
          if(!remaining.length)this.close().catch(()=>{});
        });
      });
      launched.on('disconnected',()=>{if(this.browser===launched){this.browser=null;this.context=null;this.page=null;this.progress('idle');}});
      this.page=await context.newPage();await this.page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});this.progress('ready');
    }catch(error){
      if(launched)await launched.close().catch(()=>{});
      this.browser=null;this.context=null;this.page=null;
      this.progress(generation===this.generation?'error':'idle');
      throw Error(`Camoufox: ${error.message}`);
    }
  }
  async control(action){
    if(action==='close')return this.close();
    if(!this.page || this.page.isClosed())return;
    if(action==='focus')await this.page.bringToFront();
    else if(action==='reload')await this.page.reload();
  }
  async close(){
    ++this.generation;
    const browser=this.browser;this.browser=null;this.context=null;this.page=null;
    if(browser)await browser.close();this.progress('idle');
  }
}
module.exports={CamoufoxBrowser};
