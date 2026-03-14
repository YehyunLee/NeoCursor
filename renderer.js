// Head Tracking with MediaPipe Face Mesh
let isTracking = false;
let videoVisible = false;

// VSR Recording state
let isVSRRecording = false;
let vsrFrameInterval = null;
let vsrFrameCount = 0;
const VSR_FPS = 16;
const VSR_FRAME_INTERVAL = 1000 / VSR_FPS;

// Head tracking + stability state
let centerPoint = null;
let sensitivity = 15;
let stabilityLevel = 7; // 1-10 slider

let deadzone = 0.004;
const DEADZONE_MIN = 0.003;
const DEADZONE_MAX = 0.009;

// Adaptive EMA: alpha varies by movement magnitude
const EMA_ALPHA_MIN = 0.05;  // more smoothing at rest
const EMA_ALPHA_MAX = 0.38;  // slightly damp fast swings
const ADAPT_THRESHOLD = 10;  // require larger movement before loosening smoothing
let emaX = null;
let emaY = null;
let lastEmittedX = null;
let lastEmittedY = null;
let smoothingDeadzone = 5;
const SMOOTHING_DEADZONE_MIN = 3;
const SMOOTHING_DEADZONE_MAX = 12;

let microMovementThreshold = 0.007;
const MICRO_THRESHOLD_MIN = 0.004;
const MICRO_THRESHOLD_MAX = 0.012;

// Cache screen bounds to skip IPC round-trip every frame
let cachedBounds = null;
let boundsCacheTime = 0;
const BOUNDS_CACHE_MS = 5000;

// Throttle status DOM updates
let lastStatusUpdate = 0;
const STATUS_UPDATE_INTERVAL_MS = 250;

// Prevent stacking IPC calls
let pendingMove = false;
let pendingScroll = false;
let mouseControlUnavailableShown = false;

// Scroll mode: hold Z to scroll instead of moving cursor
let scrollMode = false;
const SCROLL_SENSITIVITY = 600;

// Drag state machine: 'idle' → 'pending' → 'click' or 'dragging' → 'cancelable' → 'idle'
// Quick blink (<HOLD_THRESHOLD) = click, sustained hold = drag
let dragState = 'idle';
let dragStateTime = 0;
let leftEyeCloseTime = 0;
const HOLD_THRESHOLD = 350;
const DRAG_CANCEL_WINDOW = 1500;

// Non-linear acceleration: small head movements = precision, large = fast jumps
function accelerate(delta) {
  const abs = Math.abs(delta);
  const sign = Math.sign(delta);
  if (abs < 0.18) return sign * abs * 0.6;                      // finer control near rest
  if (abs < 0.45) return sign * (0.108 + (abs - 0.18) * 0.95);   // gentler ramp
  return sign * (0.378 + (abs - 0.45) * 1.4);                    // cap large jumps
}

