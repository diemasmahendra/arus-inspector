'use strict';
const {randomUUID,createHash}=require('node:crypto');
function fingerprint(name,args){return name+':'+JSON.stringify(args,Object.keys(args).sort());}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>!['ref','duration','timestamp','startedAt'].includes(k)).map(k=>[k,canonical(value[k])]));return value;}
class Task {
 constructor(goal){this.id=randomUUID();this.goal=goal;this.status='running';this.reason='';this.steps=[];this.actions=[];this.observations=[];this.failures=[];this.mutations=new Map();this.count=0;}
 snapshot(canResume,busy){return {id:this.id,goal:this.goal.slice(0,2000),status:this.status,reason:this.reason,steps:this.steps.map(s=>({...s})),actions:this.actions.slice(-6).map(a=>({...a})),count:this.count,canResume,busy};}
 plan(titles){if(this.steps.some(s=>s.status==='done'))throw Error('Progres sudah berjalan. Gunakan update_task untuk rencana yang ada.');this.steps=titles.map((title,i)=>({id:String(i+1),title,status:'pending',note:''}));return {steps:this.steps};}
 update({stepId,status,note=''}){const step=this.steps.find(s=>s.id===stepId);if(!step)throw Error('Langkah tidak ditemukan.');if(step.status==='done'&&status!=='done')throw Error('Langkah selesai tidak boleh diulang dalam tugas yang sama.');Object.assign(step,{status,note:note.slice(0,500)});return {step};}
 start(name){const action={id:String(++this.count),name,status:'running',note:''};this.actions.push(action);if(this.actions.length>100)this.actions.shift();return action;}
 detect(name,args,result){
   const error=result?.error||(result?.blocked?'Tindakan duplikat diblokir':'');if(error){const key=name+':'+String(error);this.failures.push(key);if(this.failures.length>6)this.failures.shift();if(this.failures.filter(k=>k===key).length>=3)return 'Alat mengembalikan error yang sama tiga kali. Periksa halaman atau ubah instruksi sebelum melanjutkan.';}
   if(['browser_read','browser_tabs','list_traffic','inspect_request'].includes(name)&&!error){const key=name+':'+createHash('sha256').update(JSON.stringify(canonical(result))).digest('hex');this.observations.push(key);if(this.observations.length>10)this.observations.shift();if(this.observations.filter(k=>k===key).length>=4)return 'Agent membaca kondisi yang sama berulang kali tanpa perubahan yang teramati. Periksa halaman sebelum melanjutkan.';}
   return '';
 }
}
const mutating=new Set(['open_browser','browser_click','browser_fill','browser_select','browser_press','replay_request','clear_traffic','remember']);
module.exports={Task,fingerprint,mutating};
