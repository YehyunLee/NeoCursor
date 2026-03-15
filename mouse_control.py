import sys
import subprocess

def scroll_mouse(dy):
    # Convert to key presses (positive = up, negative = down)
    # Use arrow keys with System Events - most reliable method
    lines = abs(dy) // 80
    if lines == 0:
        lines = 1
    
    # Limit to reasonable number of key presses
    lines = min(lines, 5)
    
    try:
        if dy > 0:
            # Scroll up = Page Up or multiple arrow ups
            key = "page up"
        else:
            # Scroll down = Page Down or multiple arrow downs
            key = "page down"
        
        # key code 116 = Page Up, key code 121 = Page Down
        key_code = 116 if dy > 0 else 121
        script = f'tell application "System Events" to key code {key_code}'
        subprocess.run(
            ['osascript', '-e', script],
            capture_output=True,
            timeout=0.5
        )
        print(f"[Scroll] AppleScript key code {key_code} ({'PageUp' if dy > 0 else 'PageDown'})", flush=True)
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
