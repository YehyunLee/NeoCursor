const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const server = require('./server');

let robot = null;
let useNativeControl = false;

try {
  robot = require('robotjs');
  console.log('Using robotjs for mouse control');
} catch (error) {
  console.warn('robotjs not available, using OS-specific fallback (PowerShell/AppleScript)');
  useNativeControl = true;
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

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
    let currentPos;
    
    if (useNativeControl) {
      currentPos = screen.getCursorScreenPoint();
    } else {
      currentPos = robot.getMousePos();
    }
    
    // Check if user manually moved the mouse
    if (lastSetPos) {
      const dist = Math.hypot(currentPos.x - lastSetPos.x, currentPos.y - lastSetPos.y);
      // If actual mouse position is significantly different from last set position, user moved it
      if (dist > 15) {
        pauseTrackingUntil = Date.now() + 2000; // Pause tracking for 2 seconds
      }
    }
    
    // If we are in paused state, return early
    if (Date.now() < pauseTrackingUntil) {
      // Keep tracking where the user puts it so we don't immediately pause again when resuming
      lastSetPos = currentPos;
      return { success: true, paused: true };
    }

    const displays = screen.getAllDisplays();
    const primaryDisplay = displays[0];
    
    // Clamp coordinates to screen bounds
    const clampedX = Math.max(0, Math.min(x, primaryDisplay.size.width - 1));
    const clampedY = Math.max(0, Math.min(y, primaryDisplay.size.height - 1));
    
    if (useNativeControl) {
      // Use OS-specific commands for system-wide mouse control
      if (process.platform === 'win32') {
        // Windows: Use PowerShell with Windows Forms
        const psScript = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(clampedX)}, ${Math.round(clampedY)})`;
        await execPromise(`powershell -Command "${psScript}"`);
      } else if (process.platform === 'darwin') {
        // macOS: Use cliclick or osascript
        await execPromise(`osascript -e 'tell application "System Events" to set position of mouse to {${Math.round(clampedX)}, ${Math.round(clampedY)}}'`);
      } else {
        // Linux: Use xdotool
        await execPromise(`xdotool mousemove ${Math.round(clampedX)} ${Math.round(clampedY)}`);
      }
    } else {
      // robotjs moves the ACTUAL system cursor across entire desktop
      robot.moveMouse(clampedX, clampedY);
    }
    
    lastSetPos = { x: clampedX, y: clampedY };
    return { success: true, paused: false };
  } catch (error) {
    console.error('Error moving cursor:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler for mouse click
ipcMain.handle('mouse-click', async (event, { button = 'left' }) => {
  try {
    if (useNativeControl) {
      // Use OS-specific commands for system-wide mouse clicks
      if (process.platform === 'win32') {
        // Windows: Use PowerShell with Windows Forms mouse_event
        const mouseButton = button === 'right' ? 8 : 2; // MOUSEEVENTF_LEFTDOWN=2, MOUSEEVENTF_RIGHTDOWN=8
        const mouseButtonUp = button === 'right' ? 16 : 4; // MOUSEEVENTF_LEFTUP=4, MOUSEEVENTF_RIGHTUP=16
        const psScript = `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int cButtons, int info);' -Name U32 -Namespace W; [W.U32]::mouse_event(${mouseButton}, 0, 0, 0, 0); Start-Sleep -Milliseconds 50; [W.U32]::mouse_event(${mouseButtonUp}, 0, 0, 0, 0)`;
        await execPromise(`powershell -Command "${psScript}"`);
      } else if (process.platform === 'darwin') {
        // macOS: Use cliclick or osascript
        const clickType = button === 'right' ? 'rc' : 'c';
        await execPromise(`osascript -e 'tell application "System Events" to ${button === 'right' ? 'right ' : ''}click at (do shell script "echo $(/usr/bin/python -c \"import Quartz; print(Quartz.NSEvent.mouseLocation().x, Quartz.NSEvent.mouseLocation().y)\")")'`);
      } else {
        // Linux: Use xdotool
        const clickNum = button === 'right' ? 3 : 1;
        await execPromise(`xdotool click ${clickNum}`);
      }
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

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
