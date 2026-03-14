const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  moveCursor: (x, y) => ipcRenderer.invoke('move-cursor', { x, y }),
  mouseClick: (button = 'left') => ipcRenderer.invoke('mouse-click', { button }),
  mouseDown: (button = 'left') => ipcRenderer.invoke('mouse-down', { button }),
  mouseUp: (button = 'left') => ipcRenderer.invoke('mouse-up', { button }),
  scroll: (dx, dy) => ipcRenderer.invoke('scroll', { dx, dy }),
  getScreenBounds: () => ipcRenderer.invoke('get-screen-bounds'),
  setFullscreen: (fullscreen) => ipcRenderer.invoke('set-fullscreen', { fullscreen }),
  vsrStartRecording: () => ipcRenderer.invoke('vsr-start-recording'),
  vsrAddFrame: (frameData) => ipcRenderer.invoke('vsr-add-frame', { frameData }),
  vsrStopRecording: () => ipcRenderer.invoke('vsr-stop-recording'),
  onToggleVSRRecording: (callback) => ipcRenderer.on('toggle-vsr-recording', callback)
});
