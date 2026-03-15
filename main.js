// Very first: log that main.js was entered (before any other require that might crash)
const path = require('path');
const fs = require('fs');
const STARTUP_LOG = path.join(__dirname, 'silentcursor-startup.log');
try { fs.appendFileSync(STARTUP_LOG, `[${new Date().toISOString()}] main.js ENTRY\n`); } catch (_) {}

require('dotenv').config();
const logStart = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(STARTUP_LOG, line); } catch (_) {}
  process.stderr.write('[SilentCursor] ' + msg + '\n');
};
logStart('main.js loading...');
const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');

// Reduce 0xC0000005 (access violation) on Windows: disable GPU acceleration and sandbox
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('no-sandbox');
}
const { spawn } = require('child_process');
const server = require('./server');
logStart('server required');
const VSRHandler = require('./vsr-handler');
const SpeechHandler = require('./speech-handler');
// Defer loading google-speech-handler (pulls in @google-cloud/speech native bindings) to avoid crash on Windows at startup
const CursorMonitor = require('./cursor-monitor');
const CommandProcessor = require('./command-processor');
logStart('handlers required');

let robot = null;
let useNativeControl = false;

// Keep renderer running even when window is unfocused or occluded
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');

// On Windows, do not load robotjs — it often crashes with 0xC0000005 (native access violation)
// before any JS catch can run. Use the PowerShell cursor helper instead.
if (process.platform === 'win32') {
  useNativeControl = true;
  logStart('Windows: using PowerShell helper (robotjs skipped to avoid crash)');
} else {
  logStart('loading robotjs...');
  try {
    robot = require('robotjs');
    logStart('robotjs OK');
  } catch (error) {
    logStart('robotjs not available, using fallback: ' + error.message);
    useNativeControl = true;
  }
}

// Persistent helper process for fast cursor control without robotjs
let cursorHelper = null;

function executeKeyboardAction(action) {
  try {
    if (action.type === 'key') {
      // Simple key press
      if (!useNativeControl && robot) {
        robot.keyTap(action.key);
        return true;
      }

      if (process.platform === 'darwin') {
        const keyMap = {
          'backspace': 'delete',
          'enter': 'return',
          'escape': 'escape',
          'space': 'space',
          'tab': 'tab',
          'up': '126', 'down': '125', 'left': '123', 'right': '124',
          'pageup': '116', 'pagedown': '121', 'home': '115', 'end': '119'
        };
        const key = keyMap[action.key] || action.key;
        const isArrow = ['126', '125', '123', '124', '116', '121', '115', '119'].includes(key);
        const script = isArrow 
          ? `tell application "System Events" to key code ${key}`
          : `tell application "System Events" to keystroke "${key}"`;
        spawn('osascript', ['-e', script]);
        return true;
      }

      if (process.platform === 'linux') {
        spawn('xdotool', ['key', action.key]);
        return true;
      }
    } else if (action.type === 'shortcut') {
      // Keyboard shortcut with modifiers
      if (!useNativeControl && robot) {
        const modifiers = action.modifiers.map(m => m === 'command' ? (process.platform === 'darwin' ? 'command' : 'control') : m);
        robot.keyTap(action.key, modifiers);
        return true;
      }

      if (process.platform === 'darwin') {
        const modMap = { 'command': 'command', 'shift': 'shift', 'option': 'option', 'control': 'control' };
        const mods = action.modifiers.map(m => `${modMap[m] || m} down`).join(', ');
        const script = `tell application "System Events" to keystroke "${action.key}" using {${mods}}`;
        spawn('osascript', ['-e', script]);
        return true;
      }

      if (process.platform === 'linux') {
        const modMap = { 'command': 'ctrl', 'shift': 'shift', 'option': 'alt', 'control': 'ctrl' };
        const mods = action.modifiers.map(m => modMap[m] || m).join('+');
        spawn('xdotool', ['key', `${mods}+${action.key}`]);
        return true;
      }
    }

    console.warn(`[KeyboardAction] No implementation for platform ${process.platform}`);
    return false;
  } catch (error) {
    console.error(`[KeyboardAction] Failed to execute:`, error);
    return false;
  }
}

