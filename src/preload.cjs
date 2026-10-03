const {contextBridge, ipcRenderer} = require('electron');
const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('arus', {
  certificate: invoke('certificate'), state: invoke('state'), open: invoke('open'), control: invoke('control'), clear: invoke('clear'), detail: invoke('detail'),
  copy: invoke('copy'), export: invoke('export'), replay: invoke('replay'), update: invoke('update'),
  onEvent: callback => { const handler = (_, event) => callback(event); ipcRenderer.on('arus-event', handler); return () => ipcRenderer.removeListener('arus-event', handler); }
});
