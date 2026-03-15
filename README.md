# NeoCursor

## Problem Statement
Whether you're immersed in a coding session or writing long-form text, the repetitive nature of typing and clicking can cause strain and fatigue. Traditional mouse and keyboard interfaces lead to RSI (repetitive strain injury) and limit accessibility for users with mobility impairments. There's a pressing need for a more natural and effortless way to use computers that doesn't impede productivity.

## Solution
NeoCursor provides a hands-free computing experience using eye-tracking and voice control. This desktop application, developed using computer vision, speech recognition, and AI technologies, allows users to control their cursor with their gaze, click with eye blinks, and dictate text naturally—all using just a standard webcam and microphone.

**Platforms:** Windows, macOS (Linux partially supported).

---

## Quick start

1. **Install & run**  
   - Clone the repo, run `npm install`, then `npm start`.  
   - Or download the installer from the [website](https://neo-cursor.netlify.app) / [Releases](https://github.com/YehyunLee/NeoCursor/releases).

2. **Allow camera access** when the app asks. Use the **Control Panel** window to start tracking, adjust sensitivity, and choose the speech engine.

3. **Optional:** Configure your Google Speech-to-Text API key in the Control Panel Settings (or use Faster-Whisper for offline speech recognition). For development, you can also use a `.env` file — see `.env.example`.
4. **Optional LLM Sponsor Choice:** In Settings you can pick between **Google Gemini** and **Bitdeer AI (DeepSeek)** for transcript cleanup and command detection. Each provider needs its own API key (enter it in-app or via `.env`).

---

## Commands reference

### Control Panel (separate window)

| Control | Action |
|--------|--------|
| **Stop / Start Tracking** | Pause or resume eye tracking and cursor movement. |
| **Recenter Cursor** | Re-center the cursor from current gaze (available when tracking is on). |
| **Toggle Camera Preview** | Show or hide the camera feed in the overlay corner. |
| **Toggle Voice Control** | Enable or disable speech-to-text (Google or Whisper). |
| **Quit NeoCursor** | Exit the app (overlay has no title bar; use this or system quit). |
| **Cursor Sensitivity** | Slider 1–50; higher = faster cursor movement. |
| **Speech Engine** | Google Speech-to-Text v2 or Faster-Whisper (offline). |

---

### Gaze triggers (edge bars)

Hold your gaze on an **edge bar** for **~800 ms** to trigger. After the first trigger, keeping gaze on the top or bottom bar repeats scroll every ~150 ms.

| Zone | Action |
|------|--------|
| **Top bar** | Scroll up (in the pane you last clicked). |
| **Bottom bar** | Scroll down (in the pane you last clicked). |
| **Left bar** | Previous window (Alt+Shift+Tab / Cmd+Shift+Tab). |
| **Right bar** | Next window (Alt+Tab / Cmd+Tab). |

**Scroll target:** Scrolling goes to the window/pane that had focus at your **last blink click**. Click (blink) in the editor, terminal, or browser pane you want to scroll, then use top/bottom gaze bars.

---

### Eyes & blinks

| Gesture | Action |
|---------|--------|
| **Left eye blink** (short) | Left click. Also sets the “scroll target” pane for gaze scrolling. |
| **Left eye wink hold 1.5 s** | Start drag; keep winking, then blink again to release. |
| **Left wink release after drag** | On release, selection is copied to clipboard. |
| **Right eye blink** (short) | Right click. Also sets the scroll target pane. |
| **Right eye wink hold 1.5 s** | Paste from clipboard. |

Right-click has an ~800 ms cooldown between triggers. Avoid closing both eyes at once (within ~150 ms) so the app doesn’t treat it as a full blink and ignore the wink.

---

### Head & scroll mode

| Input | Action |
|-------|--------|
| **Move head** | Move the on-screen cursor (when not in scroll mode). |
| **Hold Z** | Enter scroll mode: head movement sends scroll wheel instead of moving the cursor. |
| **Release Z** | Exit scroll mode; head movement moves the cursor again. |

---

### Speech & voice commands

| Input | Action |
|-------|--------|
| **Voice (speech engine on)** | Speech-to-text is typed into the focused field (Google or Whisper). |
| **Voice commands** | Short phrases like “copy”, “paste”, “save”, “undo”, “new tab”, “select all”, “enter”, “escape”, etc. are detected and executed as keyboard shortcuts or keys (see `command-processor.js`). Best support on macOS; Windows uses native control for mouse, keyboard actions may vary. |

Speech is gated by simple VAD (voice activity); while the app thinks you’re speaking, blink-to-click is temporarily disabled to reduce accidental clicks.

---

## Requirements

- **Camera** (for eye tracking).  
- **Microphone** (optional, for speech-to-text).  
- **Node.js** for `npm start`; for production installers see `website/BUILD.md`.

---

## Configuration

- **Control Panel Settings**:  
  - Configure Google Speech API key directly in the app (Settings section)
  - Choose between Google Speech-to-Text (cloud) or Faster-Whisper (offline)
  - Select LLM provider: Google Gemini or Bitdeer AI (DeepSeek) and save the corresponding API key
  - Adjust cursor sensitivity (1-50)
- **`.env`** (optional for development):  
  - `GOOGLE_SPEECH_API_KEY` — for Google Speech-to-Text
  - `GEMINI_API_KEY` — for Gemini-based transcript improvement
  - `BITDEER_API_KEY` — for Bitdeer AI (DeepSeek) transcript improvement

---

Built by Thomas and Amy
