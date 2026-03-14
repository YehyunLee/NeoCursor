// Head Tracking with MediaPipe Face Mesh
let isTracking = false;
let videoVisible = false;

// Head tracking state
let centerPoint = null;
let sensitivity = 15;

// Tiny deadzone on raw landmark delta (normalized coords, ~0.3% of face)
const DEADZONE = 0.002;

// Exponential moving average — instant direction response, dampens jitter
const EMA_ALPHA = 0.5;
let emaX = null;
let emaY = null;
let lastEmittedX = null;
let lastEmittedY = null;
const SMOOTHING_DEADZONE = 1; // suppress sub-pixel jitter

// Cache screen bounds to skip IPC round-trip every frame
let cachedBounds = null;
let boundsCacheTime = 0;
const BOUNDS_CACHE_MS = 5000;

// Throttle status DOM updates
let lastStatusUpdate = 0;
const STATUS_UPDATE_INTERVAL_MS = 250;

// Prevent stacking IPC calls
let pendingMove = false;
let mouseControlUnavailableShown = false;

// Non-linear acceleration: small head movements = precision, large = fast jumps
function accelerate(delta) {
  const abs = Math.abs(delta);
  const sign = Math.sign(delta);
  if (abs < 0.15) return sign * abs * 0.7;
  if (abs < 0.4)  return sign * (0.105 + (abs - 0.15) * 1.2);
  return sign * (0.405 + (abs - 0.4) * 2.0);
}

const statusElements = { eye: null, speech: null, calibration: null, click: null };
const buttons = { start: null, stop: null, recenter: null, toggleVideo: null };

let faceMesh, camera, videoElement, canvasElement, canvasCtx;

// Blink Detection
const RIGHT_EYE = [33, 160, 158, 133, 153, 144];
const LEFT_EYE = [362, 385, 387, 263, 373, 380];
const BASELINE_LEARN_RATE = 0.03;
const CLOSED_RATIO = 0.78;
const OPEN_RATIO = 0.92;
const CLICK_COOLDOWN = 500;
let blinkState = { left: false, right: false };
let lastClickTime = 0;
let baselineLeftEAR = 0.28;
let baselineRightEAR = 0.28;

function updateStatus(element, text, color) {
  if (element) { element.textContent = text; element.style.color = color; }
}

function dist(p1, p2) { return Math.hypot(p1.x - p2.x, p1.y - p2.y); }

function calculateEAR(landmarks, idx) {
  return (dist(landmarks[idx[1]], landmarks[idx[5]]) + dist(landmarks[idx[2]], landmarks[idx[4]]))
    / (2.0 * dist(landmarks[idx[0]], landmarks[idx[3]]));
}

function updateEARBaseline(baseline, ear, closed) {
  if (closed || !isFinite(ear)) return baseline;
  return baseline * (1 - BASELINE_LEARN_RATE) + Math.min(Math.max(ear, 0.15), 0.5) * BASELINE_LEARN_RATE;
}

function processBlinks(landmarks) {
  if (!isTracking || !landmarks || landmarks.length === 0) return;
  const leftEar = calculateEAR(landmarks, LEFT_EYE);
  const rightEar = calculateEAR(landmarks, RIGHT_EYE);
  const leftClosed = leftEar < baselineLeftEAR * CLOSED_RATIO;
  const rightClosed = rightEar < baselineRightEAR * CLOSED_RATIO;
  const leftOpen = leftEar > baselineLeftEAR * OPEN_RATIO;
  const rightOpen = rightEar > baselineRightEAR * OPEN_RATIO;
  baselineLeftEAR = updateEARBaseline(baselineLeftEAR, leftEar, leftClosed);
  baselineRightEAR = updateEARBaseline(baselineRightEAR, rightEar, rightClosed);

  if (leftClosed && rightOpen) {
    if (!blinkState.left && Date.now() - lastClickTime > CLICK_COOLDOWN) {
      blinkState.left = true;
      updateStatus(statusElements.click, "Left Click", "#4ecca3");
      window.electronAPI.mouseClick('left');
      lastClickTime = Date.now();
      setTimeout(() => { if (Date.now() - lastClickTime >= 1000) updateStatus(statusElements.click, "Waiting...", "#a0a0a0"); }, 1000);
    }
  } else if (rightClosed && leftOpen) {
    if (!blinkState.right && Date.now() - lastClickTime > CLICK_COOLDOWN) {
      blinkState.right = true;
      updateStatus(statusElements.click, "Right Click", "#667eea");
      window.electronAPI.mouseClick('right');
      lastClickTime = Date.now();
      setTimeout(() => { if (Date.now() - lastClickTime >= 1000) updateStatus(statusElements.click, "Waiting...", "#a0a0a0"); }, 1000);
    }
  } else {
    if (leftOpen) blinkState.left = false;
    if (rightOpen) blinkState.right = false;
  }
}

