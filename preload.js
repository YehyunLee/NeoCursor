const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Add IPC methods here as needed
  // Example: sendMessage: (message) => ipcRenderer.send('message', message)
});