function triggerSystemShortcut(action) {
  const key = action === 'paste' ? 'v' : 'c';
  const shortcutAction = {
    type: 'shortcut',
    modifiers: ['command'],
    key: key
  };
  return executeKeyboardAction(shortcutAction);
}

function startCursorHelper() {
  // On macOS, always start the Python helper for scrolling (robotjs scroll doesn't work well)
  // On other platforms, only start if useNativeControl is true
  if (!useNativeControl && process.platform !== 'darwin') return;

  if (process.platform === 'win32') {
    // Use SendInput for scrolling so it targets the window under the cursor (works in Overleaf, Cursor panes, etc.)
    // mouse_event is deprecated and doesn't always route to the correct window.
    const psScript = `
Add-Type -TypeDefinition @'
using System;
using System.Threading;
using System.Runtime.InteropServices;

public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public int mouseData;
    public int dwFlags;
    public int time;
    public IntPtr dwExtraInfo;
}

public struct INPUT {
    public int type;
    public MOUSEINPUT mi;
}

public struct POINT { public int X; public int Y; }

public class WinInput {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT pt);
    [DllImport("user32.dll")] public static extern void mouse_event(int f, int dx, int dy, int c, int i);
    [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);

    public static void ScrollWheel(int amount) {
        var inp = new INPUT();
        inp.type = 0; // INPUT_MOUSE
        inp.mi.dwFlags = 0x0800; // MOUSEEVENTF_WHEEL
        inp.mi.mouseData = amount;
        SendInput(1, new INPUT[]{inp}, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void ScrollHWheel(int amount) {
        var inp = new INPUT();
        inp.type = 0;
        inp.mi.dwFlags = 0x1000; // MOUSEEVENTF_HWHEEL
        inp.mi.mouseData = amount;
        SendInput(1, new INPUT[]{inp}, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void Click(int downFlag, int upFlag) {
        int sz = Marshal.SizeOf(typeof(INPUT));
        var down = new INPUT(); down.type = 0; down.mi.dwFlags = downFlag;
        SendInput(1, new INPUT[]{down}, sz);
        System.Threading.Thread.Sleep(30);
        var up = new INPUT(); up.type = 0; up.mi.dwFlags = upFlag;
        SendInput(1, new INPUT[]{up}, sz);
    }

    public static void MouseDown(int flag) {
        var inp = new INPUT(); inp.type = 0; inp.mi.dwFlags = flag;
        SendInput(1, new INPUT[]{inp}, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void MouseUp(int flag) {
        var inp = new INPUT(); inp.type = 0; inp.mi.dwFlags = flag;
        SendInput(1, new INPUT[]{inp}, Marshal.SizeOf(typeof(INPUT)));
    }
}
'@ -ErrorAction SilentlyContinue

while($true){
    $l=[Console]::In.ReadLine()
    if($l-eq$null){break}
    $p=$l-split' '
    if($p[0]-eq'MOVE'-and$p.Length-ge3){[WinInput]::SetCursorPos([int]$p[1],[int]$p[2])|Out-Null}
    elseif($p[0]-eq'SCROLL'-and$p.Length-ge3){
        $dx=[int]$p[1];$dy=[int]$p[2]
        if($dy-ne0){[WinInput]::ScrollWheel($dy)}
        if($dx-ne0){[WinInput]::ScrollHWheel($dx)}
    }
    elseif($p[0]-eq'SCROLL_AT'-and$p.Length-ge5){
        $sx=[int]$p[1];$sy=[int]$p[2];$dx=[int]$p[3];$dy=[int]$p[4]
        $cur=New-Object POINT
        [WinInput]::GetCursorPos([ref]$cur)|Out-Null
        [WinInput]::SetCursorPos($sx,$sy)|Out-Null
        if($dy-ne0){[WinInput]::ScrollWheel($dy)}
        if($dx-ne0){[WinInput]::ScrollHWheel($dx)}
        [WinInput]::SetCursorPos($cur.X,$cur.Y)|Out-Null
    }
    elseif($p[0]-eq'CLICK'){
        if($p.Length-ge2-and$p[1]-eq'right'){[WinInput]::Click(0x0008,0x0010)}
        else{[WinInput]::Click(0x0002,0x0004)}
    }
    elseif($p[0]-eq'MOUSEDOWN'){
        if($p.Length-ge2-and$p[1]-eq'right'){[WinInput]::MouseDown(0x0008)}
        else{[WinInput]::MouseDown(0x0002)}
    }
    elseif($p[0]-eq'MOUSEUP'){
        if($p.Length-ge2-and$p[1]-eq'right'){[WinInput]::MouseUp(0x0010)}
        else{[WinInput]::MouseUp(0x0004)}
    }
}
`;

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
  } else if (process.platform === 'darwin') {
    // macOS: Use Python Quartz script for reliable scrolling
    const scriptPath = path.join(__dirname, 'mouse_control.py');
    // Use absolute path to python3 to avoid PATH issues in Electron
    // Using -u for unbuffered I/O
    const pythonPath = '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3';
    
    console.log(`[CursorHelper] Spawning ${pythonPath} with script: ${scriptPath}`);
    
    const setupHelperListeners = (helper) => {
      helper.stdout.on('data', (data) => {
        console.log(`[CursorHelper Out]: ${data}`);
      });
      
      helper.stderr.on('data', (data) => {
        console.error(`[CursorHelper Error]: ${data}`);
      });
      
      helper.on('close', (code) => {
        console.log(`Cursor helper exited with code ${code}`);
        if (cursorHelper === helper) {
          cursorHelper = null;
        }
      });
    };

    try {
      cursorHelper = spawn(pythonPath, ['-u', scriptPath]);
      setupHelperListeners(cursorHelper);
      
      cursorHelper.on('error', (err) => {
        console.error('[CursorHelper] Failed to start subprocess with absolute path:', err);
        if (err.code === 'ENOENT') {
          console.log('[CursorHelper] Retrying with "python3" from PATH...');
          cursorHelper = spawn('python3', ['-u', scriptPath]);
          setupHelperListeners(cursorHelper);
          
          cursorHelper.on('error', (err2) => {
             console.error('[CursorHelper] Failed to start subprocess with PATH python3:', err2);
          });
        }
      });
    } catch (e) {
      console.error('[CursorHelper] Exception during spawn:', e);
    }
    
    console.log('Started Python cursor helper (macOS Quartz)');
  }
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
  } else if (process.platform === 'linux') {
    if (dy > 0) spawn('xdotool', ['click', '4']);  // scroll up
    if (dy < 0) spawn('xdotool', ['click', '5']);  // scroll down
    if (dx > 0) spawn('xdotool', ['click', '7']);  // scroll right
    if (dx < 0) spawn('xdotool', ['click', '6']);  // scroll left
  }
  // macOS scroll is handled by robotjs in the scroll IPC handler
}