// EMA smoothing — reacts to direction changes within one frame
function smoothCoordinates(x, y) {
  if (emaX === null) { emaX = x; emaY = y; }
  emaX = EMA_ALPHA * x + (1 - EMA_ALPHA) * emaX;
  emaY = EMA_ALPHA * y + (1 - EMA_ALPHA) * emaY;
  let tx = Math.round(emaX);
  let ty = Math.round(emaY);
  if (lastEmittedX !== null && Math.hypot(tx - lastEmittedX, ty - lastEmittedY) < SMOOTHING_DEADZONE) {
    return { x: lastEmittedX, y: lastEmittedY };
  }
  lastEmittedX = tx;
  lastEmittedY = ty;
  return { x: tx, y: ty };
}

function setCenterPoint(landmarks) {
  if (landmarks && landmarks.length > 0) {
    centerPoint = { x: landmarks[1].x, y: landmarks[1].y };
    updateStatus(statusElements.calibration, 'Center Set', '#4ecca3');
  }
}

async function refreshBoundsCache() {
  const r = await window.electronAPI.getScreenBounds();
  if (r.success) { cachedBounds = r.bounds; boundsCacheTime = Date.now(); }
}

function processLandmarks(landmarks) {
  if (!isTracking || !landmarks || landmarks.length === 0) return;
  if (!centerPoint) { setCenterPoint(landmarks); return; }

  // Refresh bounds cache every few seconds
  if (Date.now() - boundsCacheTime > BOUNDS_CACHE_MS) refreshBoundsCache();

  const currentX = landmarks[1].x;
  const currentY = landmarks[1].y;

  let rawDX = currentX - centerPoint.x;
  let rawDY = currentY - centerPoint.y;
  if (Math.abs(rawDX) < DEADZONE) rawDX = 0;
  if (Math.abs(rawDY) < DEADZONE) rawDY = 0;
  if (rawDX === 0 && rawDY === 0) return;

  // Scale by sensitivity then apply non-linear acceleration
  let deltaX = accelerate(rawDX * sensitivity);
  let deltaY = accelerate(rawDY * sensitivity * 1.3);

  moveCursor(deltaX, deltaY);
}

function moveCursor(deltaX, deltaY) {
  if (!cachedBounds || pendingMove) return;

  const { x: bx, y: by, width: sw, height: sh } = cachedBounds;
  let targetX = bx + (sw / 2) - (deltaX * sw);
  let targetY = by + (sh / 2) + (deltaY * sh);
  targetX = Math.max(bx, Math.min(bx + sw - 1, targetX));
  targetY = Math.max(by, Math.min(by + sh - 1, targetY));

  const smoothed = smoothCoordinates(targetX, targetY);

  pendingMove = true;
  window.electronAPI.moveCursor(smoothed.x, smoothed.y).then((r) => {
    pendingMove = false;
    if (r && r.unavailable) {
      if (!mouseControlUnavailableShown) {
        mouseControlUnavailableShown = true;
        updateStatus(statusElements.eye, 'Mouse control unavailable (e.g. Windows ARM64)', '#e74c3c');
      }
    } else if (r && r.paused) {
      updateStatus(statusElements.eye, 'Paused (Manual Override)', '#f39c12');
      centerPoint = null;
    } else {
      const now = Date.now();
      if (now - lastStatusUpdate > STATUS_UPDATE_INTERVAL_MS) {
        lastStatusUpdate = now;
        updateStatus(statusElements.eye, `Tracking (${smoothed.x}, ${smoothed.y})`, '#4ecca3');
      }
    }
  }).catch(() => { pendingMove = false; });
}

function onResults(results) {
  if (videoVisible && canvasCtx) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      for (const landmarks of results.multiFaceLandmarks) {
        const nose = landmarks[1];
        canvasCtx.beginPath();
        canvasCtx.arc(nose.x * canvasElement.width, nose.y * canvasElement.height, 5, 0, 2 * Math.PI);
        canvasCtx.fillStyle = '#4ecca3';
        canvasCtx.fill();
        if (centerPoint) {
          canvasCtx.beginPath();
          canvasCtx.arc(centerPoint.x * canvasElement.width, centerPoint.y * canvasElement.height, 5, 0, 2 * Math.PI);
          canvasCtx.fillStyle = '#e94560';
          canvasCtx.fill();
          canvasCtx.beginPath();
          canvasCtx.moveTo(centerPoint.x * canvasElement.width, centerPoint.y * canvasElement.height);
          canvasCtx.lineTo(nose.x * canvasElement.width, nose.y * canvasElement.height);
          canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          canvasCtx.stroke();
        }
      }
    }
    canvasCtx.restore();
  }

  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    const landmarks = results.multiFaceLandmarks[0];
    processLandmarks(landmarks);
    processBlinks(landmarks);
  }
}

