const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  moveCursor: (x, y) => ipcRenderer.invoke('move-cursor', { x, y }),
  mouseClick: (button = 'left') => ipcRenderer.invoke('mouse-click', { button }),
  mouseDown: (button = 'left') => ipcRenderer.invoke('mouse-down', { button }),
  mouseUp: (button = 'left') => ipcRenderer.invoke('mouse-up', { button }),
  scroll: (dx, dy) => ipcRenderer.invoke('scroll', { dx, dy }),
  getScreenBounds: () => ipcRenderer.invoke('get-screen-bounds'),
  setFullscreen: (fullscreen) => ipcRenderer.invoke('set-fullscreen', { fullscreen }),
  altTab: (direction) => ipcRenderer.invoke('alt-tab', { direction }),
  vsrStartRecording: () => ipcRenderer.invoke('vsr-start-recording'),
  vsrAddFrame: (frameData) => ipcRenderer.invoke('vsr-add-frame', { frameData }),
  vsrStopRecording: () => ipcRenderer.invoke('vsr-stop-recording'),
  onToggleVSRRecording: (callback) => ipcRenderer.on('toggle-vsr-recording', callback),
  speechStart: (modelSize) => ipcRenderer.invoke('speech-start', { modelSize }),
  speechStop: () => ipcRenderer.invoke('speech-stop'),
  speechFeedAudio: (audioBuffer) => ipcRenderer.invoke('speech-feed-audio', { audioBuffer }),
  getSpeechSettings: () => ipcRenderer.invoke('get-speech-settings'),
  updateSpeechSettings: (settings) => ipcRenderer.invoke('update-speech-settings', settings),
  typeText: (text) => ipcRenderer.invoke('type-text', { text }),
  copySelection: () => ipcRenderer.invoke('copy-selection'),
  pasteClipboard: () => ipcRenderer.invoke('paste-clipboard'),
  getCursorPosition: () => ipcRenderer.invoke('get-cursor-position'),
  rephraseText: (text) => ipcRenderer.invoke('rephrase-text', { text }),
  onSpeechTranscript: (callback) => ipcRenderer.on('speech-transcript', (event, transcript) => callback(transcript)),
  onTextModeChanged: (callback) => ipcRenderer.on('text-mode-changed', (event, isTextMode) => callback(isTextMode)),
  
  // Control Panel <-> Overlay Communication
  sendControlCommand: (command, value) => ipcRenderer.send('control-command', { command, value }),
  requestOverlayStatus: () => ipcRenderer.send('request-overlay-status'),
  onControlCommand: (callback) => ipcRenderer.on('control-command', (event, { command, value }) => callback(command, value)),
  sendOverlayStatus: (status) => ipcRenderer.send('overlay-status-update', status),
  onOverlayStatus: (callback) => ipcRenderer.on('overlay-status-update', (event, status) => callback(status))
});
