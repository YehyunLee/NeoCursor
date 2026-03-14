const { spawn } = require('child_process');

/**
 * CommandExecutor - Executes system commands based on parsed intent
 * Supports: Alt+Tab, Scroll, Arrow keys, Copy, Paste
 */
class CommandExecutor {
  constructor(robot = null, useNativeControl = false) {
    this.robot = robot;
    this.useNativeControl = useNativeControl;
    this.platform = process.platform;
  }

  /**
   * Execute a command based on the detected intent
   * @param {string} command - Command name (e.g., "alt_tab", "scroll_down", "copy")
   * @param {object} params - Optional parameters (e.g., scroll amount)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async execute(command, params = {}) {
    try {
      console.log(`[Command] Executing: ${command}`, params);

      switch (command) {
        case 'alt_tab':
          return await this.altTab();
        case 'scroll_down':
          return await this.scroll('down', params.amount || 3);
        case 'scroll_up':
          return await this.scroll('up', params.amount || 3);
        case 'arrow_down':
          return await this.pressKey('down');
        case 'arrow_up':
          return await this.pressKey('up');
        case 'arrow_left':
          return await this.pressKey('left');
        case 'arrow_right':
          return await this.pressKey('right');
        case 'copy':
          return await this.copy();
        case 'paste':
          return await this.paste();
        case 'enter':
          return await this.pressKey('enter');
        case 'escape':
          return await this.pressKey('escape');
        case 'backspace':
          return await this.pressKey('backspace');
        default:
          return { success: false, error: `Unknown command: ${command}` };
      }
    } catch (error) {
      console.error(`[Command] Error executing ${command}:`, error);
      return { success: false, error: error.message };
    }
  }

  async altTab() {
    if (this.platform === 'darwin') {
      // macOS: Cmd+Tab
      spawn('osascript', ['-e', 'tell application "System Events" to keystroke tab using command down']);
    } else if (this.platform === 'linux') {
      spawn('xdotool', ['key', 'alt+Tab']);
    } else if (this.platform === 'win32' && this.robot) {
      this.robot.keyTap('tab', 'alt');
    }
    return { success: true };
  }

  async scroll(direction, amount = 3) {
    const scrollAmount = direction === 'down' ? -120 * amount : 120 * amount;
    
    if (this.platform === 'darwin') {
      // macOS scroll using AppleScript
      const script = direction === 'down' 
        ? `tell application "System Events" to scroll down ${amount}`
        : `tell application "System Events" to scroll up ${amount}`;
      spawn('osascript', ['-e', script]);
    } else if (this.platform === 'linux') {
      const button = direction === 'down' ? '5' : '4';
      for (let i = 0; i < amount; i++) {
        spawn('xdotool', ['click', button]);
      }
    } else if (this.platform === 'win32' && this.robot) {
      this.robot.scrollMouse(0, scrollAmount);
    }
    return { success: true };
  }

  async pressKey(key) {
    if (this.platform === 'darwin') {
      const keyMap = {
        'down': 'down arrow',
        'up': 'up arrow',
        'left': 'left arrow',
        'right': 'right arrow',
        'enter': 'return',
        'escape': 'escape',
        'backspace': 'delete'
      };
      const macKey = keyMap[key] || key;
      spawn('osascript', ['-e', `tell application "System Events" to key code (key code of "${macKey}")`]);
    } else if (this.platform === 'linux') {
      spawn('xdotool', ['key', key === 'enter' ? 'Return' : key]);
    } else if (this.platform === 'win32' && this.robot) {
      this.robot.keyTap(key);
    }
    return { success: true };
  }

  async copy() {
    if (this.platform === 'darwin') {
      spawn('osascript', ['-e', 'tell application "System Events" to keystroke "c" using command down']);
    } else if (this.platform === 'linux') {
      spawn('xdotool', ['key', 'ctrl+c']);
    } else if (this.platform === 'win32' && this.robot) {
      this.robot.keyTap('c', 'control');
    }
    return { success: true };
  }

  async paste() {
    if (this.platform === 'darwin') {
      spawn('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
    } else if (this.platform === 'linux') {
      spawn('xdotool', ['key', 'ctrl+v']);
    } else if (this.platform === 'win32' && this.robot) {
      this.robot.keyTap('v', 'control');
    }
    return { success: true };
  }
}

module.exports = CommandExecutor;
