const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const robot = require('robotjs');
const server = require('./server');

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
    const currentPos = robot.getMousePos();
    
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
    
    // robotjs moves the ACTUAL system cursor across entire desktop
    robot.moveMouse(clampedX, clampedY);
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
    robot.mouseClick(button);
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
