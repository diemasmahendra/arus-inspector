const {contextBridge, ipcRenderer} = require('electron');
const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('arus', {
  certificate: invoke('certificate'), state: invoke('state'), open: invoke('open'), control: invoke('control'), clear: invoke('clear'), detail: invoke('detail'),
  copy: invoke('copy'), export: invoke('export'), replay: invoke('replay'), update: invoke('update'),
  agentState: invoke('agent-state'), agentSave: invoke('agent-save'), agentChat: invoke('agent-chat'), agentCancel: invoke('agent-cancel'), agentReset: invoke('agent-reset'), agentImport: invoke('agent-import'), agentExportFiles: invoke('agent-export-files'),
  agentUiResult: invoke('agent-ui-result'), agentPause: invoke('agent-pause'), agentResume: invoke('agent-resume'), compare: invoke('compare'),
  onEvent: callback => { const handler = (_, event) => callback(event); ipcRenderer.on('arus-event', handler); return () => ipcRenderer.removeListener('arus-event', handler); }
});
