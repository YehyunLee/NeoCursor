// WebGazer.js Implementation - Optimized for Maximum Accuracy
let isTracking = false;
let isCalibrated = false;
let videoVisible = true;

// Advanced smoothing for better accuracy
let smoothingBuffer = [];
const SMOOTHING_BUFFER_SIZE = 5; // Average last 5 predictions
const CALIBRATION_STORAGE_KEY = 'silentcursor_webgazer_calibration';

const statusElements = {
  eye: null,
  speech: null,
  calibration: null
};

const buttons = {
  start: null,
  stop: null,
  recalibrate: null,
  toggleVideo: null
};

function updateStatus(element, text, color) {
  if (element) {
    element.textContent = text;
    element.style.color = color;
  }
}

// Advanced smoothing using moving average
function smoothCoordinates(x, y) {
  smoothingBuffer.push({ x, y });
  
  if (smoothingBuffer.length > SMOOTHING_BUFFER_SIZE) {
    smoothingBuffer.shift();
  }
  
  const avgX = smoothingBuffer.reduce((sum, p) => sum + p.x, 0) / smoothingBuffer.length;
  const avgY = smoothingBuffer.reduce((sum, p) => sum + p.y, 0) / smoothingBuffer.length;
  
  return { x: Math.round(avgX), y: Math.round(avgY) };
}

async function initializeWebGazer() {
  if (typeof webgazer === 'undefined') {
    console.error('WebGazer not loaded');
    updateStatus(statusElements.eye, 'Error: WebGazer not loaded', '#e94560');
    return;
  }

  console.log('Initializing WebGazer with maximum accuracy settings...');

  // Configure WebGazer for maximum accuracy
  webgazer.params.showVideo = true;
  webgazer.params.showFaceOverlay = true;
  webgazer.params.showFaceFeedbackBox = true;
  webgazer.params.showGazeDot = true;
  
  // Set gaze listener with desktop-wide control
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
        
        if (isCalibrated) {
          updateStatus(statusElements.eye, `Tracking (${screenX}, ${screenY})`, '#4ecca3');
        }
      }
    } catch (err) {
      console.error('Error moving cursor:', err);
    }
  });

  // Enable all accuracy features
  webgazer.showVideoPreview(true)
    .showPredictionPoints(true)
    .showFaceOverlay(true)
    .showFaceFeedbackBox(true)
    .applyKalmanFilter(true); // Kalman filter for smoother predictions

  // Try to load saved calibration data
  loadCalibrationData();
  
  updateStatus(statusElements.eye, 'Ready - Click Start to begin', '#a0a0a0');
  console.log('WebGazer initialized with accuracy optimizations');
}

async function startTracking() {
  if (typeof webgazer === 'undefined') {
    updateStatus(statusElements.eye, 'WebGazer not loaded', '#e94560');
    return;
  }

  try {
    updateStatus(statusElements.eye, 'Starting...', '#f39c12');
    updateStatus(statusElements.calibration, 'Click around the screen to calibrate', '#f39c12');
    
    // Enter fullscreen for better calibration
    await window.electronAPI.setFullscreen(true);
    
    // Start WebGazer
    await webgazer.begin();
    isTracking = true;
    
    updateStatus(statusElements.eye, 'Tracking Active - Calibrating...', '#4ecca3');
    
    // Auto-calibrate after 30 clicks or 15 seconds
    let clickCount = 0;
    const calibrationHandler = () => {
      clickCount++;
      if (clickCount >= 30) {
        isCalibrated = true;
        updateStatus(statusElements.calibration, 'Calibrated (30 points)', '#4ecca3');
        saveCalibrationData();
        document.removeEventListener('click', calibrationHandler);
      }
    };
    
    document.addEventListener('click', calibrationHandler);
    
    // Auto-mark as calibrated after 15 seconds
    setTimeout(() => {
      if (!isCalibrated) {
        isCalibrated = true;
        updateStatus(statusElements.calibration, `Calibrated (${clickCount} points)`, '#4ecca3');
        saveCalibrationData();
        document.removeEventListener('click', calibrationHandler);
      }
    }, 15000);
    
    if (buttons.start) buttons.start.disabled = true;
    if (buttons.stop) buttons.stop.disabled = false;
    if (buttons.recalibrate) buttons.recalibrate.disabled = false;
    if (buttons.toggleVideo) buttons.toggleVideo.disabled = false;
    
  } catch (error) {
    console.error('Error starting WebGazer:', error);
    updateStatus(statusElements.eye, 'Error: ' + error.message, '#e94560');
    isTracking = false;
  }
}

