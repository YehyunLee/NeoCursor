// Head Tracking with MediaPipe Face Mesh
let isTracking = false;
let videoVisible = false;

// Head tracking state
let centerPoint = null;
let sensitivity = 15; // How much movement translates to cursor movement (higher = faster)
const DEADZONE = 0.005; // Ignore tiny movements to reduce jitter

// Advanced smoothing
let smoothingBuffer = [];
const SMOOTHING_BUFFER_SIZE = 5;
let lastEmittedX = null;
let lastEmittedY = null;
const SMOOTHING_DEADZONE = 3; // pixels

const statusElements = {
  eye: null,
  speech: null,
  calibration: null
};

const buttons = {
  start: null,
  stop: null,
  recenter: null,
  toggleVideo: null
};

// MediaPipe variables
let faceMesh;
let camera;
let videoElement;
let canvasElement;
let canvasCtx;

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
  
  let targetX = Math.round(avgX);
  let targetY = Math.round(avgY);
  
  // Apply deadzone to prevent micro-jitters
  if (lastEmittedX !== null && lastEmittedY !== null) {
    const dist = Math.hypot(targetX - lastEmittedX, targetY - lastEmittedY);
    if (dist < SMOOTHING_DEADZONE) {
      targetX = lastEmittedX;
      targetY = lastEmittedY;
    }
  }
  
  lastEmittedX = targetX;
  lastEmittedY = targetY;
  
  return { x: targetX, y: targetY };
}

function setCenterPoint(landmarks) {
  // Use nose tip (landmark 1) as the reference point
  if (landmarks && landmarks.length > 0) {
    centerPoint = {
      x: landmarks[1].x,
      y: landmarks[1].y
    };
    updateStatus(statusElements.calibration, 'Center Set', '#4ecca3');
    console.log('Center point set to:', centerPoint);
  }
}

function processLandmarks(landmarks) {
  if (!isTracking || !landmarks || landmarks.length === 0) return;
  
  // If center isn't set yet, set it now
  if (!centerPoint) {
    setCenterPoint(landmarks);
    return;
  }
  
  // Use nose tip (landmark 1) for tracking
  const currentX = landmarks[1].x;
  const currentY = landmarks[1].y;
  
  // Calculate relative movement from center
  let deltaX = (currentX - centerPoint.x) * sensitivity;
  let deltaY = (currentY - centerPoint.y) * sensitivity * 1.5; // Y axis usually needs more sensitivity
  
  // Apply deadzone to raw movement
  if (Math.abs(currentX - centerPoint.x) < DEADZONE) deltaX = 0;
  if (Math.abs(currentY - centerPoint.y) < DEADZONE) deltaY = 0;
  
  // Move cursor if there's significant movement
  if (deltaX !== 0 || deltaY !== 0) {
    moveCursor(deltaX, deltaY);
  }
}

async function moveCursor(deltaX, deltaY) {
  try {
    const result = await window.electronAPI.getScreenBounds();
    if (result.success) {
      // For head tracking, we map the relative movement to screen space
      // We assume the user wants to stay roughly centered and map small head 
      // movements to full screen coverage
      
      const screenWidth = result.bounds.width;
      const screenHeight = result.bounds.height;
      
      // Calculate absolute position based on center of screen + scaled delta
      // Note: we invert X because camera is mirrored
      let targetX = result.bounds.x + (screenWidth / 2) - (deltaX * screenWidth);
      let targetY = result.bounds.y + (screenHeight / 2) + (deltaY * screenHeight);
      
      // Clamp to screen bounds
      targetX = Math.max(result.bounds.x, Math.min(result.bounds.x + screenWidth, targetX));
      targetY = Math.max(result.bounds.y, Math.min(result.bounds.y + screenHeight, targetY));
      
      const smoothed = smoothCoordinates(targetX, targetY);
      
      const moveResult = await window.electronAPI.moveCursor(smoothed.x, smoothed.y);
      
      if (moveResult && moveResult.paused) {
        updateStatus(statusElements.eye, `Paused (Manual Override)`, '#f39c12');
        // Reset center point to avoid sudden jumps when tracking resumes
        centerPoint = null; 
      } else {
        updateStatus(statusElements.eye, `Tracking (${smoothed.x}, ${smoothed.y})`, '#4ecca3');
      }
    }
  } catch (err) {
    console.error('Error moving cursor:', err);
  }
}

