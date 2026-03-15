## 🚀 Project Inspiration
The "aha!" moment for NeoCursor came from watching a developer friend struggle with repetitive strain injury (RSI). We realized that as "vibe coding" and LLM-assisted development take off, the bottleneck is no longer how fast we can think, but how long our bodies can endure the friction of physical input.

Traditional mouse and keyboard interfaces cause strain and fatigue. We asked: What if we could eliminate the need for hand movement entirely? NeoCursor combines eye-tracking with voice control to create a truly hands-free computing experience—allowing users to navigate with their gaze and dictate with their voice, all using just a standard webcam and microphone.

Available for anyone to download at: https://neo-cursor.netlify.app/#download

## 🛠️ Technology Stack
**Languages:** 

- JavaScript/Node.js for the desktop app and UI

- Python for heavy-duty ML/audio (speech transcription and on macOS cursor/scroll helpers).

**Frameworks & libraries:**
- Electron: Cross-platform desktop (overlay + Control Panel).

- MediaPipe Face Mesh: Real-time, high-precision eye and face tracking and blink/wink gesture recognition.

- Faster-Whisper: Optimized, local speech-to-text for offline vocal transcription with no cloud dependency.

**System control:** 
- Windows: PowerShell with C#/user32 (SendInput, SetCursorPos, etc.) for mouse and keyboard. 

- macOS/Linux: RobotJS when available, plus Python + AppleScript on macOS for scrolling. 

**Platforms & cloud:**
- Google Cloud Speech-to-Text v2: High-accuracy streaming speech recognition for vocal input when using the cloud engine.

- Google Gemini API: Intelligent post-processing layer: it cleans up raw transcripts (spelling/grammar) and detects voice commands (e.g. “select all”, “paste”) so the app can execute shortcuts

**Hardware:** 
- Optimized to run on standard webcams, ensuring accessibility without specialized infrared sensors.

## 💻 Product Summary

NeoCursor is a hands-free interface for the modern developer. It transforms the way we interact with desktops by combining two cutting-edge modalities:

**Gaze-Based Navigation:** Using standard webcam feeds, NeoCursor tracks eye movement to control the cursor. It utilizes "Blink-Logic"—where short left/right blinks act as clicks, and sustained winks trigger complex actions like dragging or pasting.

**Speech Input:** Using Google Cloud Speech-to-Text or local Faster-Whisper, users can dictate code and text naturally. The system integrates with Gemini AI to clean up transcripts, fix spelling/grammar, and intelligently detect voice commands (like "select all" or "paste") so they execute as keyboard shortcuts instead of typing literally.

**Key Features:**
- Edge-Bar Triggers: Stay in the flow by gazing at the screen edges to scroll or switch windows instantly.

- Hybrid Scroll Mode: Use the "Z" key to toggle between cursor movement and head-tilt scrolling for long documentation.

- Privacy-First: Offers Faster-Whisper for entirely offline, local speech processing.

- Developer Focused: Built-in commands for "select all," "delete," and "undo" are mapped to triggers.

## 👁️‍🗨️Product Vision

NeoCursor isn't just a **productivity** hack; it’s an **accessibility breakthrough**. For individuals with mobility impairments, RSI, or conditions like ALS, traditional peripherals are a barrier to the digital economy. By lowering the cost of entry to "Eye-Tracking" (which usually requires expensive **$1,000+** hardware) to just a basic webcam and AI, we are democratizing high-end assistive tech.

We didn’t just build a demo; we built a **shippable product**.
- **One-Click Install:** We ship native installers (Windows NSIS, macOS DMG) via GitHub Releases; no npm install required for users.

- **Native Control:** Uses SendInput (Windows) and Quartz (macOS) for precise system-level clicks/scrolls, ensuring it works across IDEs and browsers.

- **Operational Depth:** Includes a dedicated Control Panel for calibration, error-handling fallbacks, and a modular architecture (CommandProcessor, CursorMonitor) for easy maintenance.

_By leveraging AI for rapid prototyping, we were able to spend the majority of our time on the high-stakes engineering: minimizing pipeline latency and ensuring the robustness of our eye-tracking and VSR implementations._