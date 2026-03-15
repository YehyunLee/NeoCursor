# NeoCursor Setup Guide

## Installation

### macOS
1. Download `NeoCursor-1.0.0.dmg` from the [Releases page](https://github.com/YehyunLee/NeoCursor/releases)
2. Open the DMG file and drag NeoCursor to your Applications folder
3. Launch NeoCursor from Applications

### Windows
1. Download `NeoCursor-Setup-1.0.0.exe` from the [Releases page](https://github.com/YehyunLee/NeoCursor/releases)
2. Run the installer and follow the installation wizard
3. Launch NeoCursor from the Start Menu or Desktop shortcut

---

## First-Time Setup

### 1. Camera Permission
When you first launch NeoCursor, you'll be prompted to grant camera access. This is required for eye tracking and head movement detection.

- **macOS**: Click "Allow" when the system prompt appears
- **Windows**: Click "Allow" in the application permission dialog

### 2. Configure Speech Recognition (Optional)

NeoCursor supports two speech recognition engines:

#### Option A: Google Speech-to-Text (Recommended)
Google's cloud-based speech recognition provides the best accuracy and supports voice commands.

**Setup Steps:**
1. Get a Google Cloud API Key:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one
   - Enable the "Cloud Speech-to-Text API"
   - Create credentials (API Key)
   - Copy your API key

2. Configure in NeoCursor:
   - Open the NeoCursor Control Panel
   - Scroll to the **Settings** section
   - Select "Google Speech-to-Text v2" from the Speech Engine dropdown
   - Paste your API key in the "Google Speech API Key" field
   - Click "Save API Key"
   - You should see "✓ API key saved successfully"

#### Option B: Faster-Whisper (Offline)
Local speech recognition that works without an internet connection. No API key required, but less accurate than Google.

**Setup Steps:**
1. Open the NeoCursor Control Panel
2. Scroll to the **Settings** section
3. Select "Faster-Whisper (Offline)" from the Speech Engine dropdown
4. No additional configuration needed

---

## Using NeoCursor

### Control Panel
The Control Panel is your main interface for managing NeoCursor:

- **Start/Stop Tracking**: Toggle eye tracking on/off
- **Recenter Cursor**: Reset cursor position if tracking drifts
- **Toggle Camera Preview**: Show/hide the camera feed overlay
- **Toggle Voice Control**: Enable/disable speech recognition
- **Cursor Sensitivity**: Adjust how responsive the cursor is to head movement (1-50)

### Gestures

| Gesture | Action |
|---------|--------|
| **Left Eye Blink** | Left Click |
| **Right Eye Blink** | Right Click |
| **Hold Left Blink (1.5s)** | Start Drag (blink again to drop) |
| **Hold Right Blink (1.5s)** | Paste from clipboard |
| **Gaze at Top Edge** | Scroll Up |
| **Gaze at Bottom Edge** | Scroll Down |
| **Gaze at Left Edge** | Switch to Previous App (Alt+Tab) |
| **Gaze at Right Edge** | Switch to Next App (Alt+Tab) |

### Voice Commands
When voice control is enabled, you can dictate text or use commands:

- **Dictation**: Speak naturally to type text into any focused input field
- **Commands**: Say keyboard shortcuts like "backspace", "enter", "escape", etc.

---

## Troubleshooting

### Camera Not Working
- **macOS**: Check System Preferences → Security & Privacy → Camera
- **Windows**: Check Settings → Privacy → Camera
- Ensure no other application is using the camera

### Cursor Tracking is Inaccurate
1. Adjust lighting - ensure your face is well-lit
2. Position yourself 1-2 feet from the camera
3. Increase Cursor Sensitivity in Settings
4. Click "Recenter Cursor" to reset tracking

### Voice Recognition Not Working
- **Google Speech**: Verify your API key is correct and has the Speech-to-Text API enabled
- **Whisper**: Ensure microphone permissions are granted
- Check that the correct microphone is selected in your system settings

### App Won't Launch
- **macOS**: Right-click the app and select "Open" to bypass Gatekeeper
- **Windows**: Run as Administrator if you encounter permission issues

---

## Uninstallation

### macOS
1. Quit NeoCursor
2. Move NeoCursor.app from Applications to Trash
3. Settings are stored in `~/Library/Application Support/neocursor` (optional to delete)

### Windows
1. Quit NeoCursor
2. Go to Settings → Apps → Installed Apps
3. Find NeoCursor and click Uninstall
4. Settings are stored in `%APPDATA%\neocursor` (optional to delete)

---

## Support

- **Issues**: [GitHub Issues](https://github.com/YehyunLee/NeoCursor/issues)
- **Documentation**: [GitHub README](https://github.com/YehyunLee/NeoCursor#readme)
