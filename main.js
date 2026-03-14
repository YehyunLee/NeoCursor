require('dotenv').config();
const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const server = require('./server');
const VSRHandler = require('./vsr-handler');
const SpeechHandler = require('./speech-handler');
const GoogleSpeechHandler = require('./google-speech-handler');
const CursorMonitor = require('./cursor-monitor');

let robot = null;
let useNativeControl = false;

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
    // MOUSEEVENTF_WHEEL=0x0800, MOUSEEVENTF_HWHEEL=0x1000; amount in cButtons (120 = one notch)
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
        "elseif($p[0]-eq'SCROLL'-and$p.Length-ge3){",
          "$dx=[int]$p[1];$dy=[int]$p[2];",
          "if($dy-ne0){[W.U32]::mouse_event(0x0800,0,0,$dy,0)}",
          "if($dx-ne0){[W.U32]::mouse_event(0x1000,0,0,$dx,0)}",
        "}",
        "elseif($p[0]-eq'CLICK'){",
          "if($p.Length-ge2-and$p[1]-eq'right'){[W.U32]::mouse_event(8,0,0,0,0);Start-Sleep -m 30;[W.U32]::mouse_event(16,0,0,0,0)}",
          "else{[W.U32]::mouse_event(2,0,0,0,0);Start-Sleep -m 30;[W.U32]::mouse_event(4,0,0,0,0)}",
        "}",
        "elseif($p[0]-eq'MOUSEDOWN'){",
          "if($p.Length-ge2-and$p[1]-eq'right'){[W.U32]::mouse_event(8,0,0,0,0)}",
          "else{[W.U32]::mouse_event(2,0,0,0,0)}",
        "}",
        "elseif($p[0]-eq'MOUSEUP'){",
          "if($p.Length-ge2-and$p[1]-eq'right'){[W.U32]::mouse_event(16,0,0,0,0)}",
          "else{[W.U32]::mouse_event(4,0,0,0,0)}",
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

function sendScroll(dx, dy) {
  if (cursorHelper && cursorHelper.stdin) {
    cursorHelper.stdin.write(`SCROLL ${dx} ${dy}\n`);
  } else if (process.platform === 'darwin') {
    // macOS: Use AppleScript to simulate scroll wheel events
    // Positive dy = scroll up, negative = scroll down
    const scrollAmount = Math.round(dy / 30); // Convert to scroll units
    const script = `
      tell application "System Events"
        tell (first application process whose frontmost is true)
          set frontApp to name
        end tell
        tell process frontApp
          key code 125 using {shift down} -- Simulate scroll
        end tell
      end tell
    `;
    
    // Use a simpler approach: send arrow key events for scrolling
    if (dy > 0) {
      // Scroll up - send up arrow multiple times
      for (let i = 0; i < 3; i++) {
        spawn('osascript', ['-e', 'tell application "System Events" to key code 126']);
      }
    } else if (dy < 0) {
      // Scroll down - send down arrow multiple times
      for (let i = 0; i < 3; i++) {
        spawn('osascript', ['-e', 'tell application "System Events" to key code 125']);
      }
    }
    console.log(`[Scroll] macOS scroll: dy=${dy}`);
  } else if (process.platform === 'linux') {
    if (dy > 0) spawn('xdotool', ['click', '4']);  // scroll up
    if (dy < 0) spawn('xdotool', ['click', '5']);  // scroll down
    if (dx > 0) spawn('xdotool', ['click', '7']);  // scroll right
    if (dx < 0) spawn('xdotool', ['click', '6']);  // scroll left
  }
}

function sendCursorClick(button) {
  if (cursorHelper && cursorHelper.stdin) {
    cursorHelper.stdin.write(`CLICK ${button}\n`);
  } else if (process.platform === 'linux') {
    spawn('xdotool', ['click', button === 'right' ? '3' : '1']);
  }
}

function sendMouseDown(button) {
  if (cursorHelper && cursorHelper.stdin) {
    cursorHelper.stdin.write(`MOUSEDOWN ${button}\n`);
  } else if (process.platform === 'linux') {
    spawn('xdotool', ['mousedown', button === 'right' ? '3' : '1']);
  }
}

function sendMouseUp(button) {
  if (cursorHelper && cursorHelper.stdin) {
    cursorHelper.stdin.write(`MOUSEUP ${button}\n`);
  } else if (process.platform === 'linux') {
    spawn('xdotool', ['mouseup', button === 'right' ? '3' : '1']);
  }
}

let mainWindow;
let vsrHandler = null;
let speechHandler = null;
let googleSpeechHandler = null;
let cursorMonitor = null;
let activeSpeechEngine = 'whisper'; // 'whisper' or 'google'

