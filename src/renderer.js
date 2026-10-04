'use strict';
const $=selector=>document.querySelector(selector);
const api=window.arus;
const {contentType,isForm,parseForm}=window.ArusBody;
let bodyMode='form';
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="icons.svg#${name}"></use></svg>`;
function buttonContent(name,label){return `${icon(name)}<span>${label}</span>`;}
function setSize(value){
  if(!['compact','comfortable','large'].includes(value)) value='comfortable';
  document.documentElement.dataset.size=value;
  document.querySelectorAll('[data-size]').forEach(b=>{const yes=b.dataset.size===value;b.classList.toggle('selected',yes);b.setAttribute('aria-checked',String(yes));});
  try{localStorage.setItem('arus-display-size',value);}catch{}
}
try{$('#browser-kind').value=localStorage.getItem('arus-browser-kind')||'embedded';}catch{}
$('#browser-kind').addEventListener('change',()=>{try{localStorage.setItem('arus-browser-kind',$('#browser-kind').value);}catch{}});
let savedSize='comfortable';try{savedSize=localStorage.getItem('arus-display-size')||savedSize;}catch{}setSize(savedSize);
$('#appearance-button').addEventListener('click',()=>$('#appearance-dialog').showModal());
$('.size-options').addEventListener('click',e=>{const b=e.target.closest('[data-size]');if(b)setSize(b.dataset.size);});
$('#sidebar-guide').addEventListener('click',()=>$('#guide-dialog').showModal());
const rows=new Map();let selected=null,detail=null,tab='response',filter='all',domain='',query='',follow=true,dirty=false,detailToken=0,toastTimer,renderTimer,updateState={status:'idle'};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const size=n=>n<1024?`${n||0} B`:n<1048576?`${(n/1024).toFixed(1)} kB`:`${(n/1048576).toFixed(1)} MB`;
const time=n=>n==null?'—':n>=1000?`${(n/1000).toFixed(2)} s`:`${Math.round(n)} ms`;
const statusClass=r=>r.error || r.status>=400?'error':r.status>=300?'redirect':r.status?'':'waiting';
const statusText=r=>r.error?'ERR':r.status || '···';
const parts=r=>{try{return new URL(r.url);}catch{return {hostname:'',pathname:r.url,search:''};}};
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);}
async function act(fn){try{return await fn();}catch(e){toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/,''));return undefined;}}
function visible(){return [...rows.values()].filter(r=>(!domain || parts(r).hostname===domain) && (filter!=='errors' || r.error || r.status>=400) && (filter!=='api' || ['Fetch','XHR','Replay'].includes(r.type) || /json/.test(r.mime || '')) && (!query || `${r.url} ${r.method} ${r.status || ''} ${r.type}`.toLowerCase().includes(query)));}
function schedule(){if(!renderTimer)renderTimer=setTimeout(()=>{renderTimer=null;render();},90);}
function render(){
  const list=visible(),counts=new Map();let totalBytes=0,errors=0;
  for(const r of rows.values()){const host=parts(r).hostname;counts.set(host,(counts.get(host)||0)+1);totalBytes+=r.size||0;if(r.error || r.status>=400)errors++;}
  $('#total-count').textContent=rows.size;$('#error-count').textContent=errors;$('#domain-count').textContent=counts.size;
  $('#visible-count').textContent=`${list.length} request`;$('#footer-stats').textContent=`${rows.size} request · ${size(totalBytes)}`;
  $('#domains').innerHTML=counts.size?[...counts].sort((a,b)=>b[1]-a[1]).map(([host,count])=>`<button class="domain-button ${host===domain?'active':''}" data-domain="${escape(host)}" title="${escape(host)}">${icon('globe')}<span>${escape(host)}</span><span class="count">${count}</span></button>`).join(''):'<p class="side-hint">Domain muncul saat<br>traffic mulai masuk.</p>';
  $('#all-domains').classList.toggle('active',!domain);
  const scroll=$('#traffic-scroll'),oldTop=scroll.scrollTop;
  // Keep the renderer bounded even during long sessions; engine/store retain at most 3,000 records.
  $('#traffic-rows').innerHTML=list.map(r=>{const u=parts(r);return `<button role="option" aria-selected="${r.id===selected}" class="traffic-row ${r.id===selected?'selected':''}" data-id="${r.id}" title="${escape(r.url)}"><span class="method ${escape(r.method)}">${escape(r.method)}</span><span class="request-cell"><span class="request-path">${escape(u.pathname+u.search)}</span><span class="request-host">${escape(u.hostname)} <span>· ${escape(r.type)}</span></span></span><span class="status ${statusClass(r)}">${statusText(r)}</span><span class="cell-meta">${time(r.duration)}</span><span class="cell-meta">${size(r.size)}</span></button>`;}).join('');
  $('#empty').hidden=rows.size>0;$('#no-results').hidden=rows.size===0 || list.length>0;
  scroll.scrollTop=follow?scroll.scrollHeight:oldTop;
  if(selected && !rows.has(selected)){selected=null;detail=null;$('#detail-content').hidden=true;$('#detail-empty').hidden=false;}
}
async function select(id){
  selected=id;const token=++detailToken;
  document.querySelectorAll('.traffic-row').forEach(el=>{const yes=el.dataset.id===id;el.classList.toggle('selected',yes);el.setAttribute('aria-selected',yes);});
  const value=await act(()=>api.detail(id));if(token!==detailToken || !value)return;detail=value;renderDetail();document.dispatchEvent(new CustomEvent('arus-request-selected',{detail:{id:detail.id,url:detail.url,method:detail.method}}));
}
function headers(title,values){return `<h3 class="headers-title">${title}</h3><table class="headers-table">${Object.entries(values||{}).map(([k,v])=>`<tr><td>${escape(k)}</td><td>${escape(v)}</td></tr>`).join('')}</table>`;}
function highlightJson(line){
  const pattern=/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g;
  let out='',last=0,match;
  while((match=pattern.exec(line))){
    out+=escape(line.slice(last,match.index));
    const cls=match[1]?(match[2]?'json-key':'json-string'):match[3]?'json-literal':'json-number';
    out+=`<span class="${cls}">${escape(match[1]||match[3]||match[4])}</span>${escape(match[2]||'')}`;
    last=pattern.lastIndex;
  }
  return out+escape(line.slice(last));
}
function code(text){
  let pretty=text,isJson=false;
  try{pretty=JSON.stringify(JSON.parse(text),null,2);isJson=true;}catch{}
  const lines=pretty.split('\n');
  // Very large bodies remain plain text to keep the UI responsive.
  if(lines.length>2500 || pretty.length>160000)return `<pre class="code-block">${escape(pretty)}</pre>`;
  return `<pre class="code-block">${lines.map((line,i)=>`<span class="code-line"><span class="line-number">${i+1}</span><span class="code-text">${isJson?highlightJson(line):escape(line)}</span></span>`).join('')}</pre>`;
}
function renderDetail(){
  if(!detail)return;
  $('#detail-content').hidden=false;$('#detail-empty').hidden=true;
  $('#detail-method').textContent=detail.method;$('#detail-method').className=`method ${detail.method}`;
  $('#detail-status').textContent=detail.error?'Koneksi gagal':detail.status?`${detail.status} ${detail.statusText||''}`:'Menunggu';$('#detail-status').className=`status ${statusClass(detail)}`;
  $('#detail-time').textContent=time(detail.duration);$('#detail-url').textContent=detail.url;
  let html='';
  if(tab==='headers')html=headers('REQUEST HEADERS',detail.requestHeaders)+headers('RESPONSE HEADERS',detail.responseHeaders);
  else if(tab==='timing')html=[['Mulai',new Date(detail.startedAt).toLocaleString('id-ID')],['Durasi total',time(detail.duration)],['Ukuran response',size(detail.size)],['Protokol',detail.protocol||'—'],['Alamat server',detail.remoteAddress||'—'],['Jenis',detail.type],['Content-Type',detail.mime||'—']].map(([k,v])=>`<div class="info-line"><span>${k}</span><strong>${escape(v)}</strong></div>`).join('');
  else {const response=tab==='response',text=response?detail.responseBody:detail.requestBody;const mime=response?detail.mime:contentType(detail.requestHeaders),form=isForm(mime);
    html=`<div class="body-toolbar"><span>${response?escape(detail.mime||'RESPONSE BODY'):'REQUEST BODY'}</span>${response?`<button id="copy-body">${buttonContent('copy','Salin body')}</button>`:''}</div>`;
    if(detail.error && response)html+=`<div class="body-note">${escape(detail.error)}</div>`;
    if(detail.bodyNote && response)html+=`<div class="body-note">${escape(detail.bodyNote)}</div>`;
    if(!response && detail.requestBodyTruncated)html+='<div class="body-note">Body request dipotong pada 1 MiB.</div>';
    if(form && text){
      html+=`<div class="body-modes" role="group" aria-label="Format body"><button data-body-mode="form" class="${bodyMode==='form'?'selected':''}">Form</button><button data-body-mode="raw" class="${bodyMode==='raw'?'selected':''}">Raw</button><span>application/x-www-form-urlencoded</span></div>`;
      const parsed=parseForm(text);
      html+=bodyMode==='raw'?`<pre class="code-block raw-body">${escape(text)}</pre>`:`<table class="headers-table form-table"><thead><tr><th>Field</th><th>Nilai</th></tr></thead><tbody>${parsed.entries.map(([k,v])=>`<tr><td>${escape(k)}</td><td>${escape(v)}</td></tr>`).join('')}</tbody></table>${parsed.truncated?'<div class="body-note">Tampilan Form dibatasi 500 field. Buka Raw untuk seluruh body yang tertangkap.</div>':''}`;
    }else html+=text?code(text):`<div class="body-note">${response && detail.status==null?'Menunggu response…':response?'Tidak ada body yang tersedia.':'Request ini tidak memiliki body.'}</div>`;
  }
  $('#detail-view').innerHTML=html;
  document.querySelectorAll('[data-body-mode]').forEach(b=>b.addEventListener('click',()=>{bodyMode=b.dataset.bodyMode;renderDetail();}));
  $('#copy-body')?.addEventListener('click',()=>copy('response'));
}
async function copy(kind){if(!selected)return;const ok=await act(()=>api.copy(selected,kind));if(ok)toast(kind==='curl'?'cURL disalin. Header login dan body dihilangkan.':'Disalin ke clipboard.');}
function applyState(state){
  dirty=state.capturing;
  $('#pause-button').innerHTML=buttonContent(dirty?'pause':'play',dirty?'Jeda capture':'Lanjutkan');
  $('#pause-button').setAttribute('aria-pressed',String(!dirty));
  $('#capture-label').textContent=dirty?'Capture aktif':'Capture dijeda';
  $('.capture-indicator .dot').classList.toggle('recording',dirty);
  $('.capture-indicator').classList.toggle('paused',!dirty);
  $('#pause-button').title=dirty?'Jeda capture (Space)':'Lanjutkan capture (Space)';
  $('#focus-browser').disabled=!state.browserOpen;
  $('#close-browser').disabled=!state.browserOpen && !['downloading','starting'].includes(state.camoufox);
  $('#browser-caption').textContent=state.camoufox==='downloading'?'Mengunduh Camoufox · pertama kali':state.camoufox==='starting'?'Menyiapkan Camoufox':state.browserKind==='camoufox'?'Camoufox':'Browser Arus';
  $('#footer-state').innerHTML=`<span class="dot ${dirty?'recording':''}"></span> ${dirty?'Mendengarkan traffic':'Capture dijeda · traffic tetap diteruskan'}`;
  if(state.engine){$('#engine-status').textContent=state.engine==='ready'?'Proxy siap':state.engine==='error'?'Mesin berhenti':'Menyiapkan capture';$('#engine-dot').className=`dot ${state.engine==='ready'?'recording':''}`;$('#open-button').disabled=state.engine!=='ready';}
  if(state.port){$('#proxy-address').textContent=`127.0.0.1:${state.port}`;$('#guide-proxy').textContent=`127.0.0.1:${state.port}`;}
  if(state.update){updateState=state.update;const s=updateState;$('#update-button').innerHTML=icon(s.status==='checking' || s.status==='downloading'?'loader-circle':s.status==='ready'?'check':'refresh-cw')+'<span>'+(s.status==='available'?`Update v${s.version}`:s.status==='downloading'?`Mengunduh ${s.percent}%`:s.status==='ready'?'Restart & update':s.status==='checking'?'Memeriksa…':s.status==='current'?'Versi terbaru':'Cek update')+'</span>';$('#update-button').disabled=['checking','downloading'].includes(s.status);}
}
$('#open-form').addEventListener('submit',async e=>{e.preventDefault();const url=$('#target-url').value.trim();if(!url){$('#target-url').focus();return;}$('#open-button').disabled=true;$('#open-button').innerHTML=buttonContent('loader-circle','Membuka…');const ok=await act(()=>api.open(url,$('#browser-kind').value));$('#open-button').disabled=false;$('#open-button').innerHTML=buttonContent('external-link','Buka browser');if(ok)toast('Browser terhubung. Gunakan website seperti biasa untuk melihat traffic.');});
$('#empty-open').addEventListener('click',()=>$('#target-url').focus());
$('#focus-browser').addEventListener('click',()=>act(()=>api.control('focus')));
$('#close-browser').addEventListener('click',()=>act(()=>api.control('close')));
$('#pause-button').addEventListener('click',()=>act(()=>api.control(dirty?'pause':'resume')));
$('#clear-button').addEventListener('click',()=>act(()=>api.clear()));
$('#search').addEventListener('input',e=>{query=e.target.value.trim().toLowerCase();schedule();});
$('.filter-group').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(el=>el.classList.toggle('selected',el===b));render();});
$('#domains').addEventListener('click',e=>{const b=e.target.closest('[data-domain]');if(b){domain=b.dataset.domain;render();}});
$('#all-domains').addEventListener('click',()=>{domain='';render();});
$('#reset-filters').addEventListener('click',()=>{query='';domain='';filter='all';$('#search').value='';document.querySelectorAll('[data-filter]').forEach(el=>el.classList.toggle('selected',el.dataset.filter==='all'));render();});
$('#traffic-rows').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b)select(b.dataset.id);});
$('#follow-button').addEventListener('click',()=>{follow=!follow;$('#follow-button').setAttribute('aria-pressed',follow);$('#follow-button').innerHTML=buttonContent('arrow-down-to-line',follow?'Live':'Ikuti');render();});
$('#traffic-scroll').addEventListener('wheel',e=>{if(e.deltaY<0){follow=false;$('#follow-button').setAttribute('aria-pressed','false');$('#follow-button').innerHTML=buttonContent('arrow-down-to-line','Ikuti');}},{passive:true});
$('.detail-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(!b)return;tab=b.dataset.tab;document.querySelectorAll('[data-tab]').forEach(el=>{el.classList.toggle('selected',el===b);el.setAttribute('aria-selected',el===b);});renderDetail();});
$('#copy-url').addEventListener('click',()=>copy('url'));$('#curl-button').addEventListener('click',()=>copy('curl'));$('#more-button').addEventListener('click',()=>copy('curl-full'));
$('#guide-button').addEventListener('click',()=>$('#guide-dialog').showModal());$('#certificate-button').addEventListener('click',async()=>{if(await act(()=>api.certificate()))toast('CA diexport. Import hanya ke browser atau perangkat yang kamu gunakan untuk capture.');});
$('#export-button').addEventListener('click',()=>{$('#export-sensitive').checked=false;$('#export-dialog').showModal();});
$('#save-export').addEventListener('click',async()=>{const ok=await act(()=>api.export($('#export-sensitive').checked));if(ok){$('#export-dialog').close();toast('Sesi berhasil diexport.');}});
$('#replay-button').addEventListener('click',()=>{if(!detail)return;$('#replay-method').value=detail.method;$('#replay-url').value=detail.url;const h=Object.fromEntries(Object.entries(detail.requestHeaders).filter(([k])=>!/^(:|sec-|host$|content-length$|connection$|proxy-connection$|accept-encoding$|transfer-encoding$|upgrade$|te$|trailer$|keep-alive$)/i.test(k)));$('#replay-headers').value=JSON.stringify(h,null,2);$('#replay-body').value=detail.requestBody||'';$('#replay-dialog').showModal();});
$('#replay-form').addEventListener('submit',async e=>{e.preventDefault();const b=$('#send-replay');b.disabled=true;b.innerHTML=buttonContent('loader-circle','Mengirim…');const id=await act(()=>api.replay({url:$('#replay-url').value,method:$('#replay-method').value,headers:$('#replay-headers').value,body:$('#replay-body').value}));b.disabled=false;b.innerHTML=buttonContent('send','Kirim request');if(id){$('#replay-dialog').close();filter='all';domain='';query='';$('#search').value='';document.querySelectorAll('[data-filter]').forEach(el=>el.classList.toggle('selected',el.dataset.filter==='all'));select(id);toast('Request dikirim. Hasilnya ada di daftar traffic.');}});
$('#update-button').addEventListener('click',async()=>{const s=updateState.status;if(s==='development'){toast('Versi pengembangan. Update tersedia setelah memasang installer dari GitHub Releases.');return;}await act(()=>api.update(s==='available'?'download':s==='ready'?'install':'check'));});
document.querySelectorAll('.dialog-close').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom)d.close();}));
document.addEventListener('keydown',e=>{
  if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='k'){e.preventDefault();$('#search').focus();return;}
  if(e.target.closest('.agent-dock'))return;
  if(e.target.matches('input,textarea,select') || document.querySelector('dialog[open]'))return;
  if(e.code==='Space'){e.preventDefault();$('#pause-button').click();}
  if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();follow=false;const list=visible();if(!list.length)return;const i=list.findIndex(r=>r.id===selected), next=list[Math.max(0,Math.min(list.length-1,i+(e.key==='ArrowDown'?1:-1)))];select(next.id);document.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({block:'nearest'});}
});
const handle=$('#resize-handle');function resize(x){const r=$('#workbench').getBoundingClientRect();const pct=Math.max(30,Math.min(60,(r.right-x)/r.width*100));document.documentElement.style.setProperty('--detail',`${pct}%`);}
handle.addEventListener('pointerdown',e=>{handle.setPointerCapture(e.pointerId);handle.onpointermove=ev=>resize(ev.clientX);handle.onpointerup=()=>handle.onpointermove=null;});handle.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;const r=handle.getBoundingClientRect();resize(r.left+(e.key==='ArrowLeft'?-20:20));});
if(api){api.onEvent(async event=>{
  if(event.kind==='agent-ui'){
    try {
    const a=event.args;
    if(event.name==='filter_traffic'){query=(a.query||'').toLowerCase();domain=a.domain||'';filter=a.filter||'all';$('#search').value=query;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('selected',b.dataset.filter===filter));render();}
    else if(event.name==='select_request'){if(a.tab){tab=a.tab;document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('selected',b.dataset.tab===tab);b.setAttribute('aria-selected',b.dataset.tab===tab);});}await select(a.id);if(detail?.id!==a.id)throw Error('Request belum terbuka.');}
    else if(event.name==='set_display')setSize(a.size);
    else if(event.name==='prepare_replay'){$('#replay-method').value=a.method;$('#replay-url').value=a.url;$('#replay-headers').value=a.headers;$('#replay-body').value=a.body;$('#replay-dialog').showModal();}
    await api.agentUiResult(event.id,{ok:true});
    }catch{await api.agentUiResult(event.id,{ok:false});}
  }
  else if(event.kind==='batch'){let refresh=false;for(const item of event.data){if(item.kind==='upsert'){rows.set(item.data.id,item.data);if(item.data.id===selected)refresh=true;}else if(item.kind==='remove')rows.delete(item.data);}schedule();if(refresh)select(selected);}
  else if(event.kind==='clear'){document.dispatchEvent(new Event('arus-traffic-clear'));rows.clear();selected=null;detail=null;detailToken++;$('#detail-content').hidden=true;$('#detail-empty').hidden=false;render();}
  else if(event.kind==='status')applyState(event.data);
  else if(event.kind==='notice')toast(event.data);
});act(async()=>{const state=await api.state();state.rows.forEach(r=>rows.set(r.id,r));$('#version').textContent=`v${state.version}`;applyState(state);render();});}
else{render();$('#open-button').disabled=true;toast('Buka Arus lewat npm start untuk mengaktifkan capture.');}
