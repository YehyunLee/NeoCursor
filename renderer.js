// Head Tracking with MediaPipe Face Mesh
let isTracking = false;
let videoVisible = false;

// VSR Recording state
let isVSRRecording = false;
let vsrFrameInterval = null;
let vsrFrameCount = 0;
const VSR_FPS = 16;
const VSR_FRAME_INTERVAL = 1000 / VSR_FPS;
const CAMERA_WIDTH = Math.floor(640 / 3);
const CAMERA_HEIGHT = Math.floor(480 / 3);
const VSR_CAPTURE_WIDTH = CAMERA_WIDTH;
let vsrCanvas = null;
let vsrCanvasCtx = null;

// Speech-to-Text state
let isSpeechActive = false;
let audioContext = null;
let micStream = null;
let audioWorkletNode = null;
let speechProcessor = null;
let speechSourceNode = null;
const SPEECH_SAMPLE_RATE = 16000;
let speechSettings = {
  engine: 'whisper',
  whisperModel: 'base',
  googleAvailable: false
};
const VAD_START_THRESHOLD = 0.018;
const VAD_SILENCE_TIMEOUT_MS = 1400;
let vadIsSpeaking = false;
let lastVoiceDetected = 0;
let speechEngineRunning = false;
let speechEngineStarting = false;
let speechEngineStopping = false;
let lastClickSuppressedNotice = 0;
const CLICK_SUPPRESS_NOTICE_COOLDOWN = 800;

// Transcript box state
let transcriptBox = null;
let transcriptContent = null;
let transcriptText = '';
let transcriptBoxVisible = false;
let overlayMousePassthrough = true;
let transcriptLoading = null;
let transcriptRephraseBtn = null;

// Head tracking state
let sensitivity = 15;

// Cursor smoothing with exponential moving average
const ALPHA_POS = 0.2;  // Smoothing factor for cursor position
let cursorX = null;
let cursorY = null;

// Manual movement detection
let lastManualMoveTime = 0;
const MANUAL_THRESHOLD = 20;  // pixels
const MANUAL_PAUSE_DURATION = 1000;  // ms

// Tracking box for iris mapping (relative to frame dimensions)
const BOX_W_RATIO = 0.4;
const BOX_H_RATIO = 0.4;
const BOX_X_RATIO = 0.3;
const BOX_Y_RATIO = 0.3;

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
const SCROLL_SENSITIVITY = 35;

// Non-linear acceleration: small head movements = precision, large = fast jumps
function accelerate(delta) {
  const abs = Math.abs(delta);
  const sign = Math.sign(delta);
  if (abs < 0.18) return sign * abs * 0.6;                      // finer control near rest
  if (abs < 0.45) return sign * (0.108 + (abs - 0.18) * 0.95);   // gentler ramp
  return sign * (0.378 + (abs - 0.45) * 1.4);                    // cap large jumps
}

function setOverlayMousePassthrough(shouldPassthrough) {
  if (overlayMousePassthrough === shouldPassthrough) {
    return;
  }
  overlayMousePassthrough = shouldPassthrough;
  window.electronAPI.setOverlayMousePassthrough(shouldPassthrough).catch((err) => {
    console.error('[Overlay] Failed to toggle mouse passthrough:', err);
  });
}

const statusElements = { eye: null, speech: null, vsr: null, calibration: null, click: null, scroll: null, drag: null };
const buttons = { start: null, stop: null, recenter: null, toggleVideo: null, toggleSpeech: null };

let faceMesh, camera, videoElement, canvasElement, canvasCtx;

// Blink Detection - using iris landmarks for more reliable detection
const RIGHT_EYE = [33, 160, 158, 133, 153, 144];
const LEFT_EYE = [362, 385, 387, 263, 373, 380];
const BLINK_CLOSE_THRESHOLD = 0.20; // Increased from 0.18 for easier detection
const BLINK_OPEN_THRESHOLD = 0.25; // Increased from 0.24
const CLICK_COOLDOWN = 800;  // ms between clicks
let lastLeftClickTime = 0;
let lastRightClickTime = 0;

// Drag state - now using double-blink toggle
let isDragging = false;
let leftEyeWasOpen = true;
let rightEyeWasOpen = true;
let leftCloseStart = null;
let rightCloseStart = null;
let leftHoldTriggered = false;
let rightHoldTriggered = false;
const HOLD_TRIGGER_MS = 1500; // Hold wink for 1.5s to trigger special actions

// Gaze trigger state
let gazeCircle = null;
let gazeBars = null;
let currentGazeZone = null;
let gazeStartTime = 0;
const GAZE_TRIGGER_MS = 800; // Hold gaze for 800ms to trigger
const GAZE_BAR_THRESHOLD = 60; // pixels from edge
let lastScrollTime = 0;
const SCROLL_REPEAT_MS = 150; // Continuous scroll interval after initial trigger
let gazeTriggered = false; // Track if initial trigger happened

// Action feedback overlay
let actionFeedback = null;
let feedbackTimeout = null;

