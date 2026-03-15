const { spawn } = require('child_process');

/**
 * CursorMonitor - Monitors cursor type changes to detect text input mode
 * - macOS: AppleScript checks AXRole of focused element (AXTextField, AXTextArea, AXComboBox)
 * - Windows: PowerShell + UI Automation checks ControlType of focused element (Edit, Document, ComboBox)
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

    if (process.platform === 'darwin' || process.platform === 'win32') {
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

  _onCheckResult(output) {
    const isText = output.trim() === 'text';
    if (isText !== this.isTextMode) {
      this.isTextMode = isText;
      if (this.callback) {
        this.callback(isText);
      }
    }
  }

  checkCursorType() {
    if (process.platform === 'darwin') {
      this._checkDarwin();
    } else if (process.platform === 'win32') {
      this._checkWindows();
    }
  }

  _checkDarwin() {
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
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.on('close', () => { this._onCheckResult(output); });
  }

  _checkWindows() {
    // UI Automation: ControlType.Edit=50004, Document=50030, ComboBox=50003
    const script = [
      'Add-Type -AssemblyName UIAutomationClient',
      'Add-Type -AssemblyName UIAutomationTypes',
      'try {',
      '  $el = [System.Windows.Automation.AutomationElement]::FocusedElement',
      '  $id = [int]$el.Current.ControlType.Id',
      '  if ($id -eq 50004 -or $id -eq 50030 -or $id -eq 50003) { Write-Output "text" } else { Write-Output "normal" }',
      '} catch { Write-Output "normal" }'
    ].join('; ');

    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
    let output = '';
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.on('close', () => { this._onCheckResult(output); });
  }
}

module.exports = CursorMonitor;
