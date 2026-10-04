'use strict';
const {pageOperation}=require('./browser-agent.cjs');
const {validUrl}=require('./capture.cjs');
function script(fn,data){return '('+fn.toString()+')('+JSON.stringify(data)+')';}
function embeddedAdapter(browser){
  const {BrowserWindow,session}=require('electron');
  const records=()=>{
    if(!browser||browser.isDestroyed())throw Error('Buka Browser Arus terlebih dahulu.');
    const tabs=browser.tabs.map(t=>({id:t.id,wc:t.wc,title:t.title,url:t.wc.getURL(),active:t.id===browser.active,activate:()=>browser.select(t.id),close:()=>browser.remove(t.id)}));
    for(const w of BrowserWindow.getAllWindows())if(w.webContents.session===session.fromPartition('arus-capture')&&!w.webContents.isDestroyed())tabs.push({id:'popup-'+w.webContents.id,wc:w.webContents,title:w.webContents.getTitle(),url:w.webContents.getURL(),active:w.isFocused(),popup:true,activate:()=>w.show(),close:()=>w.destroy()});return tabs;
  };
  const getTab=id=>{
    const record=records().find(t=>id?t.id===id:t.active)||(!id?records()[0]:null);if(!record)throw Error('Tab tidak ditemukan.');const wc=record.wc;
    return {...record,get epoch(){return wc.__arusAgentEpoch||0;},frames:async()=>wc.mainFrame.framesInSubtree.map(f=>({id:String(f.processId)+':'+f.routingId,get url(){return f.url;},evaluate:(fn,data)=>f===wc.mainFrame?wc.executeJavaScriptInIsolatedWorld(999,[{code:script(fn,data)}]):f.executeJavaScript(script(fn,data)),perform:async(op,data,signal)=>{
      const evaluate=(args)=>f===wc.mainFrame?wc.executeJavaScriptInIsolatedWorld(999,[{code:script(pageOperation,args)}]):f.executeJavaScript(script(pageOperation,args));
      if(op==='fill'){signal.throwIfAborted();await evaluate({op:'fill',target:data.target,text:data.text});}
      else if(op==='press'){await evaluate({op:'focus-key',target:data.target});signal.throwIfAborted();const key=data.key==='Space'?' ':data.key;wc.sendInputEvent({type:'keyDown',keyCode:key});wc.sendInputEvent({type:'keyUp',keyCode:key});}
      else await evaluate({...data,op});
    }}))};
  };
  return {kind:'embedded-'+browser?.shellId,tabs:records,getTab,newTab:url=>browser.open(url),tab:async(action,id)=>{const tab=getTab(id);if(action==='select')await tab.activate();else if(action==='close')await tab.close();else throw Error('Aksi tab tidak dikenal.');}};
}
function camoufoxAdapter(camoufox){
  camoufox.agentPageIds||=new WeakMap();camoufox.agentPageEpochs||=new WeakMap();camoufox.agentPageSequence||=0;
  const records=()=>{if(!camoufox.isOpen)throw Error('Buka Camoufox terlebih dahulu.');return camoufox.context.pages().filter(p=>!p.isClosed()).map(p=>{if(!camoufox.agentPageIds.has(p)){camoufox.agentPageIds.set(p,'fox-'+(++camoufox.agentPageSequence));camoufox.agentPageEpochs.set(p,0);p.on('framenavigated',()=>camoufox.agentPageEpochs.set(p,(camoufox.agentPageEpochs.get(p)||0)+1));}return {id:camoufox.agentPageIds.get(p),page:p,url:p.url(),active:p===camoufox.page,activate:async()=>{camoufox.page=p;await p.bringToFront();},close:()=>p.close({runBeforeUnload:false})};});};
  const getTab=id=>{const record=records().find(t=>id?t.id===id:t.active)||(!id?records()[0]:null);if(!record)throw Error('Tab tidak ditemukan.');const page=record.page;return {...record,get epoch(){return camoufox.agentPageEpochs.get(page)||0;},frames:async()=>page.frames().map((f,index)=>({id:String(index),get url(){return f.url();},evaluate:(fn,data)=>f.evaluate(fn,data),perform:async(op,data,signal)=>{
    if(op==='scroll')return f.evaluate(pageOperation,{...data,op});
    const handle=await f.evaluateHandle(pageOperation,{op:'resolve',target:data.target});try{const el=handle.asElement();if(!el)throw Error('Elemen tidak ditemukan.');signal.throwIfAborted();
      if(op==='click')await el.click({timeout:1500});else if(op==='fill'){await f.evaluate(pageOperation,{op:'focus',target:data.target});signal.throwIfAborted();await el.fill(data.text,{timeout:1500});}else if(op==='select')await el.selectOption(data.value,{timeout:1500});else if(op==='press')await el.press(data.key,{timeout:1500});else throw Error('Aksi tidak dikenal.');
    }finally{await handle.dispose();}
  }}))};};
  return {kind:'camoufox-'+camoufox.generation,tabs:records,getTab,newTab:async url=>{const p=await camoufox.context.newPage();camoufox.page=p;await p.goto(url,{waitUntil:'domcontentloaded',timeout:15000});return getTab().id;},tab:async(action,id)=>{const tab=getTab(id);if(action==='select')await tab.activate();else if(action==='close')await tab.close();else throw Error('Aksi tab tidak dikenal.');}};
}
module.exports={embeddedAdapter,camoufoxAdapter};