function sendScrollAt(x, y, dx, dy) {
  if (cursorHelper && cursorHelper.stdin) {
    cursorHelper.stdin.write(`SCROLL_AT ${x} ${y} ${dx} ${dy}\n`);
  } else {
    sendScroll(dx, dy);
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
let controlsWindow;
let vsrHandler = null;
let speechHandler = null;
let googleSpeechHandler = null;
let cursorMonitor = null;
let commandProcessor = null;
let activeSpeechEngine = 'whisper'; // 'whisper' or 'google'

const initialGoogleKey = process.env.GOOGLE_SPEECH_API_KEY || null;
let speechSettings = {
  engine: 'google',  // Default to Google Cloud when available
  whisperModel: 'base',
  googleApiKey: initialGoogleKey
};

function createControlWindow() {
  controlsWindow = new BrowserWindow({
    width: 600,
    height: 800,
    title: 'SilentCursor Control Panel',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  controlsWindow.loadFile(path.join(__dirname, 'controls.html'));
  // Don't set always-on-top so users can click other windows without hiding the panel
  controlsWindow.focus();

  controlsWindow.on('closed', () => {
    controlsWindow = null;
  });
}

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
  
  // Set window to ignore mouse events so clicks pass through to windows below (e.g. Control Panel)
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  // Use 'floating' so Control Panel (screen-saver level) stays on top and receives clicks
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
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
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle camera permission requests
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });
}

ipcMain.on('quit-app', () => {
  app.quit();
});

// IPC for Control Panel <-> Overlay communication
ipcMain.on('control-command', (event, { command, value }) => {
  if (!mainWindow || !mainWindow.webContents) return;
  mainWindow.webContents.send('control-command', { command, value });
  // Fallback: run stop/start directly in overlay in case IPC listener didn't run (e.g. remote load)
  if (command === 'stop-tracking') {
    mainWindow.webContents.executeJavaScript('typeof window.__stopTracking==="function"&&window.__stopTracking()').catch(() => {});
  } else if (command === 'start-tracking') {
    mainWindow.webContents.executeJavaScript('typeof window.__startTracking==="function"&&window.__startTracking()').catch(() => {});
  }
});

ipcMain.on('request-overlay-status', (event) => {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('control-command', { command: 'get-status' });
  }
});

