// Whistle stays in a separate process: its patches never touch Electron's main process.
const {parentPort} = require('node:worker_threads');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
// Some restricted hosts cannot enumerate interfaces; Arus only binds loopback.
const os = require('node:os'), interfaces = os.networkInterfaces;
os.networkInterfaces = () => {try{return interfaces();}catch{return {lo:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]};}};
const send = message => process.parentPort ? process.parentPort.postMessage(message) : process.send?.(message);
let proxy, active = true, startTime = '0', tracked = new Map(), signatures = new Map(), tick, epoch=0;
const MAX = 1024 * 1024;
const {ProxyControls}=require('./proxy-controls.cjs');
const controls=new ProxyControls(send);
require('./proxy-middleware.cjs').setControls(controls);
function timings(item){const start=item.startTime,points=[['dns',item.dnsTime],['connect',item.connectTime],['send',item.requestTime],['wait',item.responseTime],['receive',item.endTime]];let previous=start;return Object.fromEntries(points.map(([key,at])=>{const value=Number.isFinite(at)&&at>=previous?at-previous:null;if(value!==null)previous=at;return [key,value];}));}
function body(data = {}) {
  let buf = data.base64 ? Buffer.from(data.base64,'base64') : Buffer.isBuffer(data.body) ? data.body : Buffer.from(data.body || '');
  return buf.subarray(0,MAX).toString('utf8');
}
function normalize(item) {
  const req=item.req || {}, res=item.res || {}, mime=String(res.headers?.['content-type'] || '');
  const text=/json|text|javascript|xml|svg|x-www-form-urlencoded/.test(mime);
  return {engineId:item.id,url:item.url,method:req.method || 'GET',type:item.isHttps?'Tunnel':/^wss?:/.test(item.url)?'WebSocket':/json/.test(mime)?'Fetch':/html/.test(mime)?'Document':/image/.test(mime)?'Image':'Other',
    startedAt:new Date(item.startTime).toISOString(),status:item.resError || item.reqError ? 0 : res.statusCode || null,
    statusText:res.statusMessage || '',duration:item.endTime?Math.max(0,item.endTime-item.startTime):null,
    size:res.size || 0,requestHeaders:req.headers || {},responseHeaders:res.headers || {},
    requestBody:body(req),responseBody:text?body(res):'',mime,protocol:res.httpVersion ? `HTTP/${res.httpVersion}` : '',
    remoteAddress:res.ip || '',timings:timings(item),sslState:item.isHttps?'bypassed':/^(https|wss):/.test(item.url)?(item.resError||item.reqError?'failed':'inspected'):'none',imageBase64:/^image\/(png|jpeg|gif|webp|avif|bmp)(;|$)/i.test(mime)&&res.size<=MAX?res.base64||'':'',...controls.metadata.get(item.id),error:item.resError || item.reqError ? body(res) || body(req) || 'Koneksi gagal.' : '',
    bodyNote:item.isHttps?'HTTPS tunnel; gunakan browser Arus atau percayai CA Arus untuk melihat isinya.':res.size>MAX?'Body dibatasi 1 MiB.':!text && item.endTime?'Konten biner; body tidak ditampilkan.':''};
}
function poll() {
  if(!proxy) return;
  const result=proxy.getData({startTime,count:100,ids:active?[...tracked.keys()]:[]});
  if(result.lastId) startTime=result.lastId;
  if(!active) return;
  const rows=[];
  for(const item of Object.values(result.data || {})) {
    if(!/^(https?|wss?):\/\//.test(item.url)) continue;
    const row=normalize(item), hash=crypto.createHash('sha1').update(JSON.stringify(row)).digest('hex');
    if(signatures.get(item.id)!==hash){rows.push(row);signatures.set(item.id,hash);}
    if(item.endTime || item.reqError || item.resError) tracked.delete(item.id); else tracked.set(item.id,Date.now());
  }
  while(signatures.size>3000) signatures.delete(signatures.keys().next().value);
  for(const [id,time] of tracked) if(Date.now()-time>120000) tracked.delete(id);
  if(rows.length) send({kind:'rows',rows,epoch});
}
function receive({data:msg}) {
  if(msg.kind==='settings'){try{controls.set(msg.settings,proxy);send({kind:'reply',id:msg.id,data:controls.snapshot()});}catch(e){send({kind:'reply',id:msg.id,error:e.message});}return;}
  if(msg.kind==='breakpoint-resolve'){try{const data=controls.resolve(msg.breakpointId,msg.decision);send({kind:'reply',id:msg.id,data});}catch(e){send({kind:'reply',id:msg.id,error:e.message});}return;}
  if(msg.kind==='start') {
    const server=http.createServer();
    server.on('error', e=>send({kind:'error',message:e.message}));
    server.listen(0,'127.0.0.1',()=>{
      require('whistle')({server,baseDir:msg.directory,dataDirname:'engine',mode:'headless|captureData|enableCapture|safe',disableAllPlugins:true,disableAllRules:false,reqCacheSize:300,middlewares:require('node:path').join(__dirname,'proxy-middleware.cjs'),
        username:'arus',password:crypto.randomBytes(32).toString('hex')}, p=>{
        proxy=p;controls.set(msg.settings||controls.settings,proxy);
        proxy.on('frame',frame=>{if(!active)return;const bin=frame.bin?Buffer.from(frame.bin):Buffer.from(frame.base64||'','base64');send({kind:'frame',epoch,engineId:frame.reqId,data:{id:frame.frameId,isClient:!!frame.isClient,opcode:frame.opcode||0,closed:!!frame.closed,error:frame.err||'',length:frame.length||bin.length,text:frame.opcode===1?bin.subarray(0,65536).toString('utf8'):'',base64:frame.opcode===2?bin.subarray(0,65536).toString('base64'):'',truncated:bin.length>65536}});});
        send({kind:'ready',port:server.address().port,certificate:fs.readFileSync(proxy.httpsUtil.getRootCAFile(),'utf8')});
        tick=setInterval(poll,300);
      });
    });
  } else if(msg.kind==='capture') {active=msg.active;tracked.clear();signatures.clear();const r=proxy?.getData({count:0});if(r?.endId) startTime=r.endId;}
  else if(msg.kind==='clear') {epoch=msg.epoch;tracked.clear();signatures.clear();const r=proxy?.getData({count:0});if(r?.endId) startTime=r.endId;}
}
if(process.parentPort) process.parentPort.on('message',receive);
else process.on('message',msg=>receive({data:msg}));