function onResults(results) {
  // Draw video frame to canvas
  if (videoVisible && canvasCtx) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(
        results.image, 0, 0, canvasElement.width, canvasElement.height);
    
    // Draw landmarks if found
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      for (const landmarks of results.multiFaceLandmarks) {
        // Draw just the nose tip for feedback
        const nose = landmarks[1];
        canvasCtx.beginPath();
        canvasCtx.arc(nose.x * canvasElement.width, nose.y * canvasElement.height, 5, 0, 2 * Math.PI);
        canvasCtx.fillStyle = '#4ecca3';
        canvasCtx.fill();
        
        // Draw center point if set
        if (centerPoint) {
          canvasCtx.beginPath();
          canvasCtx.arc(centerPoint.x * canvasElement.width, centerPoint.y * canvasElement.height, 5, 0, 2 * Math.PI);
          canvasCtx.fillStyle = '#e94560';
          canvasCtx.fill();
          
          // Draw line between center and current
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
    processLandmarks(results.multiFaceLandmarks[0]);
  }
}

async function initializeTracker() {
  updateStatus(statusElements.eye, 'Loading MediaPipe...', '#f39c12');
  
  try {
    videoElement = document.getElementsByClassName('input_video')[0];
    canvasElement = document.getElementsByClassName('output_canvas')[0];
    canvasCtx = canvasElement.getContext('2d');
    
    faceMesh = new FaceMesh({locateFile: (file) => {
      return `mediapipe/face_mesh/${file}`;
    }});
    
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true, // We need high precision for eye/head tracking
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
  if (!faceMesh) {
    updateStatus(statusElements.eye, 'Tracker not loaded', '#e94560');
    return;
  }

  try {
    updateStatus(statusElements.eye, 'Starting camera...', '#f39c12');
    
    camera = new Camera(videoElement, {
      onFrame: async () => {
        await faceMesh.send({image: videoElement});
      },
      width: 640,
      height: 480
    });
    
    await camera.start();
    isTracking = true;
    centerPoint = null; // Reset center on start
    
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
  if (camera) {
    camera.stop();
  }
  
  isTracking = false;
  smoothingBuffer = [];
  lastEmittedX = null;
  lastEmittedY = null;
  centerPoint = null;
  
  updateStatus(statusElements.eye, 'Stopped', '#a0a0a0');
  updateStatus(statusElements.calibration, 'Not Set', '#a0a0a0');
  
  if (buttons.start) buttons.start.disabled = false;
  if (buttons.stop) buttons.stop.disabled = true;
  if (buttons.recenter) buttons.recenter.disabled = true;
  if (buttons.toggleVideo) buttons.toggleVideo.disabled = true;
}

function recenter() {
  if (!isTracking) {
    alert('Please start tracking first');
    return;
  }
  
  centerPoint = null;
  updateStatus(statusElements.calibration, 'Look at center of screen...', '#f39c12');
}

function toggleVideoPreview() {
  videoVisible = !videoVisible;
  const container = document.getElementById('video-container');
  if (videoVisible) {
    container.classList.add('visible');
  } else {
    container.classList.remove('visible');
  }
  console.log('Video preview', videoVisible ? 'shown' : 'hidden');
}

window.addEventListener('load', () => {
  statusElements.eye = document.getElementById('eye-status');
  statusElements.speech = document.getElementById('speech-status');
  statusElements.calibration = document.getElementById('calibration-status');
  
  buttons.start = document.getElementById('start-tracking');
  buttons.stop = document.getElementById('stop-tracking');
  buttons.recenter = document.getElementById('recenter');
  buttons.toggleVideo = document.getElementById('toggle-video');
  
  const sensitivitySlider = document.getElementById('sensitivity-slider');
  const sensitivityValue = document.getElementById('sensitivity-value');
  
  // Initialize sensitivity from slider default
  if (sensitivitySlider) {
    sensitivity = parseInt(sensitivitySlider.value);
    
    sensitivitySlider.addEventListener('input', (e) => {
      sensitivity = parseInt(e.target.value);
      if (sensitivityValue) {
        sensitivityValue.textContent = sensitivity;
      }
    });
  }
  
  updateStatus(statusElements.speech, 'Coming Soon', '#a0a0a0');
  
  if (buttons.start) {
    buttons.start.addEventListener('click', startTracking);
  }
  
  if (buttons.stop) {
    buttons.stop.addEventListener('click', stopTracking);
    buttons.stop.disabled = true;
  }
  
  if (buttons.recenter) {
    buttons.recenter.addEventListener('click', recenter);
    buttons.recenter.disabled = true;
  }
  
  if (buttons.toggleVideo) {
    buttons.toggleVideo.addEventListener('click', toggleVideoPreview);
    buttons.toggleVideo.disabled = true;
  }
  
  // Initialize MediaPipe shortly after load
  setTimeout(initializeTracker, 1000);
});