function showActionFeedback(message, type = 'default') {
  if (!actionFeedback) return;
  
  // Clear previous timeout
  if (feedbackTimeout) clearTimeout(feedbackTimeout);
  
  // Update message and style
  actionFeedback.textContent = message;
  actionFeedback.className = 'show ' + type;
  
  // Auto-hide after 1 second
  feedbackTimeout = setTimeout(() => {
    actionFeedback.classList.remove('show');
  }, 1000);
}

function updateStatus(element, text, color) {
  if (element) { element.textContent = text; element.style.color = color; }
}

function dist(p1, p2) { return Math.hypot(p1.x - p2.x, p1.y - p2.y); }

function calculateEAR(landmarks, idx) {
  return (dist(landmarks[idx[1]], landmarks[idx[5]]) + dist(landmarks[idx[2]], landmarks[idx[4]]))
    / (2.0 * dist(landmarks[idx[0]], landmarks[idx[3]]));
}

function processBlinks(landmarks) {
  if (!isTracking || !landmarks || landmarks.length === 0) return;
  
  const leftEar = calculateEAR(landmarks, LEFT_EYE);
  const rightEar = calculateEAR(landmarks, RIGHT_EYE);
  const now = Date.now();
  
  if (now - lastManualMoveTime <= MANUAL_PAUSE_DURATION) {
    return;
  }
  
  const leftClosed = leftEar < BLINK_CLOSE_THRESHOLD;
  const leftOpen = leftEar > BLINK_OPEN_THRESHOLD;
  const rightClosed = rightEar < BLINK_CLOSE_THRESHOLD;
  const rightOpen = rightEar > BLINK_OPEN_THRESHOLD;
  
  // Left eye interactions
  if (leftClosed && rightOpen) {
    if (!leftCloseStart) {
      leftCloseStart = now;
      leftHoldTriggered = false;
    }
    if (!leftHoldTriggered && now - leftCloseStart >= HOLD_TRIGGER_MS) {
      if (!isDragging) {
        isDragging = true;
        leftHoldTriggered = true;
        console.log('[LeftHold] Drag START');
        window.electronAPI.mouseDown('left');
        updateStatus(statusElements.drag, 'Dragging (Blink to stop)', '#4ecca3');
        showActionFeedback('DRAG ON', 'drag');
      }
    }
    leftEyeWasOpen = false;
  }
  
  if (leftOpen && !leftEyeWasOpen) {
    const heldDuration = leftCloseStart ? now - leftCloseStart : 0;
    if (!leftHoldTriggered) {
      if (isDragging) {
        isDragging = false;
        console.log('[LeftBlink] Drag STOP');
        window.electronAPI.mouseUp('left');
        updateStatus(statusElements.drag, 'Ready', '#a0a0a0');
        showActionFeedback('DRAG OFF', 'drag');
        setTimeout(() => {
          window.electronAPI.copySelection();
          updateStatus(statusElements.click, 'Copied Selection', '#4ecca3');
          showActionFeedback('COPY', 'click');
          setTimeout(() => updateStatus(statusElements.click, 'Waiting...', '#a0a0a0'), 600);
        }, 80);
      } else {
        window.electronAPI.mouseClick('left');
        updateStatus(statusElements.click, 'Left Click', '#4ecca3');
        showActionFeedback('CLICK', 'click');
        setTimeout(() => updateStatus(statusElements.click, 'Waiting...', '#a0a0a0'), 500);
      }
    }
    leftEyeWasOpen = true;
    leftCloseStart = null;
    leftHoldTriggered = false;
  }
  
  // Right eye interactions
  if (rightClosed && leftOpen) {
    if (!rightCloseStart) {
      rightCloseStart = now;
      rightHoldTriggered = false;
    }
    if (!rightHoldTriggered && now - rightCloseStart >= HOLD_TRIGGER_MS && now - lastRightClickTime > CLICK_COOLDOWN) {
      rightHoldTriggered = true;
      window.electronAPI.pasteClipboard();
      updateStatus(statusElements.click, 'Paste', '#a855f7');
      showActionFeedback('PASTE', 'click');
      lastRightClickTime = now;
      setTimeout(() => updateStatus(statusElements.click, 'Waiting...', '#a0a0a0'), 500);
    }
    rightEyeWasOpen = false;
  }
  
  if (rightOpen && !rightEyeWasOpen) {
    rightEyeWasOpen = true;
    rightCloseStart = null;
    rightHoldTriggered = false;
  }
  
  // Right eye wink = right click (disabled while dragging)
  if (!isDragging && rightClosed && leftOpen && !rightHoldTriggered) {
    if (now - lastRightClickTime > CLICK_COOLDOWN) {
      window.electronAPI.mouseClick('right');
      lastRightClickTime = now;
      updateStatus(statusElements.click, "Right Click", "#667eea");
      setTimeout(() => {
        if (Date.now() - lastRightClickTime >= 1000) {
          updateStatus(statusElements.click, "Waiting...", "#a0a0a0");
        }
      }, 1000);
    }
  }
}

async function refreshBoundsCache() {
  const r = await window.electronAPI.getScreenBounds();
  if (r.success) { cachedBounds = r.bounds; boundsCacheTime = Date.now(); }
}

