let isTracking = false;
let isCalibrated = false;
let smoothingFactor = 0.3;
let lastX = 0;
let lastY = 0;

const statusElements = {
  eye: null,
  speech: null,
  calibration: null
};

const buttons = {
  start: null,
  stop: null,
  calibrate: null
};

function updateStatus(element, text, color) {
  if (element) {
    element.textContent = text;
    element.style.color = color;
  }
}

function smoothCoordinates(newX, newY) {
  lastX = lastX * (1 - smoothingFactor) + newX * smoothingFactor;
  lastY = lastY * (1 - smoothingFactor) + newY * smoothingFactor;
  return { x: Math.round(lastX), y: Math.round(lastY) };
}

function initializeWebGazer() {
  if (typeof webgazer === 'undefined') {
    console.error('WebGazer not loaded');
    updateStatus(statusElements.eye, 'Error: WebGazer not loaded', '#e94560');
    return;
  }

  console.log('WebGazer loaded successfully');
  
  webgazer.setGazeListener(async function(data, timestamp) {
    if (data == null || !isTracking) {
      return;
    }
    
    const smoothed = smoothCoordinates(data.x, data.y);
    
    // Convert window-relative coordinates to screen coordinates
    try {
      const result = await window.electronAPI.getWindowBounds();
      if (result.success) {
        const screenX = result.bounds.x + smoothed.x;
        const screenY = result.bounds.y + smoothed.y;
        
        await window.electronAPI.moveCursor(screenX, screenY);
        updateStatus(statusElements.eye, `Desktop (${screenX}, ${screenY})`, '#4ecca3');
      }
    } catch (err) {
      console.error('Error moving cursor:', err);
    }
  });

  webgazer.showVideoPreview(true)
    .showPredictionPoints(true)
    .applyKalmanFilter(true);

  updateStatus(statusElements.eye, 'Ready', '#a0a0a0');
}

async function startTracking() {
  if (typeof webgazer === 'undefined') {
    updateStatus(statusElements.eye, 'WebGazer not loaded', '#e94560');
    return;
  }

  try {
    updateStatus(statusElements.eye, 'Starting...', '#f39c12');
    
    await webgazer.begin();
    isTracking = true;
    
    updateStatus(statusElements.eye, 'Tracking Started', '#4ecca3');
    updateStatus(statusElements.calibration, 'Click around to calibrate', '#f39c12');
    
    if (buttons.start) buttons.start.disabled = true;
    if (buttons.stop) buttons.stop.disabled = false;
    if (buttons.calibrate) buttons.calibrate.disabled = false;
    
  } catch (error) {
    console.error('Error starting WebGazer:', error);
    updateStatus(statusElements.eye, 'Error: ' + error.message, '#e94560');
    isTracking = false;
  }
}

function stopTracking() {
  if (typeof webgazer === 'undefined') return;
  
  webgazer.pause();
  isTracking = false;
  isCalibrated = false;
  
  updateStatus(statusElements.eye, 'Stopped', '#a0a0a0');
  updateStatus(statusElements.calibration, 'Not Calibrated', '#a0a0a0');
  
  if (buttons.start) buttons.start.disabled = false;
  if (buttons.stop) buttons.stop.disabled = true;
  if (buttons.calibrate) buttons.calibrate.disabled = true;
}

function startCalibration() {
  if (!isTracking) {
    alert('Please start eye tracking first');
    return;
  }
  
  updateStatus(statusElements.calibration, 'Calibrating...', '#f39c12');
  
  setTimeout(() => {
    isCalibrated = true;
    updateStatus(statusElements.calibration, 'Calibrated', '#4ecca3');
  }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
  statusElements.eye = document.getElementById('eye-status');
  statusElements.speech = document.getElementById('speech-status');
  statusElements.calibration = document.getElementById('calibration-status');
  
  buttons.start = document.getElementById('start-tracking');
  buttons.stop = document.getElementById('stop-tracking');
  buttons.calibrate = document.getElementById('calibrate');
  
  updateStatus(statusElements.eye, 'Ready', '#a0a0a0');
  updateStatus(statusElements.speech, 'Coming Soon', '#a0a0a0');
  updateStatus(statusElements.calibration, 'Not Calibrated', '#a0a0a0');
  
  if (buttons.start) {
    buttons.start.addEventListener('click', startTracking);
  }
  
  if (buttons.stop) {
    buttons.stop.addEventListener('click', stopTracking);
    buttons.stop.disabled = true;
  }
  
  if (buttons.calibrate) {
    buttons.calibrate.addEventListener('click', startCalibration);
    buttons.calibrate.disabled = true;
  }
  
  setTimeout(() => {
    initializeWebGazer();
  }, 500);
});
