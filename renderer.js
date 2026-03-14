// WebGazer.js - Enhanced Calibration UX
let isTracking = false;
let isCalibrated = false;
let videoVisible = true;
let calibrationPoints = [];
let currentCalibrationIndex = 0;
let clicksPerPoint = 5; // Multiple clicks per point for better accuracy

// Advanced smoothing
let smoothingBuffer = [];
const SMOOTHING_BUFFER_SIZE = 7;
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

function smoothCoordinates(x, y) {
  smoothingBuffer.push({ x, y });
  
  if (smoothingBuffer.length > SMOOTHING_BUFFER_SIZE) {
    smoothingBuffer.shift();
  }
  
  const avgX = smoothingBuffer.reduce((sum, p) => sum + p.x, 0) / smoothingBuffer.length;
  const avgY = smoothingBuffer.reduce((sum, p) => sum + p.y, 0) / smoothingBuffer.length;
  
  return { x: Math.round(avgX), y: Math.round(avgY) };
}

function create9PointGrid() {
  const points = [];
  const margin = 10; // 10% margin from edges
  
  // 3x3 grid positions (percentage of screen)
  const positions = [
    [margin, margin],           // Top-left
    [50, margin],               // Top-center
    [100 - margin, margin],     // Top-right
    [margin, 50],               // Middle-left
    [50, 50],                   // Center
    [100 - margin, 50],         // Middle-right
    [margin, 100 - margin],     // Bottom-left
    [50, 100 - margin],         // Bottom-center
    [100 - margin, 100 - margin] // Bottom-right
  ];
  
  positions.forEach(([x, y], index) => {
    points.push({
      id: index,
      x: x,
      y: y,
      clicks: 0,
      completed: false
    });
  });
  
  return points;
}

function showCalibrationOverlay() {
  const overlay = document.getElementById('calibration-overlay');
  console.log('Showing calibration overlay:', overlay);
  overlay.classList.add('active');
  
  // Clear any existing points
  const existingPoints = overlay.querySelectorAll('.calibration-point');
  existingPoints.forEach(p => p.remove());
  
  // Create calibration points
  calibrationPoints = create9PointGrid();
  currentCalibrationIndex = 0;
  
  console.log('Creating calibration points:', calibrationPoints);
  
  calibrationPoints.forEach(point => {
    const pointEl = document.createElement('div');
    pointEl.className = 'calibration-point';
    pointEl.id = `cal-point-${point.id}`;
    pointEl.style.left = `${point.x}%`;
    pointEl.style.top = `${point.y}%`;
    pointEl.style.position = 'absolute';
    pointEl.style.zIndex = '100000';
    pointEl.style.display = 'block';
    pointEl.style.visibility = 'visible';
    pointEl.style.pointerEvents = 'auto';
    
    console.log(`Created point ${point.id} at ${point.x}%, ${point.y}%`, pointEl);
    
    pointEl.addEventListener('click', (e) => {
      console.log('Point clicked!', point.id, e);
      handleCalibrationClick(point.id);
    });
    
    overlay.appendChild(pointEl);
  });
  
  console.log('Total points in overlay:', overlay.querySelectorAll('.calibration-point').length);
  
  updateCalibrationProgress();
  highlightCurrentPoint();
}

function highlightCurrentPoint() {
  // Remove highlight from all points
  calibrationPoints.forEach(p => {
    const el = document.getElementById(`cal-point-${p.id}`);
    if (el) {
      el.style.transform = 'translate(-50%, -50%) scale(1)';
      el.style.zIndex = '10000';
    }
  });
  
  // Highlight current point
  if (currentCalibrationIndex < calibrationPoints.length) {
    const currentPoint = calibrationPoints[currentCalibrationIndex];
    const el = document.getElementById(`cal-point-${currentPoint.id}`);
    if (el) {
      el.style.transform = 'translate(-50%, -50%) scale(1.5)';
      el.style.zIndex = '10002';
    }
  }
}

function handleCalibrationClick(pointId) {
  console.log('handleCalibrationClick called with pointId:', pointId);
  console.log('Current calibration index:', currentCalibrationIndex);
  
  const point = calibrationPoints.find(p => p.id === pointId);
  console.log('Found point:', point);
  
  if (!point) {
    console.error('Point not found!');
    return;
  }
  
  if (point.completed) {
    console.log('Point already completed');
    return;
  }
  
  // Only allow clicking the current point
  if (pointId !== currentCalibrationIndex) {
    console.log('Wrong point clicked. Expected:', currentCalibrationIndex, 'Got:', pointId);
    return;
  }
  
  point.clicks++;
  console.log('Point clicks:', point.clicks, '/', clicksPerPoint);
  
  const pointEl = document.getElementById(`cal-point-${pointId}`);
  
  if (point.clicks >= clicksPerPoint) {
    console.log('Point completed!');
    point.completed = true;
    pointEl.classList.add('completed');
    currentCalibrationIndex++;
    
    if (currentCalibrationIndex < calibrationPoints.length) {
      console.log('Moving to next point:', currentCalibrationIndex);
      highlightCurrentPoint();
      updateCalibrationProgress();
    } else {
      console.log('All points completed!');
      completeCalibration();
    }
  } else {
    updateCalibrationProgress();
  }
}