const statusElements = { eye: null, speech: null, calibration: null, click: null, scroll: null, drag: null };
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

  const now = Date.now();

  // Expire cancelable state after window
  if (dragState === 'cancelable' && now - dragStateTime > DRAG_CANCEL_WINDOW) {
    dragState = 'idle';
    updateStatus(statusElements.drag, "Ready", "#a0a0a0");
    updateStatus(statusElements.click, "Waiting...", "#a0a0a0");
  }

  // 'pending' → 'dragging': eye stayed closed past HOLD_THRESHOLD
  if (dragState === 'pending' && leftClosed && now - leftEyeCloseTime >= HOLD_THRESHOLD) {
    dragState = 'dragging';
    dragStateTime = now;
    window.electronAPI.mouseDown('left');
    updateStatus(statusElements.click, "Selecting...", "#f59e0b");
    updateStatus(statusElements.drag, "Hold eye closed to select", "#f59e0b");
  }

  // Left eye close edge (was open, now closed)
  if (leftClosed && rightOpen && !blinkState.left) {
    blinkState.left = true;

    if (dragState === 'cancelable') {
      // Cancel selection — click to deselect
      dragState = 'idle';
      dragStateTime = now;
      lastClickTime = now;
      window.electronAPI.mouseClick('left');
      updateStatus(statusElements.click, "Selection Cancelled", "#ef4444");
      updateStatus(statusElements.drag, "Ready", "#a0a0a0");
      setTimeout(() => { if (Date.now() - lastClickTime >= 1000) updateStatus(statusElements.click, "Waiting...", "#a0a0a0"); }, 1000);
    } else if (dragState === 'idle' && now - lastClickTime > CLICK_COOLDOWN) {
      // Eye just closed — enter pending, decide click vs drag later
      dragState = 'pending';
      leftEyeCloseTime = now;
      lastClickTime = now;
    }
  }

  // Left eye open edge (was closed, now open)
  if (leftOpen && blinkState.left) {
    blinkState.left = false;

    if (dragState === 'pending') {
      // Opened before HOLD_THRESHOLD → regular left click
      dragState = 'idle';
      dragStateTime = now;
      window.electronAPI.mouseClick('left');
      updateStatus(statusElements.click, "Left Click", "#4ecca3");
      setTimeout(() => { if (Date.now() - lastClickTime >= 1000) updateStatus(statusElements.click, "Waiting...", "#a0a0a0"); }, 1000);
    } else if (dragState === 'dragging') {
      // End drag, enter cancelable window
      dragState = 'cancelable';
      dragStateTime = now;
      window.electronAPI.mouseUp('left');
      updateStatus(statusElements.click, "Selected (blink to cancel)", "#4ecca3");
      updateStatus(statusElements.drag, "Blink left to cancel", "#4ecca3");
    }
  }

  // Right eye: right-click (cancels active drag if any)
  if (rightClosed && leftOpen) {
    if (!blinkState.right && now - lastClickTime > CLICK_COOLDOWN) {
      blinkState.right = true;
      lastClickTime = now;

      if (dragState === 'dragging' || dragState === 'pending') {
        if (dragState === 'dragging') window.electronAPI.mouseUp('left');
        dragState = 'idle';
        dragStateTime = now;
        updateStatus(statusElements.drag, "Ready", "#a0a0a0");
      }
      updateStatus(statusElements.click, "Right Click", "#667eea");
      window.electronAPI.mouseClick('right');
      setTimeout(() => { if (Date.now() - lastClickTime >= 1000) updateStatus(statusElements.click, "Waiting...", "#a0a0a0"); }, 1000);
    }
  } else {
    if (rightOpen) blinkState.right = false;
  }
}

// Adaptive EMA: small delta = heavy smoothing (stable), large delta = light smoothing (responsive)
function smoothCoordinates(x, y) {
  if (emaX === null) { emaX = x; emaY = y; }
  const dx = Math.abs(x - emaX);
  const dy = Math.abs(y - emaY);
  const mag = Math.max(dx, dy);
  const t = Math.min(mag / ADAPT_THRESHOLD, 1);
  const alpha = EMA_ALPHA_MIN + t * (EMA_ALPHA_MAX - EMA_ALPHA_MIN);
  emaX = alpha * x + (1 - alpha) * emaX;
  emaY = alpha * y + (1 - alpha) * emaY;
  let tx = Math.round(emaX);
  let ty = Math.round(emaY);
  if (lastEmittedX !== null && Math.hypot(tx - lastEmittedX, ty - lastEmittedY) < smoothingDeadzone) {
    return { x: lastEmittedX, y: lastEmittedY };
  }
  lastEmittedX = tx;
  lastEmittedY = ty;
  return { x: tx, y: ty };
}

function setCenterPoint(landmarks) {
  if (landmarks && landmarks.length > 0) {
    centerPoint = getTrackedPosition(landmarks);
    updateStatus(statusElements.calibration, 'Center Set', '#4ecca3');
  }
}

async function refreshBoundsCache() {
  const r = await window.electronAPI.getScreenBounds();
  if (r.success) { cachedBounds = r.bounds; boundsCacheTime = Date.now(); }
}

// Blend nose tip (1), nose bridge (6), chin (152), forehead (10) to reduce single-point noise
const TRACK_LANDMARKS = [1, 6, 152, 10];

