'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {BrowserAgent}=require('../src/browser-agent.cjs');
function fixture({approve=true,sensitive=false,label='Save changes',tag='button',href=''}={}){
 const target={path:['button'],tag,kind:tag,label,href,sensitive,disabled:false,editable:false};let url='https://example.com/',performed=0,confirmations=0;
 const frame={id:'main',get url(){return url;},evaluate:async(_fn,data)=>data.op==='read'?{url,title:'Example',text:'Example',elements:[target],scroll:{},truncated:false}:target,perform:async()=>{performed++;}};
 const tab={id:'one',epoch:0,url,title:'Example',active:true,frames:async()=>[frame],activate:()=>{}};
 const adapter={kind:'test',tabs:()=>[tab],getTab:()=>tab};
 const driver=new BrowserAgent({adapter:()=>adapter,confirm:async()=>{confirmations++;return approve;}});
 return {driver,signal:new AbortController().signal,target,get performed(){return performed;},get confirmations(){return confirmations;},navigate:()=>{url='https://example.com/new';}};
}
test('cancelled browser button click cannot execute; approved click executes once',async()=>{
 for(const approve of [false,true]){const f=fixture({approve}),read=await f.driver.run('browser_read',{},f.signal);const result=await f.driver.run('browser_click',{ref:read.elements[0].ref},f.signal);assert.equal(f.confirmations,1);assert.equal(f.performed,approve?1:0);assert.equal(!!result.cancelled,!approve);}
});
test('browser refs expire on navigation and never reveal selectors',async()=>{
 const f=fixture(),read=await f.driver.run('browser_read',{},f.signal),ref=read.elements[0].ref;assert(!JSON.stringify(read).includes('"path"'));f.navigate();await assert.rejects(f.driver.run('browser_click',{ref},f.signal),/Halaman berubah/);assert.equal(f.performed,0);
});
test('sensitive browser fields reject fill and Enter before any execution',async()=>{
 const f=fixture({sensitive:true}),read=await f.driver.run('browser_read',{},f.signal),ref=read.elements[0].ref;
 for(const name of ['browser_fill','browser_press','browser_select'])await assert.rejects(f.driver.run(name,{ref,text:'secret',key:'Enter',value:'secret'},f.signal),/manual/);assert.equal(f.performed,0);assert.equal(f.confirmations,0);
});
test('Stop cancels bounded browser wait and hanging page read',async()=>{
 const f=fixture(),controller=new AbortController();const waiting=f.driver.run('browser_wait',{ms:5000},controller.signal);controller.abort();await assert.rejects(waiting);
 const second=new AbortController();f.driver.adapter=()=>({kind:'test',getTab:()=>({id:'one',frames:()=>new Promise(()=>{})})});const reading=f.driver.run('browser_read',{},second.signal);second.abort();await assert.rejects(reading);
});
test('ordinary link clicks run directly while action links require approval',async()=>{
 for(const href of ['https://example.com/help','https://example.com/delete-account']){const f=fixture({approve:false,tag:'a',label:'Open',href}),read=await f.driver.run('browser_read',{},f.signal);await f.driver.run('browser_click',{ref:read.elements[0].ref},f.signal);assert.equal(f.performed,href.endsWith('/help')?1:0);}
});