async function initializeTracker() {
  updateStatus(statusElements.eye, 'Loading MediaPipe...', '#f39c12');
  try {
    videoElement = document.getElementsByClassName('input_video')[0];
    canvasElement = document.getElementsByClassName('output_canvas')[0];
    canvasCtx = canvasElement.getContext('2d');

    faceMesh = new FaceMesh({ locateFile: (file) => `mediapipe/face_mesh/${file}` });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    faceMesh.onResults(onResults);

    updateStatus(statusElements.eye, 'Ready - Click Start', '#a0a0a0');
    console.log('MediaPipe initialized');
  } catch (error) {
    console.error('Error initializing MediaPipe:', error);
    updateStatus(statusElements.eye, 'Initialization failed', '#e94560');
  }
}

async function startTracking() {
  if (!faceMesh) { updateStatus(statusElements.eye, 'Tracker not loaded', '#e94560'); return; }
  try {
    updateStatus(statusElements.eye, 'Starting camera...', '#f39c12');
    camera = new Camera(videoElement, {
      onFrame: async () => { await faceMesh.send({ image: videoElement }); },
      width: 320,
      height: 240
    });
    await refreshBoundsCache();
    await camera.start();
    isTracking = true;
    centerPoint = null;
    updateStatus(statusElements.eye, 'Tracking Active', '#4ecca3');
    updateStatus(statusElements.calibration, 'Look at center of screen...', '#f39c12');
    if (buttons.start) buttons.start.disabled = true;
    if (buttons.stop) buttons.stop.disabled = false;
    if (buttons.recenter) buttons.recenter.disabled = false;
    if (buttons.toggleVideo) buttons.toggleVideo.disabled = false;
  } catch (error) {
    console.error('Error starting camera:', error);
    updateStatus(statusElements.eye, 'Camera Error: ' + error.message, '#e94560');
    isTracking = false;
  }
}

async function stopTracking() {
  if (camera) camera.stop();
  isTracking = false;
  emaX = null; emaY = null;
  lastEmittedX = null; lastEmittedY = null;
  centerPoint = null;
  pendingMove = false;
  updateStatus(statusElements.eye, 'Stopped', '#a0a0a0');
  updateStatus(statusElements.calibration, 'Not Set', '#a0a0a0');
  if (buttons.start) buttons.start.disabled = false;
  if (buttons.stop) buttons.stop.disabled = true;
  if (buttons.recenter) buttons.recenter.disabled = true;
  if (buttons.toggleVideo) buttons.toggleVideo.disabled = true;
}

function recenter() {
  if (!isTracking) { alert('Please start tracking first'); return; }
  centerPoint = null;
  emaX = null; emaY = null;
  updateStatus(statusElements.calibration, 'Look at center of screen...', '#f39c12');
}

function toggleVideoPreview() {
  videoVisible = !videoVisible;
  const container = document.getElementById('video-container');
  container.classList.toggle('visible', videoVisible);
}

window.addEventListener('load', () => {
  statusElements.eye = document.getElementById('eye-status');
  statusElements.speech = document.getElementById('speech-status');
  statusElements.calibration = document.getElementById('calibration-status');
  statusElements.click = document.getElementById('click-status');
  buttons.start = document.getElementById('start-tracking');
  buttons.stop = document.getElementById('stop-tracking');
  buttons.recenter = document.getElementById('recenter');
  buttons.toggleVideo = document.getElementById('toggle-video');

  const sensitivitySlider = document.getElementById('sensitivity-slider');
  const sensitivityValue = document.getElementById('sensitivity-value');
  if (sensitivitySlider) {
    sensitivity = parseInt(sensitivitySlider.value);
    sensitivitySlider.addEventListener('input', (e) => {
      sensitivity = parseInt(e.target.value);
      if (sensitivityValue) sensitivityValue.textContent = sensitivity;
    });
  }

  updateStatus(statusElements.speech, 'Coming Soon', '#a0a0a0');
  if (buttons.start) buttons.start.addEventListener('click', startTracking);
  if (buttons.stop) { buttons.stop.addEventListener('click', stopTracking); buttons.stop.disabled = true; }
  if (buttons.recenter) { buttons.recenter.addEventListener('click', recenter); buttons.recenter.disabled = true; }
  if (buttons.toggleVideo) { buttons.toggleVideo.addEventListener('click', toggleVideoPreview); buttons.toggleVideo.disabled = true; }

  setTimeout(initializeTracker, 500);
});
