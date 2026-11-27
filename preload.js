'use strict';
// Bridge between the page and the main process. The page sees window.smithDesktop only in the
// desktop application; in a browser the object is absent and the update features stay hidden.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('smithDesktop', {
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (callback) => {
    ipcRenderer.on('update:state', (_event, state) => callback(state));
  },
});