ipcMain.on('overlay-status-update', (event, status) => {
  // Forward status to control window
  if (controlsWindow && controlsWindow.webContents) {
    controlsWindow.webContents.send('overlay-status-update', status);
  }
});

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

ipcMain.handle('copy-selection', async () => {
  try {
    const success = triggerSystemShortcut('copy');
    return { success };
  } catch (error) {
    console.error('[Shortcut] Copy failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('paste-clipboard', async () => {
  try {
    const success = triggerSystemShortcut('paste');
    return { success };
  } catch (error) {
    console.error('[Shortcut] Paste failed:', error);
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
    console.log(`[Click] ${button}`);
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
    if (process.platform === 'darwin') {
      // Use our Python script for reliable scrolling on macOS
      if (cursorHelper && cursorHelper.stdin && !cursorHelper.killed) {
        // Send scroll command to python helper
        // Python helper expects: SCROLL dx dy
        cursorHelper.stdin.write(`SCROLL ${dx} ${dy}\n`);
      } else {
        // Fallback or restart helper?
        const now = Date.now();
        if (!global.lastHelperRestart || now - global.lastHelperRestart > 2000) {
           console.warn('Cursor helper not running, restarting...');
           global.lastHelperRestart = now;
           startCursorHelper();
        }
        
        // Try once after short delay
        setTimeout(() => {
          if (cursorHelper && cursorHelper.stdin) {
            cursorHelper.stdin.write(`SCROLL ${dx} ${dy}\n`);
          }
        }, 100);
      }
    } else if (robot) {
      // robotjs scrollMouse: positive = scroll down, negative = scroll up
      // Our convention: positive dy = scroll up, so we need to negate
      const scrollAmount = Math.round(-dy / 30); // Convert and invert
      robot.scrollMouse(Math.round(dx / 30), scrollAmount);
      console.log(`[Scroll] robotjs scroll: dx=${dx}, dy=${dy}, amount=${scrollAmount}`);
    } else if (useNativeControl) {
      // Pass values directly - the PowerShell SendInput expects wheel amounts in multiples of 120
      sendScroll(Math.round(dx), Math.round(dy));
    }
    return { success: true };
  } catch (error) {
    console.error('Error scrolling:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('scroll-at', async (event, { x, y, dx, dy }) => {
  try {
    if (x != null && y != null && useNativeControl && process.platform === 'win32') {
      sendScrollAt(Math.round(x), Math.round(y), Math.round(dx), Math.round(dy));
    } else {
      sendScroll(Math.round(dx), Math.round(dy));
    }
    return { success: true };
  } catch (error) {
    console.error('Error scrollAt:', error);
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
  createControlWindow();
  logStart('ready. Overlay + Control Panel opened. Ctrl+Shift+H = help.');

  // Initialize VSR handler
  vsrHandler = new VSRHandler();
  
  // Initialize Speech handlers
  speechHandler = new SpeechHandler();
  if (speechSettings.googleApiKey) {
    const GoogleSpeechHandler = require('./google-speech-handler');
    googleSpeechHandler = new GoogleSpeechHandler(speechSettings.googleApiKey);
  } else {
    // Fall back to Whisper if Google API key not configured
    speechSettings.engine = 'whisper';
  }
  
  // Initialize command processor
  commandProcessor = new CommandProcessor();
  
  // Initialize cursor monitor to detect text input mode
  cursorMonitor = new CursorMonitor();
  cursorMonitor.start((isTextMode) => {
    console.log(`[CursorMonitor] Text mode: ${isTextMode}`);
    // Notify renderer about text mode change
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('text-mode-changed', isTextMode);
    }
  });
  
  const handleTranscript = (payload) => {
    // Handle both string (legacy) and object (new) formats
    const text = typeof payload === 'string' ? payload : payload.text;
    const commandHint = typeof payload === 'object' ? payload.commandHint : null;
    
    console.log(`[Speech] Received transcript: "${text}"${commandHint ? ' [hint: ' + commandHint + ']' : ''}`);
    
    // If Gemini provided a command hint, try to map it to an action
    if (commandHint) {
      const result = commandProcessor.processTranscript(commandHint);
      if (result.isCommand) {
        console.log(`[Speech] Gemini command hint matched: "${commandHint}" -> "${result.matchedCommand}"`);
        const success = executeKeyboardAction(result.action);
        console.log(`[Speech] Command execution ${success ? 'succeeded' : 'failed'}`);
        if (success) return; // Command executed, don't type text
      } else {
        console.log(`[Speech] Gemini command hint "${commandHint}" not recognized, falling back to text`);
      }
    }
    
    // Check if this is a command or regular text
    const result = commandProcessor.processTranscript(text);
    console.log(`[Speech] Command detection result:`, {
      isCommand: result.isCommand,
      matchedCommand: result.matchedCommand,
      originalText: result.originalText
    });
    
    if (result.isCommand) {
      // Execute keyboard action
      console.log(`[Speech] Executing command: "${result.matchedCommand}" -> action:`, result.action);
      const success = executeKeyboardAction(result.action);
      console.log(`[Speech] Command execution ${success ? 'succeeded' : 'failed'}`);
      if (!success) {
        console.warn(`[Speech] Command execution failed, typing as text instead`);
        typeText(text);
      }
    } else {
      // Type as regular text
      console.log(`[Speech] Not a command, typing as text: "${text}"`);
      typeText(text);
    }
  };
  
  const typeText = (text) => {
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
  if (!vsrHandler) return { success: false, error: 'VSR not initialized' };
  try {
    const result = await vsrHandler.stopRecording();
    if (result && result.text) {
      // Process through command processor or type as text
      handleTranscript(result.text);
      return { success: true, text: result.text, confidence: result.confidence };
    }
    return { success: false, error: 'No speech detected or recording too short' };
  } catch (error) {
    console.error('[VSR] Stop recording error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('speech-start', async (event, { modelSize }) => {
  try {
    if (activeSpeechEngine === 'google' && googleSpeechHandler) {
      await googleSpeechHandler.start();
    } else if (activeSpeechEngine === 'whisper' && speechHandler) {
      await speechHandler.start(modelSize || speechSettings.whisperModel);
    }
    return { success: true };
  } catch (error) {
    console.error('Error starting speech:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('speech-stop', async () => {
  try {
    if (activeSpeechEngine === 'google' && googleSpeechHandler) {
      await googleSpeechHandler.stop();
    } else if (activeSpeechEngine === 'whisper' && speechHandler) {
      await speechHandler.stop();
    }
    return { success: true };
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
    
    // Check if this is a command
    const result = commandProcessor.processTranscript(text);
    
    if (result.isCommand) {
      console.log(`[TypeText] Executing command: ${result.matchedCommand}`);
      const success = executeKeyboardAction(result.action);
      return { success, isCommand: true, matchedCommand: result.matchedCommand };
    }
    
    // Type as regular text
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
    return { success: true, isCommand: false };
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
      // Reinitialize Google handler if API key changed (lazy-load module)
      if (googleApiKey) {
        const GoogleSpeechHandler = require('./google-speech-handler');
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
