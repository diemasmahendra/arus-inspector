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
function body(data = {}) {
  let buf = data.base64 ? Buffer.from(data.base64,'base64') : Buffer.isBuffer(data.body) ? data.body : Buffer.from(data.body || '');
  return buf.subarray(0,MAX).toString('utf8');
}
function normalize(item) {
  const req=item.req || {}, res=item.res || {}, mime=String(res.headers?.['content-type'] || '');
  const text=/json|text|javascript|xml|svg|x-www-form-urlencoded/.test(mime);
  return {engineId:item.id,url:item.url,method:req.method || 'GET',type:item.isHttps?'Tunnel':/json/.test(mime)?'Fetch':/html/.test(mime)?'Document':/image/.test(mime)?'Image':'Other',
    startedAt:new Date(item.startTime).toISOString(),status:item.resError || item.reqError ? 0 : res.statusCode || null,
    statusText:res.statusMessage || '',duration:item.endTime?Math.max(0,item.endTime-item.startTime):null,
    size:res.size || 0,requestHeaders:req.headers || {},responseHeaders:res.headers || {},
    requestBody:body(req),responseBody:text?body(res):'',mime,protocol:res.httpVersion ? `HTTP/${res.httpVersion}` : '',
    remoteAddress:res.ip || '',error:item.resError || item.reqError ? body(res) || body(req) || 'Koneksi gagal.' : '',
    bodyNote:item.isHttps?'HTTPS tunnel; gunakan browser Arus atau percayai CA Arus untuk melihat isinya.':res.size>MAX?'Body dibatasi 1 MiB.':!text && item.endTime?'Konten biner; body tidak ditampilkan.':''};
}
function poll() {
  if(!proxy) return;
  const result=proxy.getData({startTime,count:100,ids:active?[...tracked.keys()]:[]});
  if(result.lastId) startTime=result.lastId;
  if(!active) return;
  const rows=[];
  for(const item of Object.values(result.data || {})) {
    if(!/^https?:\/\//.test(item.url)) continue;
    const row=normalize(item), hash=crypto.createHash('sha1').update(JSON.stringify(row)).digest('hex');
    if(signatures.get(item.id)!==hash){rows.push(row);signatures.set(item.id,hash);}
    if(item.endTime || item.reqError || item.resError) tracked.delete(item.id); else tracked.set(item.id,Date.now());
  }
  while(signatures.size>3000) signatures.delete(signatures.keys().next().value);
  for(const [id,time] of tracked) if(Date.now()-time>120000) tracked.delete(id);
  if(rows.length) send({kind:'rows',rows,epoch});
}
function receive({data:msg}) {
  if(msg.kind==='start') {
    const server=http.createServer();
    server.on('error', e=>send({kind:'error',message:e.message}));
    server.listen(0,'127.0.0.1',()=>{
      require('whistle')({server,baseDir:msg.directory,dataDirname:'engine',mode:'headless|captureData|enableCapture|safe',disableAllPlugins:true,disableAllRules:true,reqCacheSize:300,
        username:'arus',password:crypto.randomBytes(32).toString('hex')}, p=>{
        proxy=p;
        send({kind:'ready',port:server.address().port,certificate:fs.readFileSync(proxy.httpsUtil.getRootCAFile(),'utf8')});
        tick=setInterval(poll,300);
      });
    });
  } else if(msg.kind==='capture') {active=msg.active;tracked.clear();signatures.clear();const r=proxy?.getData({count:0});if(r?.endId) startTime=r.endId;}
  else if(msg.kind==='clear') {epoch=msg.epoch;tracked.clear();signatures.clear();const r=proxy?.getData({count:0});if(r?.endId) startTime=r.endId;}
}
if(process.parentPort) process.parentPort.on('message',receive);
else process.on('message',msg=>receive({data:msg}));