function updateCalibrationProgress() {
  const progressText = document.getElementById('calibration-progress-text');
  const totalClicks = calibrationPoints.reduce((sum, p) => sum + p.clicks, 0);
  const totalRequired = calibrationPoints.length * clicksPerPoint;
  const currentPoint = calibrationPoints[currentCalibrationIndex];
  
  if (currentPoint) {
    progressText.textContent = `Point ${currentCalibrationIndex + 1}/9 - Click ${currentPoint.clicks}/${clicksPerPoint} (Total: ${totalClicks}/${totalRequired})`;
  }
}

function completeCalibration() {
  const overlay = document.getElementById('calibration-overlay');
  const instructions = document.getElementById('calibration-instructions');
  
  instructions.innerHTML = '<h2>Calibration Complete!</h2><p>Starting eye tracking...</p>';
  
  setTimeout(() => {
    overlay.classList.remove('active');
    // Clear calibration points
    calibrationPoints.forEach(p => {
      const el = document.getElementById(`cal-point-${p.id}`);
      if (el) el.remove();
    });
    
    isCalibrated = true;
    updateStatus(statusElements.calibration, 'Calibrated (45 points)', '#4ecca3');
    saveCalibrationData();
  }, 1500);
}

async function initializeWebGazer() {
  if (typeof webgazer === 'undefined') {
    console.error('WebGazer not loaded');
    updateStatus(statusElements.eye, 'Error: WebGazer not loaded', '#e94560');
    return;
  }

  console.log('Initializing WebGazer with enhanced calibration...');

  // Optimize WebGazer settings for accuracy
  webgazer.params.showVideo = true;
  webgazer.params.showFaceOverlay = true;
  webgazer.params.showFaceFeedbackBox = true;
  webgazer.params.showGazeDot = true;
  
  webgazer.setGazeListener(async function(data, timestamp) {
    if (data == null || !isTracking || !isCalibrated) {
      return;
    }
    
    const smoothed = smoothCoordinates(data.x, data.y);
    
    try {
      const result = await window.electronAPI.getWindowBounds();
      if (result.success) {
        const screenX = result.bounds.x + smoothed.x;
        const screenY = result.bounds.y + smoothed.y;
        
        await window.electronAPI.moveCursor(screenX, screenY);
        updateStatus(statusElements.eye, `Tracking (${screenX}, ${screenY})`, '#4ecca3');
      }
    } catch (err) {
      console.error('Error moving cursor:', err);
    }
  });

  webgazer.showVideoPreview(true)
    .showPredictionPoints(true)
    .showFaceOverlay(true)
    .showFaceFeedbackBox(true)
    .applyKalmanFilter(true);

  // Don't load saved calibration - always calibrate fresh
  updateStatus(statusElements.eye, 'Ready - Click Start to begin', '#a0a0a0');
  updateStatus(statusElements.calibration, 'Will calibrate on start', '#a0a0a0');
  console.log('WebGazer initialized');
}

async function startTracking() {
  if (typeof webgazer === 'undefined') {
    updateStatus(statusElements.eye, 'WebGazer not loaded', '#e94560');
    return;
  }

  try {
    updateStatus(statusElements.eye, 'Starting...', '#f39c12');
    updateStatus(statusElements.calibration, 'Preparing calibration...', '#f39c12');
    
    await window.electronAPI.setFullscreen(true);
    
    await webgazer.begin();
    isTracking = true;
    
    updateStatus(statusElements.eye, 'Camera Active', '#4ecca3');
    
    // Wait a moment for camera to stabilize, then always show calibration
    setTimeout(() => {
      showCalibrationOverlay();
    }, 1000);
    
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
  
  // Hide calibration overlay if visible
  const overlay = document.getElementById('calibration-overlay');
  overlay.classList.remove('active');
  
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
  
  clearCalibrationData();
  isCalibrated = false;
  smoothingBuffer = [];
  
  updateStatus(statusElements.calibration, 'Starting recalibration...', '#f39c12');
  showCalibrationOverlay();
}

function toggleVideoPreview() {
  videoVisible = !videoVisible;
  webgazer.showVideoPreview(videoVisible);
  webgazer.showPredictionPoints(videoVisible);
  webgazer.showFaceOverlay(videoVisible);
  webgazer.showFaceFeedbackBox(videoVisible);
  
  console.log('Video preview', videoVisible ? 'shown' : 'hidden');
}

function saveCalibrationData() {
  try {
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
        const timestamp = new Date(calibrationData.timestamp).toLocaleString();
        updateStatus(statusElements.calibration, `Saved: ${timestamp}`, '#4ecca3');
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
  
  setTimeout(() => {
    if (typeof window.webgazer !== 'undefined' || typeof webgazer !== 'undefined') {
      initializeWebGazer();
    } else {
      console.error('WebGazer not found');
      updateStatus(statusElements.eye, 'WebGazer failed to load', '#e94560');
    }
  }, 1000);
});
