const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  moveCursor: (x, y) => ipcRenderer.invoke('move-cursor', { x, y }),
  mouseClick: (button = 'left') => ipcRenderer.invoke('mouse-click', { button }),
  getScreenBounds: () => ipcRenderer.invoke('get-screen-bounds'),
  setFullscreen: (fullscreen) => ipcRenderer.invoke('set-fullscreen', { fullscreen })
});
