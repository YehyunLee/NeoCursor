const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  moveCursor: (x, y) => ipcRenderer.invoke('move-cursor', { x, y }),
  mouseClick: (button = 'left') => ipcRenderer.invoke('mouse-click', { button }),
  getWindowBounds: () => ipcRenderer.invoke('get-window-bounds'),
  setFullscreen: (fullscreen) => ipcRenderer.invoke('set-fullscreen', { fullscreen })
});
