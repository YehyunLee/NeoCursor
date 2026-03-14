let isTracking = false;
let isCalibrated = false;
let smoothingFactor = 0.3;
let lastX = 0;
let lastY = 0;
let guideVisible = true;

const CALIBRATION_STORAGE_KEY = 'silentcursor_calibration_data';

const statusElements = {
  eye: document.getElementById('eye-status'),
  speech: document.getElementById('speech-status'),
  calibration: document.getElementById('calibration-status')
};

const buttons = {
  start: document.getElementById('start-tracking'),
  stop: document.getElementById('stop-tracking'),
  calibrate: document.getElementById('calibrate'),
  toggleGuide: document.getElementById('toggle-guide')
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
    saveCalibrationData();
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
  
  // Try to load saved calibration data
  loadCalibrationData();
}

function saveCalibrationData() {
  try {
    // GazeCloud stores calibration internally, we just save a flag and timestamp
    const calibrationData = {
      timestamp: Date.now(),
      calibrated: true
    };
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(calibrationData));
    console.log('Calibration data saved');
  } catch (error) {
    console.error('Error saving calibration data:', error);
  }
}

function loadCalibrationData() {
  try {
    const savedData = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (savedData) {
      const calibrationData = JSON.parse(savedData);
      
      if (calibrationData.calibrated) {
        isCalibrated = true;
        const timestamp = calibrationData.timestamp ? new Date(calibrationData.timestamp).toLocaleString() : 'previous session';
        updateStatus(statusElements.calibration, `Loaded Calibration (${timestamp})`, '#4ecca3');
        console.log('Loaded calibration from', timestamp);
        return true;
      }
    }
  } catch (error) {
    console.error('Error loading calibration data:', error);
  }
  return false;
}

function clearCalibrationData() {
  localStorage.removeItem(CALIBRATION_STORAGE_KEY);
  isCalibrated = false;
  updateStatus(statusElements.calibration, 'Calibration Cleared', '#f39c12');
  console.log('Calibration data cleared');
}

function toggleAlignmentGuide() {
  guideVisible = !guideVisible;
  
  // Toggle visibility of GazeCloud's video and overlay elements
  const videoContainer = document.getElementById('GazeCloudVideoContainer');
  const overlay = document.getElementById('GazeCloudOverlay');
  
  if (videoContainer) {
    videoContainer.style.display = guideVisible ? 'block' : 'none';
  }
  if (overlay) {
    overlay.style.display = guideVisible ? 'block' : 'none';
  }
  
  console.log('Alignment guide', guideVisible ? 'shown' : 'hidden');
}

async function startTracking() {
  if (typeof GazeCloudAPI === 'undefined') {
    updateStatus(statusElements.eye, 'API not loaded', '#e94560');
    return;
  }

  updateStatus(statusElements.eye, 'Starting...', '#f39c12');
  
  // Enter fullscreen for better calibration accuracy
  await window.electronAPI.setFullscreen(true);
  
  GazeCloudAPI.StartEyeTracking();
  isTracking = true;
  
  if (buttons.start) buttons.start.disabled = true;
  if (buttons.stop) buttons.stop.disabled = false;
  if (buttons.toggleGuide) buttons.toggleGuide.disabled = false;
}

async function stopTracking() {
  if (typeof GazeCloudAPI === 'undefined') return;
  
  GazeCloudAPI.StopEyeTracking();
  isTracking = false;
  isCalibrated = false;
  
  // Exit fullscreen
  await window.electronAPI.setFullscreen(false);
  
  updateStatus(statusElements.eye, 'Stopped', '#a0a0a0');
  updateStatus(statusElements.calibration, 'Not Calibrated', '#a0a0a0');
  
  if (buttons.start) buttons.start.disabled = false;
  if (buttons.stop) buttons.stop.disabled = true;
  if (buttons.toggleGuide) buttons.toggleGuide.disabled = true;
}

function startCalibration() {
  if (!isTracking) {
    alert('Please start eye tracking first');
    return;
  }
  
  // Clear old calibration data and force recalibration
  clearCalibrationData();
  updateStatus(statusElements.calibration, 'Recalibrating...', '#f39c12');
  
  // GazeCloud handles calibration automatically
  // The OnCalibrationComplete callback will save the new data
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
  
  if (buttons.toggleGuide) {
    buttons.toggleGuide.addEventListener('click', toggleAlignmentGuide);
    buttons.toggleGuide.disabled = true; // Enable only when tracking starts
  }
  
  setTimeout(() => {
    initializeGazeTracking();
  }, 500);
});
