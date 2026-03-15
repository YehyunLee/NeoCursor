const { electronAPI } = window;

// DOM Elements
const sensitivitySlider = document.getElementById('inp-sensitivity');
const sensitivityValue = document.getElementById('val-sensitivity');
const speechEngineSelect = document.getElementById('sel-speech-engine');
const btnToggleTracking = document.getElementById('btn-toggle-tracking');
const btnRecenter = document.getElementById('btn-recenter');
const btnToggleVideo = document.getElementById('btn-toggle-video');
const btnToggleSpeech = document.getElementById('btn-toggle-speech');
const connectionStatus = document.getElementById('connection-status');

// State
let isTracking = false;
let isVideoVisible = false;
let isSpeechActive = false;

// Initialize
async function init() {
  // Get initial settings
  const speechSettings = await electronAPI.getSpeechSettings();
  if (speechSettings.success) {
    speechEngineSelect.value = speechSettings.settings.engine;
  }

  // Listen for status updates from the overlay
  electronAPI.onOverlayStatus((status) => {
    updateUI(status);
  });

  // Request current status
  electronAPI.requestOverlayStatus();
}

function updateUI(status) {
  if (status.isTracking !== undefined) {
    isTracking = status.isTracking;
    btnToggleTracking.textContent = isTracking ? 'Stop Tracking' : 'Start Tracking';
    btnToggleTracking.className = isTracking ? 'danger' : '';
    
    btnRecenter.disabled = !isTracking;
    btnToggleVideo.disabled = !isTracking;
    
    connectionStatus.textContent = 'Connected to Overlay';
    connectionStatus.style.color = 'var(--accent)';
  }

  if (status.sensitivity !== undefined) {
    sensitivitySlider.value = status.sensitivity;
    sensitivityValue.textContent = status.sensitivity;
  }
  
  if (status.videoVisible !== undefined) {
    isVideoVisible = status.videoVisible;
    btnToggleVideo.textContent = isVideoVisible ? 'Hide Camera Preview' : 'Show Camera Preview';
  }

  if (status.speechActive !== undefined) {
    isSpeechActive = status.speechActive;
    btnToggleSpeech.textContent = isSpeechActive ? 'Disable Voice Control' : 'Enable Voice Control';
    btnToggleSpeech.className = isSpeechActive ? 'secondary' : 'secondary'; // Keep secondary style but maybe toggle active state visually if needed
  }
}

// Event Listeners
sensitivitySlider.addEventListener('input', (e) => {
  const value = e.target.value;
  sensitivityValue.textContent = value;
  electronAPI.sendControlCommand('set-sensitivity', value);
});

speechEngineSelect.addEventListener('change', async (e) => {
  const engine = e.target.value;
  await electronAPI.updateSpeechSettings({ engine });
});

btnToggleTracking.addEventListener('click', () => {
  electronAPI.sendControlCommand('toggle-tracking');
});

btnRecenter.addEventListener('click', () => {
  electronAPI.sendControlCommand('recenter');
});

btnToggleVideo.addEventListener('click', () => {
  electronAPI.sendControlCommand('toggle-video');
});

btnToggleSpeech.addEventListener('click', () => {
  electronAPI.sendControlCommand('toggle-speech');
});

// Start
init();
