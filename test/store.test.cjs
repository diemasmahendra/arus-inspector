const test=require('node:test'),assert=require('node:assert/strict');
const {CaptureStore,validUrl,curl,MAX_BODY}=require('../src/capture.cjs');
test('URLs allow HTTP(S), reject credentials and non-web schemes',()=>{
  assert.equal(validUrl('example.com'),'https://example.com/');
  for(const url of ['file:///etc/passwd','javascript://alert(1)','https://user:password@example.com','ftp://example.com'])assert.throws(()=>validUrl(url));
});
test('standard HAR redacts login, query secrets and omits all bodies',()=>{
  const s=new CaptureStore();s.add({url:'https://example.com/?token=private&limit=10',method:'POST',status:200,requestHeaders:{Authorization:'Bearer private',Cookie:'session=private'},responseHeaders:{'Set-Cookie':'secret'},requestBody:'private-body',responseBody:'private-response'});
  const data=JSON.stringify(s.har());assert(!data.includes('private'));assert(!data.includes('secret'));assert(data.includes('REDACTED'));assert(data.includes('limit=10'));
  assert(JSON.stringify(s.har(true)).includes('private-body'));
});
test('cURL escapes shell quotes and redacts sensitive data by default',()=>{
  const r={url:"https://example.com/?token=secret",method:'POST',requestHeaders:{Authorization:'secret',test:"a'b"},requestBody:'secretbody'};
  assert(!curl(r).includes('secret'));assert(curl(r).includes("a'\\''b"));assert(curl(r,true).includes('secretbody'));
});
test('store bounds payload size, removes old rows and invalidates on clear',()=>{
  const s=new CaptureStore(),row=s.add({url:'https://example.com',method:'GET',responseBody:'a'.repeat(MAX_BODY+99)});
  assert.equal(s.get(row.id).responseBody.length,MAX_BODY);
  for(let i=0;i<3005;i++)s.add({url:'https://example.com/'+i,method:'GET'},String(i));
  assert.equal(s.rows.size,3000);assert.equal(s.get(row.id),null);const generation=s.generation;s.clear();assert.equal(s.rows.size,0);assert(s.generation>generation);
});
