const electronAPI = window.electronAPI || {};
if (!electronAPI.sendControlCommand) {
  console.error('[ControlPanel] electronAPI not available - preload may not have loaded');
}

function runControlPanel() {
  const sensitivitySlider = document.getElementById('inp-sensitivity');
  const sensitivityValue = document.getElementById('val-sensitivity');
  const speechEngineSelect = document.getElementById('sel-speech-engine');
  const btnToggleTracking = document.getElementById('btn-toggle-tracking');
  const btnRecenter = document.getElementById('btn-recenter');
  const btnToggleVideo = document.getElementById('btn-toggle-video');
  const btnToggleSpeech = document.getElementById('btn-toggle-speech');
  const btnQuit = document.getElementById('btn-quit');
  const connectionStatus = document.getElementById('connection-status');

  let isTracking = false;
  let isVideoVisible = false;
  let isSpeechActive = false;
  let sensitivitySyncedOnce = false;

  function send(cmd, val) {
    try {
      if (electronAPI.sendControlCommand) electronAPI.sendControlCommand(cmd, val);
    } catch (e) {
      console.error('[ControlPanel] send failed', cmd, e);
    }
  }
  function quit() {
    try {
      if (typeof electronAPI.quitApp === 'function') electronAPI.quitApp();
      else console.error('[ControlPanel] quitApp not available');
    } catch (e) {
      console.error('[ControlPanel] quit failed', e);
    }
  }

  function updateUI(status) {
    if (status.isTracking !== undefined && btnToggleTracking) {
      isTracking = status.isTracking;
      btnToggleTracking.textContent = isTracking ? 'Stop Tracking' : 'Start Tracking';
      btnToggleTracking.className = isTracking ? 'danger' : '';
      if (btnRecenter) btnRecenter.disabled = !isTracking;
      if (btnToggleVideo) btnToggleVideo.disabled = !isTracking;
    }
    if (connectionStatus) {
      connectionStatus.textContent = 'Connected to Overlay';
      connectionStatus.style.color = 'var(--accent)';
    }
    if (status.sensitivity !== undefined && !sensitivitySyncedOnce) {
      sensitivitySyncedOnce = true;
      if (sensitivitySlider) sensitivitySlider.value = status.sensitivity;
      if (sensitivityValue) sensitivityValue.textContent = String(status.sensitivity);
    }
    if (status.videoVisible !== undefined && btnToggleVideo) {
      isVideoVisible = status.videoVisible;
      btnToggleVideo.textContent = isVideoVisible ? 'Hide Camera Preview' : 'Show Camera Preview';
    }
    if (status.speechActive !== undefined && btnToggleSpeech) {
      isSpeechActive = status.speechActive;
      btnToggleSpeech.textContent = isSpeechActive ? 'Disable Voice Control' : 'Enable Voice Control';
    }
  }

  // Sensitivity: update number from slider on every input/change
  if (sensitivitySlider && sensitivityValue) {
    function setSensitivityDisplay(val) {
      sensitivityValue.textContent = String(val);
    }
    sensitivitySlider.oninput = function () {
      const value = parseInt(this.value, 10);
      setSensitivityDisplay(value);
      if (electronAPI.sendControlCommand) electronAPI.sendControlCommand('set-sensitivity', value);
    };
    sensitivitySlider.onchange = function () {
      setSensitivityDisplay(parseInt(this.value, 10));
    };
    setSensitivityDisplay(parseInt(sensitivitySlider.value, 10));
  }

  if (speechEngineSelect) {
    speechEngineSelect.onchange = async function () {
      await electronAPI.updateSpeechSettings({ engine: this.value });
    };
  }

  if (btnToggleTracking) {
    btnToggleTracking.onclick = function () {
      const shouldStop = this.textContent.trim().toLowerCase().startsWith('stop');
      send(shouldStop ? 'stop-tracking' : 'start-tracking');
    };
  }

  if (btnRecenter) btnRecenter.onclick = () => send('recenter');
  if (btnToggleVideo) btnToggleVideo.onclick = () => send('toggle-video');
  if (btnToggleSpeech) btnToggleSpeech.onclick = () => send('toggle-speech');
  if (btnQuit) btnQuit.onclick = quit;

  async function init() {
    try {
      if (electronAPI.getSpeechSettings) {
        const res = await electronAPI.getSpeechSettings();
        if (res && res.success && speechEngineSelect) speechEngineSelect.value = res.settings.engine;
      }
    } catch (e) {
      console.warn('[ControlPanel] getSpeechSettings failed', e);
    }
    if (electronAPI.onOverlayStatus) electronAPI.onOverlayStatus(updateUI);
    if (electronAPI.requestOverlayStatus) electronAPI.requestOverlayStatus();
  }
  init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runControlPanel);
} else {
  runControlPanel();
}
