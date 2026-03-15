import sys
import subprocess

def scroll_mouse(dy):
    """Simulate scrolling by sending discrete arrow key presses via AppleScript."""
    # Translate incoming delta to number of arrow key presses (one press ~ one line)
    presses = max(1, min(5, abs(dy) // 40 or 1))
    key_code = 126 if dy > 0 else 125  # 126 = Up Arrow, 125 = Down Arrow

    try:
        for _ in range(presses):
            script = f'tell application "System Events" to key code {key_code}'
            subprocess.run(
                ['osascript', '-e', script],
                capture_output=True,
                timeout=0.5
            )
        direction = 'Up' if dy > 0 else 'Down'
        print(f"[Scroll] Arrow {direction} x{presses}", flush=True)
    except Exception as e:
        print(f"[Scroll] Error: {e}", flush=True)

def main():
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
                
            parts = line.strip().split()
            if not parts:
                continue
                
            cmd = parts[0]
            
            if cmd == "SCROLL":
                # SCROLL dx dy
                # Our app: positive dy = scroll up
                try:
                    dy = int(float(parts[2]))
                    print(f"[Scroll] dy={dy}", flush=True)
                    scroll_mouse(dy)
                except IndexError:
                    print("[Scroll] IndexError - missing dy", flush=True)
                except ValueError:
                    print("[Scroll] ValueError - invalid dy", flush=True)
            
            sys.stdout.flush()
                
        except Exception:
            pass

if __name__ == "__main__":
    main()