function getTrackedPosition(landmarks) {
  let sx = 0, sy = 0;
  for (const i of TRACK_LANDMARKS) { sx += landmarks[i].x; sy += landmarks[i].y; }
  return { x: sx / TRACK_LANDMARKS.length, y: sy / TRACK_LANDMARKS.length };
}

function processLandmarks(landmarks) {
  if (!isTracking || !landmarks || landmarks.length === 0) return;
  if (!centerPoint) { setCenterPoint(landmarks); return; }

  if (Date.now() - boundsCacheTime > BOUNDS_CACHE_MS) refreshBoundsCache();

  const pos = getTrackedPosition(landmarks);
  const currentX = pos.x;
  const currentY = pos.y;

  let rawDX = currentX - centerPoint.x;
  let rawDY = currentY - centerPoint.y;
  if (Math.abs(rawDX) < deadzone) rawDX = 0;
  if (Math.abs(rawDY) < deadzone) rawDY = 0;
  if (rawDX === 0 && rawDY === 0) return;

  const dominantDelta = Math.max(Math.abs(rawDX), Math.abs(rawDY));
  if (dominantDelta < microMovementThreshold) {
    return;
  }

  if (scrollMode) {
    doScroll(rawDX, rawDY);
  } else {
    let deltaX = accelerate(rawDX * sensitivity);
    let deltaY = accelerate(rawDY * sensitivity * 1.3);
    moveCursor(deltaX, deltaY);
  }
}

function doScroll(rawDX, rawDY) {
  if (pendingScroll) return;
  // Windows MOUSEEVENTF_WHEEL: positive = scroll up, negative = scroll down
  // rawDY positive = head moved down in camera → scroll DOWN (negative wheel)
  // rawDY negative = head moved up in camera → scroll UP (positive wheel)
  let dy = Math.round(-rawDY * sensitivity * SCROLL_SENSITIVITY);
  let dx = Math.round(-rawDX * sensitivity * SCROLL_SENSITIVITY * 0.5);
  // Enforce minimum of WHEEL_DELTA (120) so apps register at least one notch
  if (dy !== 0) dy = Math.sign(dy) * Math.max(Math.abs(dy), 120);
  if (dx !== 0) dx = Math.sign(dx) * Math.max(Math.abs(dx), 120);
  // Clamp to reasonable range
  dy = Math.max(-960, Math.min(960, dy));
  dx = Math.max(-960, Math.min(960, dx));
  if (dy === 0 && dx === 0) return;

  pendingScroll = true;
  window.electronAPI.scroll(dx, dy).then(() => {
    pendingScroll = false;
  }).catch(() => { pendingScroll = false; });
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
  if (dragState === 'dragging') window.electronAPI.mouseUp('left');
  dragState = 'idle';
  dragStateTime = 0;
  leftEyeCloseTime = 0;
  updateStatus(statusElements.drag, "Ready", "#a0a0a0");
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
  statusElements.scroll = document.getElementById('scroll-status');
  statusElements.drag = document.getElementById('drag-status');
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

  const stabilitySlider = document.getElementById('stability-slider');
  const stabilityValue = document.getElementById('stability-value');
  if (stabilitySlider) {
    stabilityLevel = parseInt(stabilitySlider.value);
    applyStabilitySettings();
    stabilitySlider.addEventListener('input', (e) => {
      stabilityLevel = parseInt(e.target.value);
      applyStabilitySettings();
      if (stabilityValue) stabilityValue.textContent = stabilityLevel;
    });
    if (stabilityValue) stabilityValue.textContent = stabilityLevel;
  } else {
    applyStabilitySettings();
  }

  updateStatus(statusElements.speech, 'Ready (Cmd+R to record)', '#a0a0a0');
  if (buttons.start) buttons.start.addEventListener('click', startTracking);
  if (buttons.stop) { buttons.stop.addEventListener('click', stopTracking); buttons.stop.disabled = true; }
  if (buttons.recenter) { buttons.recenter.addEventListener('click', recenter); buttons.recenter.disabled = true; }
  if (buttons.toggleVideo) { buttons.toggleVideo.addEventListener('click', toggleVideoPreview); buttons.toggleVideo.disabled = true; }

  // Hold Z to enter scroll mode
  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyZ' && !e.repeat) {
      e.preventDefault();
      scrollMode = true;
      updateStatus(statusElements.scroll, 'Scrolling (hold Z)', '#a855f7');
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyZ') {
      e.preventDefault();
      scrollMode = false;
      updateStatus(statusElements.scroll, 'Move to scroll', '#a0a0a0');
    }
  });

  // Listen for VSR recording toggle from global shortcut
  window.electronAPI.onToggleVSRRecording(() => {
    toggleVSRRecording();
  });

  setTimeout(initializeTracker, 500);
});

