const { app, BrowserWindow, ipcMain, screen, globalShortcut, desktopCapturer } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const server = require('./server');
const VSRHandler = require('./vsr-handler');

let robot = null;
let useNativeControl = false;
const MAGNIFIER_SIZE = 160;
const MAGNIFIER_RADIUS = MAGNIFIER_SIZE / 2;
const MAGNIFIER_ZOOM = 2.4;

// Keep renderer running even when window is unfocused or occluded
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');

try {
  robot = require('robotjs');
  console.log('Using robotjs for mouse control');
} catch (error) {
  console.warn('robotjs not available, using OS-specific fallback');
  useNativeControl = true;
}

// Persistent helper process for fast cursor control without robotjs
let cursorHelper = null;

function startCursorHelper() {
  if (!useNativeControl) return;

  if (process.platform === 'win32') {
    const psScript = [
      "Add-Type -MemberDefinition '",
      "[DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X, int Y);",
      "[DllImport(\"user32.dll\")] public static extern void mouse_event(int f, int dx, int dy, int c, int i);",
      "' -Name U32 -Namespace W;",
      "while($true){",
        "$l=[Console]::In.ReadLine();",
        "if($l-eq$null){break}",
        "$p=$l-split' ';",
        "if($p[0]-eq'MOVE'-and$p.Length-ge3){[W.U32]::SetCursorPos([int]$p[1],[int]$p[2])|Out-Null}",
        "elseif($p[0]-eq'CLICK'){",
          "if($p.Length-ge2-and$p[1]-eq'right'){[W.U32]::mouse_event(8,0,0,0,0);Start-Sleep -m 30;[W.U32]::mouse_event(16,0,0,0,0)}",
          "else{[W.U32]::mouse_event(2,0,0,0,0);Start-Sleep -m 30;[W.U32]::mouse_event(4,0,0,0,0)}",
        "}",
      "}"
    ].join(' ');

    cursorHelper = spawn('powershell', [
      '-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', psScript
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    cursorHelper.stdout.on('data', () => {});
    cursorHelper.stderr.on('data', (d) => console.warn('CursorHelper:', d.toString().trim()));
    cursorHelper.on('exit', (code) => { console.warn('CursorHelper exited:', code); cursorHelper = null; });
    console.log('Persistent cursor helper started (PowerShell)');

  } else if (process.platform === 'linux') {
    // xdotool is fast enough per-call, but we can still batch
    cursorHelper = { platform: 'linux' };
  }
  // macOS with robotjs failing is rare; osascript per-call is acceptable
}

function sendCursorMove(x, y) {
  const rx = Math.round(x);
  const ry = Math.round(y);
  if (cursorHelper && cursorHelper.stdin) {
    cursorHelper.stdin.write(`MOVE ${rx} ${ry}\n`);
  } else if (process.platform === 'linux') {
    spawn('xdotool', ['mousemove', String(rx), String(ry)]);
  } else if (process.platform === 'darwin') {
    spawn('osascript', ['-e', `do shell script "cliclick m:${rx},${ry}" 2>/dev/null || true`]);
  }
}

function sendCursorClick(button) {
  if (cursorHelper && cursorHelper.stdin) {
    cursorHelper.stdin.write(`CLICK ${button}\n`);
  } else if (process.platform === 'linux') {
    spawn('xdotool', ['click', button === 'right' ? '3' : '1']);
  }
}

let mainWindow;
let magnifierWindow = null;
let currentMagnifierDisplayId = null;
let magnifierUpdateInterval = null;
let vsrHandler = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  // Create system-wide magnifier overlay
  createMagnifierWindow();

  // Load from localhost server
  mainWindow.loadURL('http://localhost:3000');

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Handle camera permission requests
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });
}

