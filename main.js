const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const server = require('./server');

let robot = null;
let useNativeControl = false;

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

app.whenReady().then(() => {
  startCursorHelper();
  createWindow();

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