// Use iris landmarks (468, 473) for precise eye tracking
const IRIS_LEFT = 468;
const IRIS_RIGHT = 473;

function detectGazeZone(x, y) {
  if (!cachedBounds) return null;
  
  const screenW = cachedBounds.width;
  const screenH = cachedBounds.height;
  
  // Check if cursor is in trigger zones
  if (y < GAZE_BAR_THRESHOLD && x > screenW * 0.2 && x < screenW * 0.8) {
    return 'top';
  }
  if (y > screenH - GAZE_BAR_THRESHOLD && x > screenW * 0.2 && x < screenW * 0.8) {
    return 'bottom';
  }
  if (x < GAZE_BAR_THRESHOLD && y > screenH * 0.2 && y < screenH * 0.8) {
    return 'left';
  }
  if (x > screenW - GAZE_BAR_THRESHOLD && y > screenH * 0.2 && y < screenH * 0.8) {
    return 'right';
  }
  return null;
}

function updateGazeUI(x, y, zone) {
  if (!gazeCircle || !gazeBars) return;
  
  const now = Date.now();
  
  if (zone) {
    // Show circle at cursor position
    gazeCircle.style.left = x + 'px';
    gazeCircle.style.top = y + 'px';
    gazeCircle.classList.add('active');
    
    // Check if we're holding gaze
    if (zone === currentGazeZone) {
      const gazeDuration = now - gazeStartTime;
      if (gazeTriggered) {
        // Already triggered - continuous scroll for top/bottom zones
        if ((zone === 'top' || zone === 'bottom') && now - lastScrollTime >= SCROLL_REPEAT_MS) {
          triggerGazeAction(zone);
          lastScrollTime = now;
        }
      } else if (gazeDuration >= GAZE_TRIGGER_MS) {
        gazeCircle.classList.add('filling');
        triggerGazeAction(zone);
        gazeTriggered = true;
        lastScrollTime = now;
        // Don't reset zone - allow continuous scrolling
      } else {
        // Partial fill based on progress
        const progress = gazeDuration / GAZE_TRIGGER_MS;
        if (progress > 0.5) {
          gazeCircle.classList.add('filling');
        }
      }
    } else {
      currentGazeZone = zone;
      gazeStartTime = now;
      gazeTriggered = false;
      gazeCircle.classList.remove('filling');
    }
    
    // Highlight the bar
    document.querySelectorAll('.gaze-bar').forEach(bar => bar.classList.remove('triggered'));
    const barClass = '.gaze-bar-' + zone;
    const bar = document.querySelector(barClass);
    if (bar) bar.classList.add('triggered');
  } else {
    gazeCircle.classList.remove('active', 'filling');
    currentGazeZone = null;
    gazeStartTime = 0;
    gazeTriggered = false;
    document.querySelectorAll('.gaze-bar').forEach(bar => bar.classList.remove('triggered'));
  }
}

function triggerGazeAction(zone) {
  switch(zone) {
    case 'top':
      // Scroll up
      window.electronAPI.scroll(0, 15);
      updateStatus(statusElements.scroll, 'Scrolling Up', '#4ecca3');
      showActionFeedback('SCROLL ▲', 'scroll');
      setTimeout(() => updateStatus(statusElements.scroll, 'Move to scroll', '#a0a0a0'), 500);
      break;
    case 'bottom':
      // Scroll down
      window.electronAPI.scroll(0, -15);
      updateStatus(statusElements.scroll, 'Scrolling Down', '#4ecca3');
      showActionFeedback('SCROLL ▼', 'scroll');
      setTimeout(() => updateStatus(statusElements.scroll, 'Move to scroll', '#a0a0a0'), 500);
      break;
    case 'left':
      // Alt+Tab left (previous window) - macOS uses Cmd+Shift+Tab
      window.electronAPI.altTab('left');
      updateStatus(statusElements.click, 'Switch App ←', '#a855f7');
      showActionFeedback('APP ◀', 'click');
      setTimeout(() => updateStatus(statusElements.click, 'Waiting...', '#a0a0a0'), 500);
      break;
    case 'right':
      // Alt+Tab right (next window) - macOS uses Cmd+Tab
      window.electronAPI.altTab('right');
      updateStatus(statusElements.click, 'Switch App →', '#a855f7');
      showActionFeedback('APP ▶', 'click');
      setTimeout(() => updateStatus(statusElements.click, 'Waiting...', '#a0a0a0'), 500);
      break;
  }
}

