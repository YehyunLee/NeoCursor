# Neo Cursor

## Problem Statement
Whether you're immersed in a coding session or writing a long-form text, the repetitive nature of typing, clicking, or even talking can become tiresome. Conventional speech-to-text solutions still demand the user to talk, and talking itself becomes a tedious and impractical process. There's a pressing need for a more relaxed and effortless way to use computers, a way that doesn't impede productivity.

## Solution
Neo Cursor provides the ultimate hands-free computing 
experience using computer vision-based mouse control 
and silent speech input. This desktop application, 
developed using computer vision, visual speech 
recognition, and large language model technologies, 
allows users to interact with computer interfaces 
using their eyes and talk silently to type, without 
the need for physical movement or verbalization.

**Platforms:** Windows, macOS (Linux partially supported).

---

## Quick start

1. **Install & run**  
   - Clone the repo, run `npm install`, then `npm start`.  
   - Or download the installer from the [website](https://github.com/YehyunLee/SilentCursor) / [Releases](https://github.com/YehyunLee/SilentCursor/releases).

2. **Allow camera access** when the app asks. Use the **Control Panel** window to start tracking, adjust sensitivity, and choose the speech engine.

3. **Optional:** Add a Google Speech-to-Text API key (and optionally a Gemini API key for transcript improvement) in a `.env` file — see `.env.example`.

---

## Commands reference

### Control Panel (separate window)

| Control | Action |
|--------|--------|
| **Stop / Start Tracking** | Pause or resume eye tracking and cursor movement. |
| **Recenter Cursor** | Re-center the cursor from current gaze (available when tracking is on). |
| **Toggle Camera Preview** | Show or hide the camera feed in the overlay corner. |
| **Toggle Voice Control** | Enable or disable speech-to-text (Google or Whisper). |
| **Quit SilentCursor** | Exit the app (overlay has no title bar; use this or system quit). |
| **Cursor Sensitivity** | Slider 1–50; higher = faster cursor movement. |
| **Speech Engine** | Google Speech-to-Text v2 or Faster-Whisper (offline). |

---

### Keyboard

| Shortcut | Action |
|----------|--------|
| **Hold Z** | Scroll mode: head movement scrolls instead of moving the cursor. Release Z to exit. |
| **Ctrl+Shift+H** | Referenced in console as help; gesture guide is in the Control Panel. |
| **Quit** | Use Control Panel → “Quit SilentCursor” (or system shortcut e.g. Alt+F4 / Cmd+Q where applicable). |

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

- **`.env`** (optional):  
  - `GOOGLE_SPEECH_API_KEY` — for Google Speech-to-Text.  
  - `GEMINI_API_KEY` — for LLM-based transcript improvement.  
- **Control Panel** — sensitivity, speech engine, and toggles.

---

Built by Thomas and Amy