async function stopTracking() {
  if (typeof webgazer === 'undefined') return;
  
  webgazer.pause();
  isTracking = false;
  smoothingBuffer = [];
  
  // Exit fullscreen
  await window.electronAPI.setFullscreen(false);
  
  updateStatus(statusElements.eye, 'Stopped', '#a0a0a0');
  
  if (buttons.start) buttons.start.disabled = false;
  if (buttons.stop) buttons.stop.disabled = true;
  if (buttons.recalibrate) buttons.recalibrate.disabled = true;
  if (buttons.toggleVideo) buttons.toggleVideo.disabled = true;
}

function recalibrate() {
  if (!isTracking) {
    alert('Please start eye tracking first');
    return;
  }
  
  // Clear calibration data
  clearCalibrationData();
  isCalibrated = false;
  smoothingBuffer = [];
  
  updateStatus(statusElements.calibration, 'Recalibrating - Click around screen', '#f39c12');
  
  // Restart calibration process
  let clickCount = 0;
  const calibrationHandler = () => {
    clickCount++;
    updateStatus(statusElements.calibration, `Calibrating (${clickCount}/30 points)`, '#f39c12');
    
    if (clickCount >= 30) {
      isCalibrated = true;
      updateStatus(statusElements.calibration, 'Recalibrated (30 points)', '#4ecca3');
      saveCalibrationData();
      document.removeEventListener('click', calibrationHandler);
    }
  };
  
  document.addEventListener('click', calibrationHandler);
}

function toggleVideoPreview() {
  videoVisible = !videoVisible;
  webgazer.showVideoPreview(videoVisible);
  webgazer.showPredictionPoints(videoVisible);
  webgazer.showFaceOverlay(videoVisible);
  webgazer.showFaceFeedbackBox(videoVisible);
  
  console.log('Video preview', videoVisible ? 'shown' : 'hidden');
}

// Calibration persistence functions
function saveCalibrationData() {
  try {
    const calibrationData = {
      timestamp: Date.now(),
      calibrated: true,
      // WebGazer stores its own calibration internally
      // We just save a flag to indicate calibration was completed
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
        updateStatus(statusElements.calibration, `Loaded from ${timestamp}`, '#4ecca3');
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
  console.log('Calibration data cleared');
}

// Initialize when DOM is ready
window.addEventListener('load', () => {
  statusElements.eye = document.getElementById('eye-status');
  statusElements.speech = document.getElementById('speech-status');
  statusElements.calibration = document.getElementById('calibration-status');
  
  buttons.start = document.getElementById('start-tracking');
  buttons.stop = document.getElementById('stop-tracking');
  buttons.recalibrate = document.getElementById('recalibrate');
  buttons.toggleVideo = document.getElementById('toggle-video');
  
  updateStatus(statusElements.eye, 'Loading WebGazer...', '#f39c12');
  updateStatus(statusElements.speech, 'Coming Soon', '#a0a0a0');
  updateStatus(statusElements.calibration, 'Not Calibrated', '#a0a0a0');
  
  if (buttons.start) {
    buttons.start.addEventListener('click', startTracking);
  }
  
  if (buttons.stop) {
    buttons.stop.addEventListener('click', stopTracking);
    buttons.stop.disabled = true;
  }
  
  if (buttons.recalibrate) {
    buttons.recalibrate.addEventListener('click', recalibrate);
    buttons.recalibrate.disabled = true;
  }
  
  if (buttons.toggleVideo) {
    buttons.toggleVideo.addEventListener('click', toggleVideoPreview);
    buttons.toggleVideo.disabled = true;
  }
  
  // Wait for WebGazer to fully load
  setTimeout(() => {
    console.log('Checking for WebGazer...');
    console.log('window.webgazer:', window.webgazer);
    console.log('typeof webgazer:', typeof webgazer);
    
    if (typeof window.webgazer !== 'undefined' || typeof webgazer !== 'undefined') {
      initializeWebGazer();
    } else {
      console.error('WebGazer not found');
      updateStatus(statusElements.eye, 'WebGazer failed to load', '#e94560');
    }
  }, 1000);
});