function applyStabilitySettings() {
  const t = (stabilityLevel - 1) / 9; // normalize 0-1
  deadzone = DEADZONE_MIN + t * (DEADZONE_MAX - DEADZONE_MIN);
  smoothingDeadzone = Math.round(SMOOTHING_DEADZONE_MIN + t * (SMOOTHING_DEADZONE_MAX - SMOOTHING_DEADZONE_MIN));
  microMovementThreshold = MICRO_THRESHOLD_MIN + t * (MICRO_THRESHOLD_MAX - MICRO_THRESHOLD_MIN);
}

// VSR Recording Functions
async function toggleVSRRecording() {
  if (!isTracking) {
    console.log('[VSR] Cannot record - tracking not started');
    return;
  }

  if (isVSRRecording) {
    await stopVSRRecording();
  } else {
    await startVSRRecording();
  }
}

async function startVSRRecording() {
  const result = await window.electronAPI.vsrStartRecording();
  if (!result.success) {
    console.error('[VSR] Failed to start recording:', result.error);
    return;
  }

  isVSRRecording = true;
  vsrFrameCount = 0;
  updateStatus(statusElements.speech, 'Recording...', '#e94560');
  console.log('[VSR] Recording started');

  // Capture frames at VSR_FPS
  vsrFrameInterval = setInterval(async () => {
    if (!isVSRRecording || !videoElement) return;

    try {
      // Create a temporary canvas to capture the current video frame
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = videoElement.videoWidth;
      tempCanvas.height = videoElement.videoHeight;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(videoElement, 0, 0);

      // Convert to base64 JPEG
      const frameData = tempCanvas.toDataURL('image/jpeg', 0.7);
      await window.electronAPI.vsrAddFrame(frameData);
      vsrFrameCount++;

      // Update status with frame count
      updateStatus(statusElements.speech, `Recording... (${vsrFrameCount} frames)`, '#e94560');
    } catch (error) {
      console.error('[VSR] Error capturing frame:', error);
    }
  }, VSR_FRAME_INTERVAL);
}

async function stopVSRRecording() {
  if (!isVSRRecording) return;

  isVSRRecording = false;
  if (vsrFrameInterval) {
    clearInterval(vsrFrameInterval);
    vsrFrameInterval = null;
  }

  updateStatus(statusElements.speech, 'Processing...', '#f39c12');
  console.log(`[VSR] Recording stopped. Captured ${vsrFrameCount} frames`);

  const result = await window.electronAPI.vsrStopRecording();
  if (result.success && result.result) {
    const output = result.result.text || 'No output';
    console.log('[VSR] Output:', output);
    updateStatus(statusElements.speech, output, '#4ecca3');

    // Reset status after 5 seconds
    setTimeout(() => {
      if (!isVSRRecording) {
        updateStatus(statusElements.speech, 'Ready (Cmd+R to record)', '#a0a0a0');
      }
    }, 5000);
  } else {
    updateStatus(statusElements.speech, 'Recording too short or error', '#e94560');
    setTimeout(() => {
      if (!isVSRRecording) {
        updateStatus(statusElements.speech, 'Ready (Cmd+R to record)', '#a0a0a0');
      }
    }, 3000);
  }

  vsrFrameCount = 0;
}
