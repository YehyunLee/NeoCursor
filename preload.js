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
  vsrExecuteCommand: (text) => ipcRenderer.invoke('vsr-execute-command', { text }),
  onToggleVSRRecording: (callback) => ipcRenderer.on('toggle-vsr-recording', callback),
  speechStart: (modelSize) => ipcRenderer.invoke('speech-start', { modelSize }),
  speechStop: () => ipcRenderer.invoke('speech-stop'),
  speechFeedAudio: (audioBuffer) => ipcRenderer.invoke('speech-feed-audio', { audioBuffer }),
  getSpeechSettings: () => ipcRenderer.invoke('get-speech-settings'),
  updateSpeechSettings: (settings) => ipcRenderer.invoke('update-speech-settings', settings),
  typeText: (text) => ipcRenderer.invoke('type-text', { text })
});
