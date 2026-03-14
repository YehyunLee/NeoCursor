let isTracking = false;
let isCalibrated = false;
let smoothingFactor = 0.3;
let lastX = 0;
let lastY = 0;

const statusElements = {
  eye: document.getElementById('eye-status'),
  speech: document.getElementById('speech-status'),
  calibration: document.getElementById('calibration-status')
};

const buttons = {
  start: document.getElementById('start-tracking'),
  stop: document.getElementById('stop-tracking'),
  calibrate: document.getElementById('calibrate')
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

function initializeGazeTracking() {
  if (typeof GazeCloudAPI === 'undefined') {
    console.error('GazeCloudAPI not loaded');
    updateStatus(statusElements.eye, 'Error: API not loaded', '#e94560');
    return;
  }

  console.log('GazeCloudAPI loaded successfully');

  GazeCloudAPI.OnCalibrationComplete = function() {
    console.log('Calibration complete');
    isCalibrated = true;
    updateStatus(statusElements.calibration, 'Calibrated', '#4ecca3');
    updateStatus(statusElements.eye, 'Tracking Active', '#4ecca3');
  };

  GazeCloudAPI.OnCamDenied = function() {
    console.log('Camera access denied');
    updateStatus(statusElements.eye, 'Camera Denied', '#e94560');
    isTracking = false;
  };

  GazeCloudAPI.OnError = function(msg) {
    console.error('GazeCloud Error:', msg);
    updateStatus(statusElements.eye, 'Error: ' + msg, '#e94560');
    
    if (msg.includes('GazeFlow server')) {
      console.error('GazeFlow server connection failed - this is a known issue with GazeCloud API');
      updateStatus(statusElements.eye, 'Server Connection Failed', '#e94560');
    }
  };

  GazeCloudAPI.OnResult = async function(gazeData) {
    if (gazeData.state === 0 && isTracking && isCalibrated) {
      const windowX = gazeData.docX;
      const windowY = gazeData.docY;
      
      const smoothed = smoothCoordinates(windowX, windowY);
      
      // Convert window-relative coordinates to screen coordinates for desktop-wide control
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
    } else if (gazeData.state === -1) {
      updateStatus(statusElements.eye, 'Face Lost', '#f39c12');
    } else if (gazeData.state === 1) {
      updateStatus(statusElements.eye, 'Needs Calibration', '#f39c12');
    }
  };

  GazeCloudAPI.UseClickRecalibration = true;
}

function startTracking() {
  if (typeof GazeCloudAPI === 'undefined') {
    updateStatus(statusElements.eye, 'API not loaded', '#e94560');
    return;
  }

  updateStatus(statusElements.eye, 'Starting...', '#f39c12');
  GazeCloudAPI.StartEyeTracking();
  isTracking = true;
  
  if (buttons.start) buttons.start.disabled = true;
  if (buttons.stop) buttons.stop.disabled = false;
}

function stopTracking() {
  if (typeof GazeCloudAPI === 'undefined') return;
  
  GazeCloudAPI.StopEyeTracking();
  isTracking = false;
  isCalibrated = false;
  
  updateStatus(statusElements.eye, 'Stopped', '#a0a0a0');
  updateStatus(statusElements.calibration, 'Not Calibrated', '#a0a0a0');
  
  if (buttons.start) buttons.start.disabled = false;
  if (buttons.stop) buttons.stop.disabled = true;
}

function startCalibration() {
  if (!isTracking) {
    alert('Please start eye tracking first');
    return;
  }
  updateStatus(statusElements.calibration, 'Calibrating...', '#f39c12');
}

document.addEventListener('DOMContentLoaded', () => {
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
  }
  
  setTimeout(() => {
    initializeGazeTracking();
  }, 500);
});