function processLandmarks(landmarks) {
  if (!isTracking || !landmarks || landmarks.length === 0) return;
  if (Date.now() - boundsCacheTime > BOUNDS_CACHE_MS) refreshBoundsCache();
  if (!cachedBounds) return;

  const videoElement = document.getElementsByClassName('input_video')[0];
  if (!videoElement) return;
  
  const fw = videoElement.videoWidth || 320;
  const fh = videoElement.videoHeight || 240;
  
  // Get iris center position in frame coordinates
  // Note: Camera feed is mirrored, so we need to flip X coordinate
  const irisXRaw = (landmarks[IRIS_LEFT].x + landmarks[IRIS_RIGHT].x) / 2.0;
  const irisX = (1.0 - irisXRaw) * fw;  // Flip X axis
  const irisY = (landmarks[IRIS_LEFT].y + landmarks[IRIS_RIGHT].y) / 2.0 * fh;
  
  // Define tracking box (center region of frame)
  const boxW = fw * BOX_W_RATIO;
  const boxH = fh * BOX_H_RATIO;
  const boxX = fw * BOX_X_RATIO;
  const boxY = fh * BOX_Y_RATIO;
  
  // Map iris position within box to screen coordinates
  const targetX = (irisX - boxX) / boxW * cachedBounds.width;
  const targetY = (irisY - boxY) / boxH * cachedBounds.height;
  
  // Clamp to screen bounds
  const clampedX = Math.max(0, Math.min(cachedBounds.width - 1, targetX));
  const clampedY = Math.max(0, Math.min(cachedBounds.height - 1, targetY));
  
  // Initialize cursor position on first run
  if (cursorX === null || cursorY === null) {
    cursorX = clampedX;
    cursorY = clampedY;
    updateStatus(statusElements.calibration, 'Tracking Active', '#4ecca3');
    return;
  }
  
  // Apply exponential smoothing
  cursorX = cursorX + ALPHA_POS * (clampedX - cursorX);
  cursorY = cursorY + ALPHA_POS * (clampedY - cursorY);
  
  // Check for gaze zones
  const gazeZone = detectGazeZone(cursorX, cursorY);
  updateGazeUI(cursorX, cursorY, gazeZone);
  
  moveCursor(cursorX, cursorY);
}

