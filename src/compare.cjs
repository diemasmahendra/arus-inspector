'use strict';
const {isForm,parseForm,contentType}=require('./body.js');
const MAX_FIELDS=500,MAX_DISPLAY=120;
function differences(left,right){const keys=[...new Set([...left.keys(),...right.keys()])].sort();let changed=0;const rows=keys.map(field=>{const hasLeft=left.has(field),hasRight=right.has(field),a=left.get(field),b=right.get(field),kind=!hasLeft?'added':!hasRight?'removed':a===b?'same':'changed';if(kind!=='same')changed++;return {field,left:hasLeft?String(a).slice(0,2000):null,right:hasRight?String(b).slice(0,2000):null,kind};});return {changed,total:rows.length,rows:rows.filter(r=>r.kind!=='same').slice(0,MAX_DISPLAY),same:rows.filter(r=>r.kind==='same').slice(0,MAX_DISPLAY),truncated:rows.length>MAX_DISPLAY};}
function headers(values){const map=new Map();for(const [k,v] of Object.entries(values||{}))map.set(k.toLowerCase(),String(v));return map;}
function body(text,mime){
 const map=new Map();let truncated=false,format='text';const put=(key,value)=>{if(map.size>=MAX_FIELDS){truncated=true;return;}const encoded=String(value);map.set(key,encoded);if(encoded.length>2000)truncated=true;};
 if(!text)return {map,format:'empty',truncated};
 if(isForm(mime)){format='form-urlencoded';const form=parseForm(text,MAX_FIELDS),counts=new Map();truncated=form.truncated;for(const [k,v] of form.entries){const i=counts.get(k)||0;counts.set(k,i+1);put(JSON.stringify(k)+'['+i+']',JSON.stringify(v));}}
 else{try{const value=JSON.parse(text);format='json';const visit=(v,key='$',depth=0)=>{if(depth>20||map.size>=MAX_FIELDS){truncated=true;return;}if(v&&typeof v==='object'&&Object.keys(v).length){for(const [k,next] of Object.entries(v))visit(next,key+'['+JSON.stringify(k)+']',depth+1);}else put(key,JSON.stringify(v));};visit(value);}catch{const lines=text.split('\n');if(lines.length>MAX_FIELDS)truncated=true;lines.slice(0,MAX_FIELDS).forEach((line,i)=>put('Baris '+(i+1),line));}}
 return {map,format,truncated};
}
function compareRequests(a,b){
 const meta=new Map(['method','url','status','duration','size','error'].map(k=>[k,String(a[k]??'—')])),other=new Map(['method','url','status','duration','size','error'].map(k=>[k,String(b[k]??'—')]));
 const payload=(key,leftMime,rightMime)=>{const left=body(a[key]||'',leftMime),right=body(b[key]||'',rightMime),diff=differences(left.map,right.map);return {...diff,leftFormat:left.format,rightFormat:right.format,truncated:diff.truncated||left.truncated||right.truncated,rawChanged:(a[key]||'')!==(b[key]||''),captureLimited:!!(a.bodyNote||b.bodyNote||a.requestBodyTruncated||b.requestBodyTruncated)};};
 return {left:{id:a.id,method:a.method,url:a.url,status:a.status},right:{id:b.id,method:b.method,url:b.url,status:b.status},sections:{summary:differences(meta,other),requestHeaders:differences(headers(a.requestHeaders),headers(b.requestHeaders)),responseHeaders:differences(headers(a.responseHeaders),headers(b.responseHeaders)),requestBody:payload('requestBody',contentType(a.requestHeaders),contentType(b.requestHeaders)),responseBody:payload('responseBody',a.mime||contentType(a.responseHeaders),b.mime||contentType(b.responseHeaders))}};
}
module.exports={compareRequests};
