const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  moveCursor: (x, y) => ipcRenderer.invoke('move-cursor', { x, y }),
  mouseClick: (button = 'left') => ipcRenderer.invoke('mouse-click', { button }),
  getScreenBounds: () => ipcRenderer.invoke('get-screen-bounds'),
  setFullscreen: (fullscreen) => ipcRenderer.invoke('set-fullscreen', { fullscreen }),
  vsrStartRecording: () => ipcRenderer.invoke('vsr-start-recording'),
  vsrAddFrame: (frameData) => ipcRenderer.invoke('vsr-add-frame', { frameData }),
  vsrStopRecording: () => ipcRenderer.invoke('vsr-stop-recording'),
  onToggleVSRRecording: (callback) => ipcRenderer.on('toggle-vsr-recording', callback),
  magnifierShow: (x, y) => ipcRenderer.invoke('magnifier-show', { x, y }),
  magnifierHide: () => ipcRenderer.invoke('magnifier-hide'),
  magnifierMove: (x, y) => ipcRenderer.invoke('magnifier-move', { x, y })
});