// IPC handler to get screen bounds for absolute positioning
ipcMain.handle('get-screen-bounds', async () => {
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    return { success: true, bounds: primaryDisplay.bounds };
  } catch (error) {
    console.error('Error getting screen bounds:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler for moving mouse cursor (system-wide)
let lastSetPos = null;
let pauseTrackingUntil = 0;

ipcMain.handle('move-cursor', async (event, { x, y }) => {
  try {
    if (!useNativeControl) {
      const currentPos = robot.getMousePos();
      if (lastSetPos) {
        const d = Math.hypot(currentPos.x - lastSetPos.x, currentPos.y - lastSetPos.y);
        if (d > 15) pauseTrackingUntil = Date.now() + 2000;
      }
      if (Date.now() < pauseTrackingUntil) {
        lastSetPos = currentPos;
        return { success: true, paused: true };
      }
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const clampedX = Math.max(0, Math.min(x, primaryDisplay.size.width - 1));
    const clampedY = Math.max(0, Math.min(y, primaryDisplay.size.height - 1));

    if (useNativeControl) {
      sendCursorMove(clampedX, clampedY);
    } else {
      robot.moveMouse(clampedX, clampedY);
    }

    lastSetPos = { x: clampedX, y: clampedY };
    return { success: true, paused: false };
  } catch (error) {
    console.error('Error moving cursor:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('mouse-click', async (event, { button = 'left' }) => {
  try {
    if (useNativeControl) {
      sendCursorClick(button);
    } else {
      robot.mouseClick(button);
    }
    return { success: true };
  } catch (error) {
    console.error('Error clicking mouse:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler for fullscreen control
ipcMain.handle('set-fullscreen', async (event, { fullscreen }) => {
  try {
    mainWindow.setFullScreen(fullscreen);
    return { success: true };
  } catch (error) {
    console.error('Error setting fullscreen:', error);
    return { success: false, error: error.message };
  }
});

app.whenReady().then(() => {
  createWindow();
  
  // Initialize VSR handler
  vsrHandler = new VSRHandler();
  
  // Register global shortcuts for VSR
  globalShortcut.register('CommandOrControl+R', () => {
    if (mainWindow) {
      mainWindow.webContents.send('toggle-vsr-recording');
    }
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (cursorHelper && cursorHelper.stdin) {
    cursorHelper.stdin.end();
    cursorHelper.kill();
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
  
  // Cleanup VSR temp files
  if (vsrHandler) {
    vsrHandler.cleanup();
  }
});

function createMagnifierWindow() {
  magnifierWindow = new BrowserWindow({
    width: MAGNIFIER_SIZE,
    height: MAGNIFIER_SIZE,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  magnifierWindow.setIgnoreMouseEvents(true);
  magnifierWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  magnifierWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  // Load magnifier HTML
  magnifierWindow.loadFile(path.join(__dirname, 'magnifier.html'));

  magnifierWindow.webContents.on('did-finish-load', () => {
    const primaryDisplay = screen.getPrimaryDisplay();
    currentMagnifierDisplayId = primaryDisplay.id;
    magnifierWindow.webContents.send('magnifier-config', {
      zoom: MAGNIFIER_ZOOM,
      radius: MAGNIFIER_RADIUS,
      scaleFactor: primaryDisplay.scaleFactor,
      bounds: primaryDisplay.bounds,
      displayId: primaryDisplay.id
    });
  });

  magnifierWindow.on('closed', () => {
    if (magnifierUpdateInterval) {
      clearInterval(magnifierUpdateInterval);
      magnifierUpdateInterval = null;
    }
    magnifierWindow = null;
  });
}

async function captureMagnifierRegion(x, y) {
  if (!magnifierWindow) return;
  
  try {
    const display = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
    const { bounds, scaleFactor } = display;
    
    // Hide magnifier temporarily to avoid capturing itself
    const wasVisible = magnifierWindow.isVisible();
    if (wasVisible) {
      magnifierWindow.hide();
    }
    
    // Small delay to ensure window is hidden before capture
    await new Promise(resolve => setTimeout(resolve, 5));
    
    // Calculate capture region centered on cursor
    const captureSize = Math.ceil(MAGNIFIER_SIZE / MAGNIFIER_ZOOM);
    const captureX = Math.max(bounds.x, Math.min(bounds.x + bounds.width - captureSize, Math.round(x - captureSize / 2)));
    const captureY = Math.max(bounds.y, Math.min(bounds.y + bounds.height - captureSize, Math.round(y - captureSize / 2)));
    
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(bounds.width * scaleFactor),
        height: Math.round(bounds.height * scaleFactor)
      }
    });
    
    let source = sources[0];
    if (currentMagnifierDisplayId) {
      const match = sources.find(s => s.display_id === String(currentMagnifierDisplayId));
      if (match) source = match;
    }
    
    if (!source || !source.thumbnail) {
      if (wasVisible) magnifierWindow.show();
      return;
    }
    
    const thumbnail = source.thumbnail;
    const imgWidth = thumbnail.getSize().width;
    const imgHeight = thumbnail.getSize().height;
    
    // Calculate crop region in thumbnail coordinates
    const scaleX = imgWidth / bounds.width;
    const scaleY = imgHeight / bounds.height;
    const cropX = Math.round((captureX - bounds.x) * scaleX);
    const cropY = Math.round((captureY - bounds.y) * scaleY);
    const cropW = Math.round(captureSize * scaleX);
    const cropH = Math.round(captureSize * scaleY);
    
    const cropped = thumbnail.crop({
      x: Math.max(0, Math.min(imgWidth - cropW, cropX)),
      y: Math.max(0, Math.min(imgHeight - cropH, cropY)),
      width: cropW,
      height: cropH
    });
    
    const resized = cropped.resize({ width: MAGNIFIER_SIZE, height: MAGNIFIER_SIZE });
    const dataUrl = resized.toDataURL();
    
    // Show magnifier again and send the captured image
    if (wasVisible) {
      magnifierWindow.show();
    }
    
    magnifierWindow.webContents.send('magnifier-render', dataUrl);
  } catch (error) {
    console.error('Magnifier capture error:', error);
    if (magnifierWindow && magnifierWindow.isVisible()) {
      magnifierWindow.show();
    }
  }
}

function updateMagnifierPosition(x, y) {
  if (!magnifierWindow) return;
  try {
    const display = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }) || screen.getPrimaryDisplay();
    const { id } = display;

    magnifierWindow.setBounds({
      x: Math.round(x - MAGNIFIER_RADIUS),
      y: Math.round(y - MAGNIFIER_RADIUS),
      width: MAGNIFIER_SIZE,
      height: MAGNIFIER_SIZE
    });

    if (currentMagnifierDisplayId !== id) {
      currentMagnifierDisplayId = id;
    }
    
    captureMagnifierRegion(x, y);
  } catch (error) {
    console.error('Error updating magnifier position:', error);
  }
}

// Magnifier IPC handlers
ipcMain.handle('magnifier-show', async (event, { x, y }) => {
  if (!magnifierWindow) return { success: false };
  try {
    updateMagnifierPosition(x, y);
    magnifierWindow.show();
    
    // Start continuous updates
    if (!magnifierUpdateInterval) {
      magnifierUpdateInterval = setInterval(() => {
        if (magnifierWindow && magnifierWindow.isVisible()) {
          const pos = screen.getCursorScreenPoint();
          captureMagnifierRegion(pos.x, pos.y);
        }
      }, 50); // 20 FPS
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error showing magnifier:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('magnifier-hide', async () => {
  if (!magnifierWindow) return { success: false };
  try {
    magnifierWindow.hide();
    
    // Stop continuous updates
    if (magnifierUpdateInterval) {
      clearInterval(magnifierUpdateInterval);
      magnifierUpdateInterval = null;
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error hiding magnifier:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('magnifier-move', async (event, { x, y }) => {
  if (!magnifierWindow) return { success: false };
  try {
    updateMagnifierPosition(x, y);
    return { success: true };
  } catch (error) {
    console.error('Error moving magnifier:', error);
    return { success: false, error: error.message };
  }
});

// VSR IPC handlers
ipcMain.handle('vsr-start-recording', async () => {
  try {
    if (!vsrHandler) {
      return { success: false, error: 'VSR handler not initialized' };
    }
    const started = vsrHandler.startRecording();
    return { success: started };
  } catch (error) {
    console.error('Error starting VSR recording:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vsr-add-frame', async (event, { frameData }) => {
  try {
    if (!vsrHandler) {
      return { success: false, error: 'VSR handler not initialized' };
    }
    vsrHandler.addFrame(frameData);
    return { success: true };
  } catch (error) {
    console.error('Error adding VSR frame:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vsr-stop-recording', async () => {
  try {
    if (!vsrHandler) {
      return { success: false, error: 'VSR handler not initialized' };
    }
    const result = await vsrHandler.stopRecording();
    return { success: true, result };
  } catch (error) {
    console.error('Error stopping VSR recording:', error);
    return { success: false, error: error.message };
  }
});
