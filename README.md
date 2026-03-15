# Neo Cursor

## Problem Statement
Whether you're immersed in a coding session or writing a long-form text, the repetitive nature of typing, clicking, or even talking can become tiresome. Conventional speech-to-text solutions still demand the user to talk, and talking itself becomes a tedious and impractical process. There's a pressing need for a more relaxed and effortless way to use computers, a way that doesn't impede productivity.

## Solution
Neo Cursor provides the ultimate hands-free computing experience using computer vision-based mouse control and silent speech input. This desktop application, developed using computer vision, visual speech recognition, and large language model technologies, allows users to interact with computer interfaces using their eyes and talk silently to type, without the need for physical movement or verbalization.

---

## Commands reference

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+Q** (Windows/Linux) / **Cmd+Q** (macOS) | Quit the app (overlay has no title bar) |
| **Ctrl+R** / **Cmd+R** | Toggle VSR (visual speech recognition) recording |

### Gaze triggers (hold gaze on edge bar ~800 ms)

| Zone | Action |
|------|--------|
| **Top bar** | Scroll up |
| **Bottom bar** | Scroll down |
| **Left bar** | App back (previous window / Alt+Shift+Tab) |
| **Right bar** | App next (next window / Alt+Tab) |

### Eyes & blinks

| Gesture | Action |
|---------|--------|
| **Left blink** (short) | Left click |
| **Left wink hold 1.5 s** | Start drag; blink again to release |
| **Left wink hold 1.5 s then release** (when not dragging) | Copy selection |
| **Right blink** (short) | Right click |
| **Right wink hold 1.5 s** | Paste from clipboard |

### Head & scroll mode

| Input | Action |
|-------|--------|
| **Move head** | Move cursor (when not in scroll mode) |
| **Hold Z** | Enter scroll mode — head movement scrolls instead of moving cursor |
| **Release Z** | Exit scroll mode |

### Speech & VSR

| Input | Action |
|-------|--------|
| **Ctrl+R** / **Cmd+R** | Start/stop VSR recording; lip-reading result is typed into the focused field |
| **Voice (when speech engine is on)** | Speech-to-text is typed into the focused field |

---

Built by Thomas and Amy
