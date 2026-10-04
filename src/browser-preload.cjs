const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('arusBrowser',{
 state:()=>ipcRenderer.invoke('browser-state'),
 action:(action,data)=>ipcRenderer.invoke('browser-action',action,data),
 onState:fn=>ipcRenderer.on('browser-state',(_e,state)=>fn(state)),
 onAddress:fn=>ipcRenderer.on('browser-focus-address',()=>fn())
});
