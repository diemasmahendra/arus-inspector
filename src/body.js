/* Shared form decoding for the local inspector and redacted AI context. */
(function(root){
  'use strict';
  function contentType(headers){return String(Object.entries(headers||{}).find(([k])=>k.toLowerCase()==='content-type')?.[1]||'');}
  function isForm(mime){return /^application\/x-www-form-urlencoded(?:\s*;|\s*$)/i.test(String(mime));}
  function parseForm(body,limit=500){
    const pairs=String(body||'').split('&',limit+1),entries=[];
    for(const pair of pairs.slice(0,limit)){if(!pair)continue;const value=new URLSearchParams(pair).entries().next().value;if(value)entries.push(value);}
    return {entries,truncated:pairs.length>limit};
  }
  const api=Object.freeze({contentType,isForm,parseForm});
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.ArusBody=api;
})(globalThis);