const initialGoogleKey = process.env.GOOGLE_SPEECH_API_KEY || null;
let speechSettings = {
  engine: initialGoogleKey ? 'google' : 'whisper',
  whisperModel: 'base',
  googleApiKey: initialGoogleKey
};

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().bounds;
  
  mainWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    visibleOnAllWorkspaces: true,
    fullscreenable: false,
    kiosk: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });
  
  // Set window to ignore mouse events except on interactive regions
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  
  // Ensure window stays on top even when other apps are in fullscreen
  // Use 'floating' level which stays above fullscreen windows
  mainWindow.setAlwaysOnTop(true, 'floating', 1);
  
  // Additional setting to ensure visibility over fullscreen apps
  if (process.platform === 'darwin') {
    app.dock.hide(); // Hide from dock on macOS
  }

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

ipcMain.handle('mouse-down', async (event, { button = 'left' }) => {
  try {
    if (useNativeControl) {
      sendMouseDown(button);
    } else {
      robot.mouseToggle('down', button);
    }
    return { success: true };
  } catch (error) {
    console.error('Error mouse-down:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('mouse-up', async (event, { button = 'left' }) => {
  try {
    if (useNativeControl) {
      sendMouseUp(button);
    } else {
      robot.mouseToggle('up', button);
    }
    return { success: true };
  } catch (error) {
    console.error('Error mouse-up:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler for scrolling (dx = horizontal, dy = vertical; positive dy = scroll up)
ipcMain.handle('scroll', async (event, { dx, dy }) => {
  try {
    if (useNativeControl) {
      sendScroll(Math.round(dx), Math.round(dy));
    } else if (robot) {
      robot.scrollMouse(0, Math.round(dy / 120));
    }
    return { success: true };
  } catch (error) {
    console.error('Error scrolling:', error);
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

// IPC handler for Alt+Tab (window switching)
let lastAltTabTime = 0;
const ALT_TAB_COOLDOWN = 1000; // Prevent rapid-fire switching

ipcMain.handle('alt-tab', async (event, { direction }) => {
  try {
    const now = Date.now();
    if (now - lastAltTabTime < ALT_TAB_COOLDOWN) {
      return { success: false, error: 'Cooldown active' };
    }
    lastAltTabTime = now;
    
    if (process.platform === 'darwin') {
      // macOS: Get list of running apps and switch to next/previous
      const script = direction === 'left'
        ? `tell application "System Events"
             set frontApp to name of first application process whose frontmost is true
             set appList to name of every application process whose visible is true
             set appCount to count of appList
             repeat with i from 1 to appCount
               if item i of appList is frontApp then
                 if i is 1 then
                   set nextApp to item appCount of appList
                 else
                   set nextApp to item (i - 1) of appList
                 end if
                 exit repeat
               end if
             end repeat
             tell process nextApp to set frontmost to true
           end tell`
        : `tell application "System Events"
             set frontApp to name of first application process whose frontmost is true
             set appList to name of every application process whose visible is true
             set appCount to count of appList
             repeat with i from 1 to appCount
               if item i of appList is frontApp then
                 if i is appCount then
                   set nextApp to item 1 of appList
                 else
                   set nextApp to item (i + 1) of appList
                 end if
                 exit repeat
               end if
             end repeat
             tell process nextApp to set frontmost to true
           end tell`;
      
      spawn('osascript', ['-e', script]);
      console.log(`[Alt-Tab] Switched ${direction}`);
    } else if (process.platform === 'linux') {
      // Linux: Alt+Tab or Alt+Shift+Tab
      const keys = direction === 'left' ? 'alt+shift+Tab' : 'alt+Tab';
      spawn('xdotool', ['key', keys]);
      console.log(`[Alt-Tab] Switched ${direction}`);
    }
    return { success: true };
  } catch (error) {
    console.error('[Alt-Tab] Error:', error);
    return { success: false, error: error.message };
  }
});

app.whenReady().then(() => {
  startCursorHelper();
  createWindow();
  
  // Initialize VSR handler
  vsrHandler = new VSRHandler();
  
  // Initialize Speech handlers
  speechHandler = new SpeechHandler();
  if (speechSettings.googleApiKey) {
    googleSpeechHandler = new GoogleSpeechHandler(speechSettings.googleApiKey);
  }
  
  // Initialize cursor monitor to detect text input mode
  cursorMonitor = new CursorMonitor();
  cursorMonitor.start((isTextMode) => {
    console.log(`[CursorMonitor] Text mode: ${isTextMode}`);
    // Notify renderer about text mode change
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('text-mode-changed', isTextMode);
    }
  });
  
  const handleTranscript = (text) => {
    // Type the transcribed text - now handled by unified type-text handler
    try {
      if (useNativeControl) {
        if (process.platform === 'darwin') {
          const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          spawn('osascript', ['-e', `tell application "System Events" to keystroke "${escapedText}"`]);
          console.log('[Speech] Typed via AppleScript:', text);
        } else if (process.platform === 'linux') {
          spawn('xdotool', ['type', '--', text]);
          console.log('[Speech] Typed via xdotool:', text);
        } else {
          console.log('[Speech] Would type:', text);
        }
      } else if (robot) {
        robot.typeString(text);
      }
    } catch (err) {
      console.error('[Speech] Error typing text:', err);
    }
  };
  
  speechHandler.onTranscriptReady = handleTranscript;
  if (googleSpeechHandler) {
    googleSpeechHandler.onTranscriptReady = handleTranscript;
  }
  
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
  
  // Cleanup speech handler
  if (speechHandler) {
    speechHandler.stop();
  }
});

// VSR IPC Handlers
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

// Speech-to-Text IPC Handlers
ipcMain.handle('speech-start', async (event, { modelSize }) => {
  try {
    const engine = speechSettings.engine;
    
    if (engine === 'google') {
      if (!googleSpeechHandler) {
        return { success: false, error: 'Google Speech handler not initialized. Please set GOOGLE_SPEECH_API_KEY in .env' };
      }
      activeSpeechEngine = 'google';
      return googleSpeechHandler.start();
    } else {
      if (!speechHandler) {
        return { success: false, error: 'Speech handler not initialized' };
      }
      activeSpeechEngine = 'whisper';
      return speechHandler.start(modelSize || speechSettings.whisperModel);
    }
  } catch (error) {
    console.error('Error starting speech:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('speech-stop', async () => {
  try {
    if (activeSpeechEngine === 'google' && googleSpeechHandler) {
      return googleSpeechHandler.stop();
    } else if (activeSpeechEngine === 'whisper' && speechHandler) {
      return speechHandler.stop();
    }
    return { success: false, error: 'No active speech handler' };
  } catch (error) {
    console.error('Error stopping speech:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('speech-feed-audio', async (event, { audioBuffer }) => {
  try {
    let fed = false;
    if (activeSpeechEngine === 'google' && googleSpeechHandler) {
      fed = googleSpeechHandler.feedAudio(Buffer.from(audioBuffer));
    } else if (activeSpeechEngine === 'whisper' && speechHandler) {
      fed = speechHandler.feedAudio(Buffer.from(audioBuffer));
    }
    return { success: fed };
  } catch (error) {
    console.error('Error feeding audio:', error);
    return { success: false, error: error.message };
  }
});

// Type text IPC handler - unified keyboard output for all speech sources
ipcMain.handle('type-text', async (event, { text }) => {
  try {
    if (!text) return { success: false, error: 'No text provided' };
    
    if (useNativeControl) {
      if (process.platform === 'darwin') {
        // Use AppleScript to type on macOS
        const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        spawn('osascript', ['-e', `tell application "System Events" to keystroke "${escapedText}"`]);
        console.log('[Type] Typed via AppleScript:', text);
      } else if (process.platform === 'linux') {
        // Use xdotool to type on Linux
        spawn('xdotool', ['type', '--', text]);
        console.log('[Type] Typed via xdotool:', text);
      } else {
        console.log('[Type] Would type:', text);
      }
    } else if (robot) {
      robot.typeString(text);
      console.log('[Type] Typed via robotjs:', text);
    }
    return { success: true };
  } catch (error) {
    console.error('[Type] Error typing text:', error);
    return { success: false, error: error.message };
  }
});

// Settings IPC Handlers
ipcMain.handle('get-speech-settings', async () => {
  return {
    success: true,
    settings: {
      ...speechSettings,
      googleAvailable: !!googleSpeechHandler
    }
  };
});

ipcMain.handle('update-speech-settings', async (event, { engine, whisperModel, googleApiKey }) => {
  try {
    if (engine) speechSettings.engine = engine;
    if (whisperModel) speechSettings.whisperModel = whisperModel;
    if (googleApiKey !== undefined) {
      speechSettings.googleApiKey = googleApiKey;
      // Reinitialize Google handler if API key changed
      if (googleApiKey) {
        googleSpeechHandler = new GoogleSpeechHandler(googleApiKey);
        googleSpeechHandler.onTranscriptReady = speechHandler.onTranscriptReady;
      } else {
        googleSpeechHandler = null;
      }
    }
    return { success: true, settings: speechSettings };
  } catch (error) {
    console.error('Error updating speech settings:', error);
    return { success: false, error: error.message };
  }
});
