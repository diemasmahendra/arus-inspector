(()=>{
'use strict';
const $=s=>document.querySelector(s),api=window.arus;
let busy=false,draft={},file='IDENTITY.md',configured=false;
const toolLabels={browser_tabs:'Daftar tab browser',browser_tab:'Pengelolaan tab',browser_read:'Pembacaan halaman',browser_click:'Klik elemen',browser_fill:'Pengisian kolom',browser_select:'Pilihan dropdown',browser_press:'Tombol keyboard',browser_scroll:'Scroll halaman',browser_wait:'Menunggu halaman',list_traffic:'Pencarian traffic',inspect_request:'Analisis request',filter_traffic:'Filter traffic',select_request:'Pilihan request',control_capture:'Kontrol capture',open_browser:'Browser Arus',prepare_replay:'Persiapan request',replay_request:'Pengiriman request',copy_curl:'Salinan cURL',export_har:'Export HAR',clear_traffic:'Pembersihan sesi',check_update:'Pemeriksaan update',set_display:'Ukuran tampilan',remember:'Catatan memori'};
function replyContent(container,text){const blocks=text.split(/(```[\w-]*\n[\s\S]*?```)/g);for(const part of blocks){if(part.startsWith('```') && part.endsWith('```')){const pre=document.createElement('pre');pre.className='agent-code';pre.textContent=part.slice(part.indexOf('\n')+1,-3);container.append(pre);}else{const span=document.createElement('span');span.textContent=part;container.append(span);}}}
const descriptions={'IDENTITY.md':'Nama, peran, dan identitas agent.','SOUL.md':'Kepribadian dan gaya komunikasi.','AGENTS.md':'Tujuan, aturan, dan alur kerja.','TOOLS.md':'Panduan memakai alat Arus; tidak menambah izin baru.','MEMORY.md':'Catatan pribadi yang dipakai kembali antar percakapan.'};
let expanded=true,preferredWidth=400,view='chat',settingsLoaded=false;
try{const saved=JSON.parse(localStorage.getItem('arus-agent-layout')||'null');if(saved){expanded=saved.expanded!==false;if(Number.isFinite(saved.width))preferredWidth=Math.max(340,Math.min(620,saved.width));}}catch{}
function persistLayout(){try{localStorage.setItem('arus-agent-layout',JSON.stringify({expanded,width:preferredWidth}));}catch{}}
function workspaceView(name){const main=$('main');main.dataset.view=name;document.querySelectorAll('[data-workspace-view]').forEach(b=>{const yes=b.dataset.workspaceView===name;b.classList.toggle('selected',yes);b.setAttribute('aria-selected',yes);});}
function sizeDock(){const max=Math.max(340,Math.min(620,innerWidth-$('.sidebar').getBoundingClientRect().width-360));const width=Math.min(preferredWidth,max);$('#agent-dock').style.width=expanded?`${width}px`:'48px';$('#agent-resize').setAttribute('aria-valuenow',Math.round(width));$('#agent-resize').setAttribute('aria-valuemin','340');$('#agent-resize').setAttribute('aria-valuemax',Math.round(max));}
function toggle(open,focus=true){expanded=open;$('#agent-panel').hidden=!open;$('#agent-rail').hidden=open;$('#agent-resize').hidden=!open;$('#agent-toggle').setAttribute('aria-expanded',open);sizeDock();persistLayout();if(open && focus && view==='chat')$('#agent-input').focus();if(!open && $('#agent-panel').contains(document.activeElement))$('#agent-expand').focus();}
function agentView(name){view=name;$('#agent-chat-view').hidden=name!=='chat';$('#agent-settings').hidden=name!=='settings';document.querySelectorAll('[data-agent-view]').forEach(b=>{const yes=b.dataset.agentView===name;b.classList.toggle('selected',yes);b.setAttribute('aria-selected',yes);});}
$('#workspace-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-workspace-view]');if(b)workspaceView(b.dataset.workspaceView);});
new ResizeObserver(()=>{$('main').dataset.narrow=$('main').getBoundingClientRect().width<680;}).observe($('main'));
document.addEventListener('arus-request-selected',()=>{if($('main').dataset.narrow==='true')workspaceView('detail');});
window.addEventListener('resize',sizeDock);
const resize=$('#agent-resize');
resize.addEventListener('pointerdown',e=>{resize.setPointerCapture(e.pointerId);resize.onpointermove=ev=>{preferredWidth=Math.max(340,Math.min(620,$('.app-body').getBoundingClientRect().right-ev.clientX));sizeDock();};});
function endResize(){resize.onpointermove=null;persistLayout();}resize.addEventListener('pointerup',endResize);resize.addEventListener('lostpointercapture',endResize);
resize.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();preferredWidth=e.key==='Home'?340:e.key==='End'?620:Math.max(340,Math.min(620,preferredWidth+(e.key==='ArrowLeft'?20:-20)));sizeDock();persistLayout();});
$('#agent-expand').addEventListener('click',()=>toggle(true));
$('.agent-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-agent-view]');if(!b)return;if(b.dataset.agentView==='settings'){if(settingsLoaded)agentView('settings');else settings().catch(err=>message('notice',err.message));}else agentView('chat');});
document.querySelectorAll('[data-agent-back]').forEach(b=>b.addEventListener('click',()=>agentView('chat')));
workspaceView('traffic');toggle(expanded,false);
function message(role,text){$('#agent-welcome')?.remove();const box=document.createElement('div');box.className='agent-message '+role;const label=document.createElement('strong');label.textContent=role==='user'?'Kamu':role==='assistant'?'Arus Agent':'Informasi';const content=document.createElement('div');if(role==='assistant')replyContent(content,text);else content.textContent=text;box.append(label,content);$('#agent-messages').append(box);$('#agent-messages').scrollTop=$('#agent-messages').scrollHeight;}
function progress(data){if(data.phase==='result' && data.label==='remember')settingsLoaded=false;$('#agent-status').textContent=toolLabels[data.label]||data.label;if(data.phase==='result'){const item=document.createElement('details');item.className='agent-tool';const label=document.createElement('summary');label.textContent=toolLabels[data.label]||data.label;const body=document.createElement('pre');try{body.textContent=JSON.stringify(JSON.parse(data.result),null,2);}catch{body.textContent=data.result;}item.append(label,body);$('#agent-messages').append(item);$('#agent-messages').scrollTop=$('#agent-messages').scrollHeight;}}
function setBusy(value){busy=value;$('#agent-rail-dot').classList.toggle('recording',value);$('#agent-dock').dataset.busy=value;$('#agent-expand').title=value?'Agent sedang bekerja · buka panel':'Buka AI Agent';document.querySelector('[data-agent-view="settings"]').disabled=value;$('#agent-send').disabled=value;$('#agent-stop').hidden=!value;$('#agent-settings-open').disabled=value;$('#agent-new').disabled=value;$('#agent-use-selection').disabled=value;}
async function refresh(){const state=await api.agentState();configured=!!state.baseUrl && !!state.model;$('#agent-connection').textContent=configured?state.model:'Atur koneksi AI untuk mulai';$('#agent-dot').className='dot '+(configured?'recording':'');return state;}
function pane(name){$('#agent-connection-pane').hidden=name!=='connection';$('#agent-profiles-pane').hidden=name!=='profiles';document.querySelectorAll('[data-settings-pane]').forEach(b=>{const yes=b.dataset.settingsPane===name;b.classList.toggle('selected',yes);b.setAttribute('aria-selected',yes);});}
$('.settings-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-settings-pane]');if(b)pane(b.dataset.settingsPane);});
$('#agent-base-url').addEventListener('invalid',()=>pane('connection'));$('#agent-model').addEventListener('invalid',()=>pane('connection'));
function storeDraft(){draft[file]=$('#agent-file-editor').value;}
function showFile(){file=$('#agent-file').value;$('#agent-file-editor').value=draft[file]||'';$('#agent-file-description').textContent=descriptions[file];}
async function settings(){if(busy)return;const s=await refresh();draft={...s.files};$('#agent-base-url').value=s.baseUrl;$('#agent-model').value=s.model;$('#agent-key').value='';$('#agent-remove-key').checked=false;$('#agent-key-state').textContent=s.hasKey?'Tersimpan · kosongkan kolom untuk mempertahankan':'';$('#agent-storage-note').textContent=s.encrypted?'API key disimpan dengan enkripsi sistem operasi. Percakapan hanya berada di memori sesi.':'Penyimpanan terenkripsi tidak tersedia. API key hanya dipakai selama sesi ini dan tidak ditulis ke disk.';showFile();pane('connection');$('#agent-settings-error').hidden=true;settingsLoaded=true;toggle(true,false);agentView('settings');}
function settingsError(e){$('#agent-settings-error').textContent=e.message;$('#agent-settings-error').hidden=false;}
$('#agent-toggle').addEventListener('click',()=>toggle($('#agent-panel').hidden));$('#agent-close').addEventListener('click',()=>toggle(false));
$('#agent-settings-open').addEventListener('click',()=>settings().catch(e=>message('notice',e.message)));
$('#agent-file').addEventListener('change',()=>{storeDraft();showFile();});
$('#agent-import').addEventListener('click',async()=>{try{storeDraft();const files=await api.agentImport();if(files){Object.assign(draft,files);showFile();}}catch(e){settingsError(e);}});
$('#agent-export').addEventListener('click',async()=>{try{if(await api.agentExportFiles())$('#agent-storage-note').textContent='Lima file tersimpan telah diexport ke folder pilihanmu.';}catch(e){settingsError(e);}});
$('#agent-settings-form').addEventListener('submit',async e=>{
 e.preventDefault();$('#agent-settings-save').disabled=true;
 try{storeDraft();const data={baseUrl:$('#agent-base-url').value.trim(),model:$('#agent-model').value.trim(),files:draft};if($('#agent-remove-key').checked)data.key='';else if($('#agent-key').value.trim())data.key=$('#agent-key').value.trim();await api.agentSave(data);$('#agent-key').value='';await refresh();agentView('chat');settingsLoaded=false;$('#agent-messages').replaceChildren();message('notice','Pengaturan disimpan. Percakapan baru memakai lima file arahan kamu.');}
 catch(e){settingsError(e);}finally{$('#agent-settings-save').disabled=false;}
});
$('#agent-new').addEventListener('click',async()=>{try{await api.agentReset();$('#agent-messages').replaceChildren();message('notice','Percakapan baru. File arahan dan memori tetap tersedia.');}catch(e){message('notice',e.message);}});
$('#agent-stop').addEventListener('click',()=>{api.agentCancel().catch(e=>message('notice',e.message));$('#agent-status').textContent='Menghentikan…';});
$('#agent-form').addEventListener('submit',async e=>{
 e.preventDefault();if(busy)return;const text=$('#agent-input').value.trim();if(!text)return;
 if(!configured){await settings().catch(e=>message('notice',e.message));return;}
 const selectedId=$('#agent-use-selection').checked?$('.traffic-row.selected')?.dataset.id:null;
 message('user',text);$('#agent-input').value='';setBusy(true);
 try{const reply=await api.agentChat({text,selectedId:selectedId||null});message('assistant',reply.text);}catch(e){message('notice',e.message);}finally{setBusy(false);$('#agent-status').textContent='Siap';if(expanded && view==='chat')$('#agent-input').focus();}
});
$('#agent-input').addEventListener('keydown',e=>{if(e.key==='Enter' && !e.shiftKey && !e.isComposing){e.preventDefault();$('#agent-form').requestSubmit();}e.stopPropagation();});
$('.agent-prompts').addEventListener('click',e=>{const b=e.target.closest('[data-prompt]');if(b){$('#agent-input').value=b.dataset.prompt;$('#agent-input').focus();}});
if(api){api.onEvent(e=>{if(e.kind==='agent-progress')progress(e.data);});refresh().catch(e=>message('notice',e.message));}else{$('#agent-toggle').disabled=true;}
})();
