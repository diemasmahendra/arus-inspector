'use strict';
const http=require('node:http'),https=require('node:https'),fs=require('node:fs/promises');
const {Readable}=require('node:stream');
const {randomUUID,X509Certificate}=require('node:crypto');
const {matches,defaults,validateSettings,shadowRules}=require('./proxy-settings.cjs');
const MAX=1024*1024,MAX_METADATA=24*1024*1024;
function certificate(socket){try{const peer=socket?.getPeerCertificate?.();if(!peer?.raw)return null;const c=new X509Certificate(peer.raw);return {subject:c.subject,issuer:c.issuer,validFrom:c.validFrom,validTo:c.validTo,serialNumber:c.serialNumber,fingerprint256:c.fingerprint256,subjectAltName:c.subjectAltName,tls:socket.getProtocol?.(),cipher:socket.getCipher?.()?.name,authorized:socket.authorized===true,source:'upstream socket'};}catch{return null;}}
class ProxyControls{
 constructor(send){this.send=send;this.settings=defaults();this.pending=new Map();this.metadata=new Map();this.metadataCosts=new Map();this.metadataBytes=0;}
 set(value,proxy){this.settings=validateSettings(value);proxy?.setShadowRules(shadowRules(this.settings));return this.settings;}
 annotate(req,value){const key=req.reqId,next={...this.metadata.get(key),...value};this.metadataBytes-=this.metadataCosts.get(key)||0;const cost=Buffer.byteLength(JSON.stringify(next));this.metadata.set(key,next);this.metadataCosts.set(key,cost);this.metadataBytes+=cost;while(this.metadata.size>3000||this.metadataBytes>MAX_METADATA){const oldest=this.metadata.keys().next().value;this.metadataBytes-=this.metadataCosts.get(oldest)||0;this.metadata.delete(oldest);this.metadataCosts.delete(oldest);}}

 reply(res,status,body,headers={}){const src=Readable.from([Buffer.from(body)]);src.statusCode=status;src.headers={'content-type':'text/plain; charset=utf-8',...headers};res.response(src);}
 middleware(req,res,next){
  res.once('src',response=>{const cert=certificate(response.socket);if(cert)this.annotate(req,{certificate:cert});});
  const rules=this.settings.rules.filter(r=>matches(r,req.fullUrl,req.method));
  const block=rules.find(r=>r.kind==='block');if(block){this.annotate(req,{proxyAction:'Diblokir'});return this.reply(res,403,'Request diblokir oleh aturan Arus.');}
  const map=rules.find(r=>r.kind==='map');if(map){this.annotate(req,{proxyAction:'Map Local'});fs.stat(map.file).then(stat=>{if(!stat.isFile()||stat.size>MAX)throw Error('Map Local maksimal 1 MiB.');return fs.readFile(map.file);}).then(body=>this.reply(res,map.status,body,{'content-type':map.mime,'content-length':String(body.length)})).catch(()=>this.reply(res,502,'File Map Local tidak dapat dibaca atau melebihi 1 MiB.'));return;}
  const throttle=rules.find(r=>r.kind==='throttle');if(throttle){this.annotate(req,{proxyAction:'Throttling'});if(throttle.kbps)res.add(new (require('whistle/lib/util').WhistleTransform)({speed:throttle.kbps},req));}
  const proceed=()=>{if(rules.some(r=>r.kind==='breakpoint'))this.hold(req,res);else next();};
  if(throttle?.delay){const timer=setTimeout(proceed,throttle.delay);res.once('close',()=>clearTimeout(timer));}else proceed();
 }
 async hold(req,res){
  if(this.pending.size>=16)return this.reply(res,503,'Antrean breakpoint penuh (16 request).');
  const chunks=[];let size=0;try{for await(const chunk of req){size+=chunk.length;if(size>MAX){this.reply(res,413,'Breakpoint maksimal 1 MiB. Request belum dikirim.');return;}chunks.push(Buffer.from(chunk));}}catch{return;}
  const buffer=Buffer.concat(chunks),mime=String(req.headers['content-type']||''),editable=!req.headers['content-encoding']&&(!buffer.length||/json|text|xml|javascript|x-www-form-urlencoded/.test(mime));
  const id=randomUUID(),data={id,url:req.fullUrl,method:req.method,headers:{...req.headers},body:editable?buffer.toString('utf8'):'',editable,size,createdAt:new Date().toISOString()};
  this.annotate(req,{proxyAction:'Breakpoint · ditahan',requestBody:editable?buffer.toString('utf8'):'',requestBodyTruncated:!editable});
  const finish=decision=>{const p=this.pending.get(id);if(!p)return;this.pending.delete(id);clearTimeout(p.timer);this.send({kind:'breakpoint-done',id});if(!decision||decision.action==='abort'){this.annotate(req,{proxyAction:'Breakpoint · dibatalkan'});this.reply(res,499,'Request dibatalkan di Arus.');return;}this.forward(req,res,buffer,decision,data);};
  const timer=setTimeout(()=>finish({action:'abort'}),120000);this.pending.set(id,{data,timer,finish});res.once('close',()=>{if(this.pending.has(id)){this.pending.delete(id);clearTimeout(timer);this.send({kind:'breakpoint-done',id});}});this.send({kind:'breakpoint',data});
 }
 resolve(id,decision){const p=this.pending.get(id);if(!p)throw Error('Breakpoint sudah selesai atau kedaluwarsa.');if(!decision||!['continue','abort'].includes(decision.action))throw Error('Aksi breakpoint tidak valid.');if(decision.action==='continue'){
   if(typeof decision.method!=='string'||!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(decision.method)||!decision.headers||Array.isArray(decision.headers)||typeof decision.headers!=='object'||JSON.stringify(decision.headers).length>64000||Object.entries(decision.headers).some(([k,v])=>!k||!/^[-!#$%&'*+.^_`|~a-z0-9]+$/i.test(k)||typeof v!=='string'||/[\r\n]/.test(v)))throw Error('Metode / header tidak valid.');
   if(typeof decision.body!=='string'||Buffer.byteLength(decision.body)>MAX||(!p.data.editable&&decision.body))throw Error('Body tidak dapat diedit atau terlalu besar.');
  }p.finish(decision);return true;}
 forward(req,res,original,decision,data){
  const url=new URL(data.url),headers=Object.fromEntries(Object.entries(decision.headers).filter(([k])=>!/^(:|host$|content-length$|connection$|proxy-|transfer-encoding$|upgrade$|expect$)/i.test(k)));
  const body=['GET','HEAD'].includes(decision.method)?Buffer.alloc(0):data.editable?Buffer.from(decision.body):original;headers.host=url.host;headers['content-length']=String(body.length);
  this.annotate(req,{proxyAction:'Breakpoint · diteruskan',method:decision.method,requestHeaders:headers,requestBody:data.editable?body.toString('utf8'):'',requestBodyTruncated:!data.editable});
  const client=(url.protocol==='https:'?https:http).request(url,{method:decision.method,headers,rejectUnauthorized:true,timeout:30000},response=>{const cert=certificate(response.socket);if(cert)this.annotate(req,{certificate:cert});res.response(response);});client.on('timeout',()=>client.destroy(Error('Timeout upstream.')));client.on('error',e=>this.reply(res,502,e.message));res.once('close',()=>client.destroy());client.end(body);
 }
 snapshot(){return {settings:this.settings,pending:[...this.pending.values()].map(p=>p.data)};}
}
module.exports={ProxyControls,certificate,MAX_METADATA};
