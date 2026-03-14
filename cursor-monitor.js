const { spawn } = require('child_process');
const { ipcMain } = require('electron');

/**
 * CursorMonitor - Monitors cursor type changes to detect text input mode
 * Uses AppleScript on macOS to check if cursor is in text/I-beam mode
 */
class CursorMonitor {
  constructor() {
    this.isTextMode = false;
    this.checkInterval = null;
    this.callback = null;
  }

  /**
   * Start monitoring cursor type
   * @param {Function} callback - Called with (isTextMode) when cursor type changes
   */
  start(callback) {
    this.callback = callback;
    
    if (process.platform === 'darwin') {
      // Check cursor type every 500ms
      this.checkInterval = setInterval(() => {
        this.checkCursorType();
      }, 500);
    }
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  checkCursorType() {
    // On macOS, we can check if the focused element is a text input
    // by checking the accessibility role of the focused element
    const script = `
      tell application "System Events"
        try
          set frontApp to name of first application process whose frontmost is true
          tell process frontApp
            set focusedElement to value of attribute "AXFocusedUIElement"
            set elementRole to value of attribute "AXRole" of focusedElement
            if elementRole is in {"AXTextField", "AXTextArea", "AXComboBox"} then
              return "text"
            else
              return "normal"
            end if
          end tell
        on error
          return "normal"
        end try
      end tell
    `;

    const proc = spawn('osascript', ['-e', script]);
    let output = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', () => {
      const isText = output.trim() === 'text';
      if (isText !== this.isTextMode) {
        this.isTextMode = isText;
        if (this.callback) {
          this.callback(isText);
        }
      }
    });
  }
}

module.exports = CursorMonitor;
