const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('monitor', {
  snapshot: () => ipcRenderer.invoke('monitor:snapshot'),
  save: input => ipcRenderer.invoke('monitor:save', input),
  remove: id => ipcRenderer.invoke('monitor:remove', id),
  discard: id => ipcRenderer.invoke('monitor:discard', id),
  refresh: id => ipcRenderer.invoke('monitor:refresh', id),
  preview: input => ipcRenderer.invoke('monitor:preview', input),
  pick: input => ipcRenderer.invoke('monitor:pick', input),
  login: id => ipcRenderer.invoke('monitor:login', id),
  open: id => ipcRenderer.invoke('monitor:open', id),
  floating: open => ipcRenderer.invoke('monitor:floating', open),
  language: value => ipcRenderer.invoke('monitor:language', value),
  appSettings: value => ipcRenderer.invoke('monitor:appSettings', value),
  launchAtLogin: value => ipcRenderer.invoke('monitor:launchAtLogin', value),
  repository: () => ipcRenderer.invoke('monitor:repository'),
  demo: () => ipcRenderer.invoke('monitor:demo'),
  alertSave: input => ipcRenderer.invoke('monitor:alertSave', input),
  alertRemove: id => ipcRenderer.invoke('monitor:alertRemove', id),
  floatingSettings: input => ipcRenderer.invoke('monitor:floatingSettings', input),
  notificationTest: () => ipcRenderer.invoke('monitor:notificationTest'),
  onPage: callback => {
    const listener = (_event, page) => callback(page);
    ipcRenderer.on('monitor:page', listener);
    return () => ipcRenderer.removeListener('monitor:page', listener);
  },
  onUpdate: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('monitor:update', listener);
    return () => ipcRenderer.removeListener('monitor:update', listener);
  },
  onActivity: callback => {
    const listener = (_event, active) => callback(active);
    ipcRenderer.on('monitor:activity', listener);
    return () => ipcRenderer.removeListener('monitor:activity', listener);
  }
});
