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
const SPEECH_SAMPLE_RATE = 16000;
let speechSettings = {
  engine: 'whisper',
  whisperModel: 'base',
  googleAvailable: false
};

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
const SCROLL_SENSITIVITY = 600;

// Non-linear acceleration: small head movements = precision, large = fast jumps
function accelerate(delta) {
  const abs = Math.abs(delta);
  const sign = Math.sign(delta);
  if (abs < 0.18) return sign * abs * 0.6;                      // finer control near rest
  if (abs < 0.45) return sign * (0.108 + (abs - 0.18) * 0.95);   // gentler ramp
  return sign * (0.378 + (abs - 0.45) * 1.4);                    // cap large jumps
}

const statusElements = { eye: null, speech: null, vsr: null, calibration: null, click: null, scroll: null, drag: null };
const buttons = { start: null, stop: null, recenter: null, toggleVideo: null, toggleSpeech: null };

let faceMesh, camera, videoElement, canvasElement, canvasCtx;

// Blink Detection - using iris landmarks for more reliable detection
const RIGHT_EYE = [33, 160, 158, 133, 153, 144];
const LEFT_EYE = [362, 385, 387, 263, 373, 380];
const BLINK_CLOSE_THRESHOLD = 0.18;
const BLINK_OPEN_THRESHOLD = 0.24;
const CLICK_COOLDOWN = 800;  // ms between clicks
let lastLeftClickTime = 0;
let lastRightClickTime = 0;

// Drag state
let isDragging = false;
let leftEyeClosed = false;
let leftEyeCloseTime = 0;
let dragPending = false;
const DRAG_HOLD_MS = 400;
const DRAG_RELEASE_DELAY_MS = 100;

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
  
  // Left eye press & hold for drag
  if (leftClosed && rightOpen) {
    if (!leftEyeClosed) {
      leftEyeClosed = true;
      leftEyeCloseTime = now;
      dragPending = true;
    } else if (dragPending && now - leftEyeCloseTime >= DRAG_HOLD_MS) {
      dragPending = false;
      if (!isDragging) {
        isDragging = true;
        window.electronAPI.mouseDown('left');
        updateStatus(statusElements.click, "Dragging...", "#f59e0b");
        updateStatus(statusElements.drag, "Hold left eye closed", "#f59e0b");
      }
    }
  } else if (leftOpen) {
    if (leftEyeClosed) {
      leftEyeClosed = false;
      dragPending = false;
      if (isDragging) {
        setTimeout(() => {
          if (!leftEyeClosed) {
            isDragging = false;
            window.electronAPI.mouseUp('left');
            updateStatus(statusElements.click, "Released", "#4ecca3");
            updateStatus(statusElements.drag, "Ready", "#a0a0a0");
          }
        }, DRAG_RELEASE_DELAY_MS);
      } else if (now - lastLeftClickTime > CLICK_COOLDOWN) {
        window.electronAPI.mouseClick('left');
        lastLeftClickTime = now;
        updateStatus(statusElements.click, "Left Click", "#4ecca3");
        setTimeout(() => {
          if (Date.now() - lastLeftClickTime >= 1000) {
            updateStatus(statusElements.click, "Waiting...", "#a0a0a0");
          }
        }, 1000);
      }
    }
  }
  
  // Right eye wink = right click (disabled while dragging)
  if (!isDragging && rightClosed && leftOpen) {
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

    // Automatically enable speech mode when tracking starts
    if (!isSpeechActive) {
      await startSpeech();
    }
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

  // Stop speech mode if active
  if (isSpeechActive) {
    await stopSpeech();
  }
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

  const sensitivitySlider = document.getElementById('sensitivity-slider');
  const sensitivityValue = document.getElementById('sensitivity-value');
  if (sensitivitySlider) {
    sensitivity = parseInt(sensitivitySlider.value);
    sensitivitySlider.addEventListener('input', (e) => {
      sensitivity = parseInt(e.target.value);
      if (sensitivityValue) sensitivityValue.textContent = sensitivity;
    });
  }

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
});

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
    
    // Try to execute as command instead of typing
    if (output && output !== 'No output') {
      const commandResult = await window.electronAPI.vsrExecuteCommand(output);
      
      if (commandResult.success) {
        const cmd = commandResult.detection.command;
        const conf = Math.round(commandResult.detection.confidence * 100);
        updateStatus(statusElements.vsr, `✓ ${cmd} (${conf}%)`, '#4ecca3');
        console.log('[VSR] Command executed:', cmd);
      } else {
        // No command detected - show the raw output
        updateStatus(statusElements.vsr, `"${output}" (no command)`, '#f39c12');
        console.log('[VSR] No command detected:', output);
      }
    } else {
      updateStatus(statusElements.vsr, 'No output', '#e94560');
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

async function startSpeech() {
  try {
    updateStatus(statusElements.speech, 'Starting microphone...', '#f39c12');
    
    // Request microphone access
    micStream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        sampleRate: SPEECH_SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      } 
    });
    
    // Create audio context
    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: SPEECH_SAMPLE_RATE
    });
    
    const source = audioContext.createMediaStreamSource(micStream);
    
    // Create ScriptProcessor for audio capture (fallback for older browsers)
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    
    processor.onaudioprocess = async (e) => {
      if (!isSpeechActive) return;
      
      const inputData = e.inputBuffer.getChannelData(0);
      
      // Convert float32 [-1, 1] to int16 PCM
      const pcmData = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      
      // Send to main process
      await window.electronAPI.speechFeedAudio(pcmData.buffer);
    };
    
    source.connect(processor);
    processor.connect(audioContext.destination);
    
    // Start the speech transcriber in main process
    const result = await window.electronAPI.speechStart('base');
    
    if (result.success) {
      isSpeechActive = true;
      updateStatus(statusElements.speech, 'Listening...', '#4ecca3');
      console.log('[Speech] Started successfully');
    } else {
      throw new Error(result.error || 'Failed to start speech');
    }
    
  } catch (error) {
    console.error('[Speech] Error starting:', error);
    updateStatus(statusElements.speech, `Error: ${error.message}`, '#e94560');
    
    // Cleanup on error
    if (micStream) {
      micStream.getTracks().forEach(track => track.stop());
      micStream = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    isSpeechActive = false;
  }
}

async function stopSpeech() {
  try {
    updateStatus(statusElements.speech, 'Stopping...', '#f39c12');
    
    // Stop audio capture
    if (micStream) {
      micStream.getTracks().forEach(track => track.stop());
      micStream = null;
    }
    
    if (audioContext) {
      await audioContext.close();
      audioContext = null;
    }
    
    // Stop transcriber in main process
    await window.electronAPI.speechStop();
    
    isSpeechActive = false;
    updateStatus(statusElements.speech, 'Ready (Click to start)', '#a0a0a0');
    console.log('[Speech] Stopped');
    
  } catch (error) {
    console.error('[Speech] Error stopping:', error);
    updateStatus(statusElements.speech, 'Error stopping', '#e94560');
  }
}