function doScroll(rawDX, rawDY) {
  if (pendingScroll) return;
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

function moveCursor(targetX, targetY) {
  if (!cachedBounds || pendingMove) return;
  
  const now = Date.now();

  pendingMove = true;
  window.electronAPI.moveCursor(Math.round(targetX), Math.round(targetY)).then((r) => {
    pendingMove = false;
    if (r && r.unavailable) {
      if (!mouseControlUnavailableShown) {
        mouseControlUnavailableShown = true;
        updateStatus(statusElements.eye, 'Mouse control unavailable', '#e74c3c');
      }
    } else if (r && r.paused) {
      lastManualMoveTime = now;
      updateStatus(statusElements.eye, 'Paused (Manual Override)', '#f39c12');
    } else {
      if (now - lastStatusUpdate > STATUS_UPDATE_INTERVAL_MS) {
        lastStatusUpdate = now;
        updateStatus(statusElements.eye, `Tracking (${Math.round(targetX)}, ${Math.round(targetY)})`, '#4ecca3');
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
        // Draw iris centers
        const irisLeft = landmarks[468];
        const irisRight = landmarks[473];
        
        canvasCtx.beginPath();
        canvasCtx.arc(irisLeft.x * canvasElement.width, irisLeft.y * canvasElement.height, 3, 0, 2 * Math.PI);
        canvasCtx.fillStyle = '#4ecca3';
        canvasCtx.fill();
        
        canvasCtx.beginPath();
        canvasCtx.arc(irisRight.x * canvasElement.width, irisRight.y * canvasElement.height, 3, 0, 2 * Math.PI);
        canvasCtx.fillStyle = '#4ecca3';
        canvasCtx.fill();
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
  console.log('[Init] Starting MediaPipe initialization...');
  updateStatus(statusElements.eye, 'Loading MediaPipe...', '#f39c12');
  
  try {
    videoElement = document.getElementsByClassName('input_video')[0];
    canvasElement = document.getElementsByClassName('output_canvas')[0];
    
    if (!videoElement) {
      throw new Error('Video element not found');
    }
    if (!canvasElement) {
      throw new Error('Canvas element not found');
    }
    
    videoElement.width = CAMERA_WIDTH;
    videoElement.height = CAMERA_HEIGHT;
    canvasElement.width = CAMERA_WIDTH;
    canvasElement.height = CAMERA_HEIGHT;

    canvasCtx = canvasElement.getContext('2d');
    console.log('[Init] Video and canvas elements found');

    // Check if FaceMesh is available
    if (typeof FaceMesh === 'undefined') {
      throw new Error('FaceMesh class not loaded - MediaPipe scripts may not have loaded');
    }
    
    console.log('[Init] Creating FaceMesh instance...');
    faceMesh = new FaceMesh({ locateFile: (file) => `mediapipe/face_mesh/${file}` });
    
    console.log('[Init] Setting FaceMesh options...');
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    
    console.log('[Init] Registering onResults callback...');
    faceMesh.onResults(onResults);

    updateStatus(statusElements.eye, 'Ready - Click Start', '#a0a0a0');
    console.log('[Init] MediaPipe initialized successfully');
  } catch (error) {
    console.error('[Init] Error initializing MediaPipe:', error);
    updateStatus(statusElements.eye, `Init failed: ${error.message}`, '#e94560');
  }
}

async function startTracking() {
  if (!faceMesh) { updateStatus(statusElements.eye, 'Tracker not loaded', '#e94560'); return; }
  try {
    updateStatus(statusElements.eye, 'Starting camera...', '#f39c12');
    camera = new Camera(videoElement, {
      onFrame: async () => { await faceMesh.send({ image: videoElement }); },
      width: CAMERA_WIDTH,
      height: CAMERA_HEIGHT
    });
    await refreshBoundsCache();
    await camera.start();
    isTracking = true;
    cursorX = null;
    cursorY = null;
    
    // Show camera view by default
    videoVisible = true;
    const videoContainer = document.getElementById('video-container');
    if (videoContainer) videoContainer.classList.add('visible');
    
    updateStatus(statusElements.eye, 'Tracking Active', '#4ecca3');
    updateStatus(statusElements.calibration, 'Initializing...', '#f39c12');
    if (buttons.start) buttons.start.disabled = true;
    if (buttons.stop) buttons.stop.disabled = false;
    if (buttons.recenter) buttons.recenter.disabled = false;
    if (buttons.toggleVideo) buttons.toggleVideo.disabled = false;

    // Don't auto-start speech mode - user will activate when needed
    // Speech mode will be enabled when user focuses on an input field
  } catch (error) {
    console.error('Error starting camera:', error);
    updateStatus(statusElements.eye, 'Camera Error: ' + error.message, '#e94560');
    isTracking = false;
  }
}

async function stopTracking() {
  if (camera) camera.stop();
  isTracking = false;
  updateStatus(statusElements.eye, 'Tracking Stopped', '#a0a0a0');
  if (buttons.start) buttons.start.disabled = false;
  if (buttons.stop) buttons.stop.disabled = true;
  if (buttons.recenter) buttons.recenter.disabled = true;
  if (buttons.toggleVideo) buttons.toggleVideo.disabled = true;

  // Hide camera view when tracking stops
  videoVisible = false;
  const videoContainer = document.getElementById('video-container');
  if (videoContainer) videoContainer.classList.remove('visible');
  
  // Hide gaze circle
  if (gazeCircle) gazeCircle.classList.remove('active', 'filling');
}

function recenter() {
  if (!isTracking) { alert('Please start tracking first'); return; }
  cursorX = null;
  cursorY = null;
  updateStatus(statusElements.calibration, 'Recalibrating...', '#f39c12');
}

function toggleVideoPreview() {
  videoVisible = !videoVisible;
  const container = document.getElementById('video-container');
  container.classList.toggle('visible', videoVisible);
}

window.addEventListener('load', () => {
  statusElements.eye = document.getElementById('eye-status');
  statusElements.speech = document.getElementById('speech-status');
  statusElements.vsr = document.getElementById('vsr-status');
  statusElements.calibration = document.getElementById('calibration-status');
  statusElements.click = document.getElementById('click-status');
  statusElements.scroll = document.getElementById('scroll-status');
  statusElements.drag = document.getElementById('drag-status');
  buttons.start = document.getElementById('start-tracking');
  buttons.stop = document.getElementById('stop-tracking');
  buttons.recenter = document.getElementById('recenter');
  buttons.toggleVideo = document.getElementById('toggle-video');
  buttons.toggleSpeech = document.getElementById('toggle-speech');
  
  // Initialize gaze UI elements
  gazeCircle = document.getElementById('gaze-circle');
  gazeBars = document.getElementById('gaze-bars');
  actionFeedback = document.getElementById('action-feedback');
  
  // Initialize transcript box elements
  transcriptBox = document.getElementById('transcript-box');
  transcriptContent = document.getElementById('transcript-content');
  transcriptLoading = document.getElementById('transcript-loading');
  
  // Wire up transcript box buttons
  const transcriptClear = document.getElementById('transcript-clear');
  transcriptRephraseBtn = document.getElementById('transcript-rephrase');
  const transcriptSubmit = document.getElementById('transcript-submit');
  
  if (transcriptBox) {
    transcriptBox.addEventListener('mouseenter', () => {
      setOverlayMousePassthrough(false);
    });
    transcriptBox.addEventListener('mouseleave', () => {
      if (transcriptBoxVisible) {
        setOverlayMousePassthrough(true);
      }
    });
  }

  if (transcriptClear) {
    transcriptClear.addEventListener('click', () => {
      transcriptText = '';
      if (transcriptContent) transcriptContent.textContent = '';
      hideTranscriptBox();
    });
  }
  
  if (transcriptRephraseBtn) {
    transcriptRephraseBtn.addEventListener('click', async () => {
      if (!transcriptText.trim()) return;
      await rephraseTranscript();
    });
  }
  
  if (transcriptSubmit) {
    transcriptSubmit.addEventListener('click', async () => {
      if (!transcriptText.trim()) return;
      await submitTranscript();
    });
  }
  
  // Text mode events remain available for UI/telemetry if needed
  window.electronAPI.onTextModeChanged((isTextMode) => {
    console.log('[TextMode] Changed to:', isTextMode);
  });

  const sensitivitySlider = document.getElementById('sensitivity-slider');
  const sensitivityValue = document.getElementById('sensitivity-value');
  if (sensitivitySlider) {
    sensitivity = parseInt(sensitivitySlider.value);
    sensitivitySlider.addEventListener('input', (e) => {
      sensitivity = parseInt(e.target.value);
      if (sensitivityValue) sensitivityValue.textContent = sensitivity;
    });
  }

  // Auto-start tracking in overlay mode
  setTimeout(() => {
    if (!isTracking) {
      startTracking();
    }
  }, 1000);
  
  // Load speech settings and setup engine selector
  const speechEngineSelect = document.getElementById('speech-engine-select');
  if (speechEngineSelect) {
    // Load current settings
    window.electronAPI.getSpeechSettings().then(result => {
      if (result.success) {
        speechSettings = result.settings;
        speechEngineSelect.value = speechSettings.engine;
        
        // Disable Google option if not available
        if (!speechSettings.googleAvailable) {
          const googleOption = speechEngineSelect.querySelector('option[value="google"]');
          if (googleOption) {
            googleOption.textContent = 'Google Speech-to-Text v2 (API key required)';
            googleOption.disabled = true;
          }
        }
      }
    });
    
    // Handle engine change
    speechEngineSelect.addEventListener('change', async (e) => {
      const newEngine = e.target.value;
      const result = await window.electronAPI.updateSpeechSettings({ engine: newEngine });
      if (result.success) {
        speechSettings = result.settings;
        console.log('[Speech] Engine changed to:', newEngine);
        updateStatus(statusElements.speech, `Engine: ${newEngine === 'google' ? 'Google' : 'Whisper'}`, '#a0a0a0');
      } else {
        console.error('[Speech] Failed to change engine:', result.error);
        // Revert selection
        speechEngineSelect.value = speechSettings.engine;
      }
    });
  }

  updateStatus(statusElements.vsr, 'Ready (Ctrl+R to record)', '#a0a0a0');
  if (buttons.start) buttons.start.addEventListener('click', startTracking);
  if (buttons.stop) { buttons.stop.addEventListener('click', stopTracking); buttons.stop.disabled = true; }
  if (buttons.recenter) { buttons.recenter.addEventListener('click', recenter); buttons.recenter.disabled = true; }
  if (buttons.toggleVideo) { buttons.toggleVideo.addEventListener('click', toggleVideoPreview); buttons.toggleVideo.disabled = true; }
  if (buttons.toggleSpeech) buttons.toggleSpeech.addEventListener('click', toggleSpeech);

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
  setTimeout(() => {
    if (!isSpeechActive) {
      startSpeech().catch((err) => console.error('[Speech] Auto-start failed:', err));
    }
  }, 1200);

  // Listen for commands from Control Panel
  window.electronAPI.onControlCommand((command, value) => {
    switch(command) {
      case 'toggle-tracking':
        if (isTracking) stopTracking(); else startTracking();
        break;
      case 'recenter':
        recenter();
        break;
      case 'toggle-video':
        toggleVideoPreview();
        break;
      case 'toggle-speech':
        toggleSpeech();
        break;
      case 'set-sensitivity':
        sensitivity = parseInt(value);
        const sSlider = document.getElementById('sensitivity-slider');
        const sValue = document.getElementById('sensitivity-value');
        if (sSlider) sSlider.value = sensitivity;
        if (sValue) sValue.textContent = sensitivity;
        break;
      case 'get-status':
        sendOverlayStatus();
        break;
    }
    // Small delay to allow state to update
    setTimeout(sendOverlayStatus, 50);
  });

  // Send initial status
  setTimeout(sendOverlayStatus, 1500);
});

function sendOverlayStatus() {
  window.electronAPI.sendOverlayStatus({
    isTracking,
    videoVisible,
    sensitivity,
    speechActive: isSpeechActive,
    vsrRecording: isVSRRecording
  });
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
  updateStatus(statusElements.vsr, 'Recording...', '#e94560');
  console.log('[VSR] Recording started');

  // Lazily create a reusable capture canvas scaled to VSR_CAPTURE_WIDTH
  if (!vsrCanvas) {
    vsrCanvas = document.createElement('canvas');
    vsrCanvasCtx = vsrCanvas.getContext('2d');
  }
  const aspect = videoElement.videoHeight / (videoElement.videoWidth || 1);
  vsrCanvas.width = VSR_CAPTURE_WIDTH;
  vsrCanvas.height = Math.round(VSR_CAPTURE_WIDTH * aspect);

  // Capture frames at VSR_FPS
  vsrFrameInterval = setInterval(async () => {
    if (!isVSRRecording || !videoElement) return;

    try {
      // Convert to grayscale to match what the VSR model expects
      vsrCanvasCtx.filter = 'grayscale(1)';
      vsrCanvasCtx.drawImage(videoElement, 0, 0, vsrCanvas.width, vsrCanvas.height);
      vsrCanvasCtx.filter = 'none';
      const frameData = vsrCanvas.toDataURL('image/jpeg', 0.25);
      await window.electronAPI.vsrAddFrame(frameData);
      vsrFrameCount++;

      if (vsrFrameCount % 4 === 0) {
        updateStatus(statusElements.vsr, `Recording... (${vsrFrameCount} frames)`, '#e94560');
      }
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

  updateStatus(statusElements.vsr, 'Processing...', '#f39c12');
  console.log(`[VSR] Recording stopped. Captured ${vsrFrameCount} frames`);

  const result = await window.electronAPI.vsrStopRecording();
  if (result.success && result.result) {
    const output = result.result.text || 'No output';
    console.log('[VSR] Output:', output);
    updateStatus(statusElements.vsr, output, '#4ecca3');
    
    // Send VSR transcript to keyboard (typed output)
    if (output && output !== 'No output') {
      await window.electronAPI.typeText(output);
      console.log('[VSR] Typed output:', output);
    }

    // Reset status after 5 seconds
    setTimeout(() => {
      if (!isVSRRecording) {
        updateStatus(statusElements.vsr, 'Ready (Ctrl+R to record)', '#a0a0a0');
      }
    }, 5000);
  } else {
    updateStatus(statusElements.vsr, 'Recording too short or error', '#e94560');
    setTimeout(() => {
      if (!isVSRRecording) {
        updateStatus(statusElements.vsr, 'Ready (Ctrl+R to record)', '#a0a0a0');
      }
    }, 3000);
  }

  vsrFrameCount = 0;
}

// Speech-to-Text Functions
async function toggleSpeech() {
  if (isSpeechActive) {
    await stopSpeech();
  } else {
    await startSpeech();
  }
}

function updateSpeechMonitoringStatus(messageOverride) {
  if (!statusElements.speech) return;
  if (!isSpeechActive) {
    updateStatus(statusElements.speech, 'Voice control off (click to enable)', '#a0a0a0');
    return;
  }
  if (messageOverride) {
    updateStatus(statusElements.speech, messageOverride.text, messageOverride.color);
    return;
  }
  if (speechEngineStarting) {
    updateStatus(statusElements.speech, 'Voice detected – starting STT…', '#f39c12');
  } else if (speechEngineRunning) {
    updateStatus(statusElements.speech, 'Listening (voice detected)', '#4ecca3');
  } else {
    updateStatus(statusElements.speech, 'Monitoring (silence)…', '#a0a0a0');
  }
}

async function ensureSpeechEngineStarted() {
  if (speechEngineRunning || speechEngineStarting || !isSpeechActive) return;
  speechEngineStarting = true;
  updateSpeechMonitoringStatus();
  try {
    const result = await window.electronAPI.speechStart('base');
    if (result.success) {
      speechEngineRunning = true;
      console.log('[Speech] Engine engaged (voice detected)');
      updateSpeechMonitoringStatus();
    } else {
      throw new Error(result.error || 'Failed to start speech');
    }
  } catch (error) {
    console.error('[Speech] Error starting engine:', error);
    updateStatus(statusElements.speech, `Engine error: ${error.message}`, '#e94560');
  } finally {
    speechEngineStarting = false;
  }
}

async function stopSpeechEngineInternal() {
  if ((!speechEngineRunning && !speechEngineStarting) || speechEngineStopping) return;
  speechEngineStopping = true;
  try {
    await window.electronAPI.speechStop();
  } catch (error) {
    console.error('[Speech] Error stopping engine:', error);
  } finally {
    speechEngineRunning = false;
    speechEngineStopping = false;
    if (isSpeechActive) {
      updateSpeechMonitoringStatus();
    }
  }
}

function processAudioForVAD(inputData) {
  if (!isSpeechActive) return;
  let energy = 0;
  for (let i = 0; i < inputData.length; i++) {
    const sample = inputData[i];
    energy += sample * sample;
  }
  const rms = Math.sqrt(energy / inputData.length);
  const now = Date.now();

  if (rms >= VAD_START_THRESHOLD) {
    lastVoiceDetected = now;
    if (!vadIsSpeaking) {
      vadIsSpeaking = true;
      updateStatus(statusElements.speech, 'Voice detected…', '#4ecca3');
    }
    ensureSpeechEngineStarted();
  }

  if (speechEngineRunning) {
    const pcmData = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]));
      pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    window.electronAPI.speechFeedAudio(pcmData.buffer).catch((err) => {
      console.error('[Speech] Feed audio failed:', err);
    });
  }

  if (vadIsSpeaking && now - lastVoiceDetected > VAD_SILENCE_TIMEOUT_MS) {
    vadIsSpeaking = false;
    updateSpeechMonitoringStatus();
    stopSpeechEngineInternal();
  } else if (!speechEngineRunning && !speechEngineStarting) {
    updateSpeechMonitoringStatus();
  }
}

async function startSpeech() {
  if (isSpeechActive) {
    updateSpeechMonitoringStatus();
    return;
  }
  try {
    updateStatus(statusElements.speech, 'Enabling microphone…', '#f39c12');

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: SPEECH_SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    });

    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: SPEECH_SAMPLE_RATE
    });

    speechSourceNode = audioContext.createMediaStreamSource(micStream);
    speechProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    speechProcessor.onaudioprocess = (e) => {
      processAudioForVAD(e.inputBuffer.getChannelData(0));
    };
    speechSourceNode.connect(speechProcessor);
    speechProcessor.connect(audioContext.destination);

    isSpeechActive = true;
    vadIsSpeaking = false;
    lastVoiceDetected = 0;
    updateSpeechMonitoringStatus();
    console.log('[Speech] Voice monitoring enabled');
  } catch (error) {
    console.error('[Speech] Error enabling microphone:', error);
    updateStatus(statusElements.speech, `Error: ${error.message}`, '#e94560');
    cleanupSpeechResources();
  }
}

function cleanupSpeechResources() {
  if (speechProcessor) {
    speechProcessor.disconnect();
    speechProcessor.onaudioprocess = null;
    speechProcessor = null;
  }
  if (speechSourceNode) {
    speechSourceNode.disconnect();
    speechSourceNode = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
}

async function stopSpeech() {
  if (!isSpeechActive && !speechEngineRunning && !speechEngineStarting) {
    updateSpeechMonitoringStatus();
    return;
  }
  try {
    updateStatus(statusElements.speech, 'Disabling voice control…', '#f39c12');
    await stopSpeechEngineInternal();
    cleanupSpeechResources();
    isSpeechActive = false;
    vadIsSpeaking = false;
    lastVoiceDetected = 0;
    updateSpeechMonitoringStatus();
    console.log('[Speech] Voice monitoring disabled');
  } catch (error) {
    console.error('[Speech] Error stopping voice control:', error);
    updateStatus(statusElements.speech, 'Error stopping voice control', '#e94560');
  }
}

// Transcript box functions
function showTranscriptBox(x, y) {
  if (!transcriptBox) return;
  
  const OFFSET = 20;
  const { innerWidth, innerHeight } = window;
  const rect = transcriptBox.getBoundingClientRect();
  const width = rect.width || 320;
  const height = rect.height || 200;
  const targetX = Math.min(Math.max(0, x + OFFSET), innerWidth - width - OFFSET);
  const targetY = Math.min(Math.max(0, y + OFFSET), innerHeight - height - OFFSET);
  transcriptBox.style.left = `${targetX}px`;
  transcriptBox.style.top = `${targetY}px`;
  transcriptBox.style.display = 'block';
  transcriptBoxVisible = true;
}

function hideTranscriptBox() {
  if (!transcriptBox) return;
  
  transcriptBox.style.display = 'none';
  transcriptBoxVisible = false;
  transcriptText = '';
  if (transcriptContent) transcriptContent.textContent = '';
  setOverlayMousePassthrough(true);
}

function setTranscriptLoading(isLoading) {
  if (!transcriptLoading) return;
  transcriptLoading.classList.toggle('active', isLoading);
  if (transcriptRephraseBtn) {
    transcriptRephraseBtn.disabled = isLoading;
    transcriptRephraseBtn.textContent = isLoading ? '…' : '✨';
  }
}

function addToTranscript(text) {
  if (!text || !text.trim()) return;
  
  transcriptText += text;
  if (transcriptContent) {
    transcriptContent.textContent = transcriptText;
    transcriptContent.scrollTop = transcriptContent.scrollHeight;
  }
  
  if (!transcriptBoxVisible) {
    window.electronAPI.getCursorPosition().then(pos => {
      showTranscriptBox(pos.x, pos.y);
    }).catch(err => {
      console.error('[Transcript] Failed to get cursor position:', err);
      showTranscriptBox(100, 100);
    });
  }
}

async function rephraseTranscript() {
  if (!transcriptText.trim()) return;
  
  try {
    setTranscriptLoading(true);
    updateStatus(statusElements.speech, 'Rephrasing with Gemini...', '#a855f7');
    const result = await window.electronAPI.rephraseText(transcriptText);
    
    if (result.success) {
      transcriptText = result.text;
      if (transcriptContent) {
        transcriptContent.textContent = transcriptText;
      }
      updateStatus(statusElements.speech, 'Rephrased!', '#4ecca3');
      setTimeout(() => updateSpeechMonitoringStatus(), 1000);
    } else {
      console.error('[Transcript] Rephrase failed:', result.error);
      updateStatus(statusElements.speech, 'Rephrase failed', '#e94560');
      setTimeout(() => updateSpeechMonitoringStatus(), 2000);
    }
  } catch (error) {
    console.error('[Transcript] Rephrase error:', error);
    updateStatus(statusElements.speech, 'Rephrase error', '#e94560');
    setTimeout(() => updateSpeechMonitoringStatus(), 2000);
  } finally {
    setTranscriptLoading(false);
  }
}

async function submitTranscript() {
  if (!transcriptText.trim()) return;
  
  try {
    await window.electronAPI.typeText(transcriptText);
    console.log('[Transcript] Submitted:', transcriptText);
    hideTranscriptBox();
    updateStatus(statusElements.speech, 'Transcript submitted', '#4ecca3');
    setTimeout(() => updateSpeechMonitoringStatus(), 1000);
  } catch (error) {
    console.error('[Transcript] Submit error:', error);
    updateStatus(statusElements.speech, 'Submit error', '#e94560');
    setTimeout(() => updateSpeechMonitoringStatus(), 2000);
  }
}

// Listen for transcript events from main process
window.electronAPI.onSpeechTranscript((transcript) => {
  addToTranscript(transcript);
});
