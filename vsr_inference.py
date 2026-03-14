#!/usr/bin/env python3
"""
Standalone VSR inference script for SilentCursor Electron app.
Accepts a video file path and outputs the transcribed text.
"""
import os
import sys
import json
import glob
import subprocess
import tempfile

# Suppress TensorFlow warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'


def frames_dir_to_video(frames_dir, fps=16):
    """Convert a directory of frame_NNNN.jpg files into a temp .mp4 via ffmpeg or opencv."""
    pattern = os.path.join(frames_dir, 'frame_*.jpg')
    frames = sorted(glob.glob(pattern))
    if not frames:
        return None

    out_path = os.path.join(tempfile.gettempdir(), 'vsr_assembled.mp4')

    # Try ffmpeg first
    try:
        subprocess.run(
            ['ffmpeg', '-y', '-framerate', str(fps),
             '-i', os.path.join(frames_dir, 'frame_%04d.jpg'),
             '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out_path],
            check=True, capture_output=True
        )
        return out_path
    except (FileNotFoundError, subprocess.CalledProcessError):
        pass

    # Fallback: opencv
    try:
        import cv2
        first = cv2.imread(frames[0])
        h, w = first.shape[:2]
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        writer = cv2.VideoWriter(out_path, fourcc, fps, (w, h))
        for f in frames:
            writer.write(cv2.imread(f))
        writer.release()
        return out_path
    except ImportError:
        pass

    return None

def find_vsr_engine():
    """Locate the VSR engine directory containing pipelines/pipeline.py"""
    cur_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(cur_dir)
    
    for dr in os.listdir(parent_dir):
        cand = os.path.join(parent_dir, dr)
        if os.path.isdir(cand) and os.path.exists(os.path.join(cand, 'pipelines', 'pipeline.py')):
            return cand
    return None

def load_model():
    """Find engine, import deps, load model once. Returns (model, engine_path) or raises."""
    engine_path = find_vsr_engine()
    if not engine_path:
        raise RuntimeError("VSR engine not found. Please ensure the inference engine is installed in the parent directory.")

    sys.path.append(engine_path)

    from pipelines.pipeline import InferencePipeline
    import torch

    cfg_path = os.path.join(engine_path, "configs", "LRS3_V_WER19.1.ini")
    if not os.path.exists(cfg_path):
        raise RuntimeError(f"Config file not found: {cfg_path}")

    device = torch.device("cpu")
    old_cwd = os.getcwd()
    os.chdir(engine_path)
    rel_cfg_path = os.path.relpath(cfg_path, engine_path)
    model = InferencePipeline(
        rel_cfg_path,
        device=device,
        detector="mediapipe",
        face_track=True
    )
    os.chdir(old_cwd)
    return model, engine_path


def run_inference(model, engine_path, video_path):
    """Run inference on a single video path. Returns JSON-serialisable dict."""
    if not os.path.exists(video_path):
        return {"error": f"Video file not found: {video_path}"}

    if os.path.isdir(video_path):
        video_path = frames_dir_to_video(video_path)
        if video_path is None:
            return {"error": "Failed to assemble frames into video."}

    old_cwd = os.getcwd()
    try:
        os.chdir(engine_path)
        result = model(video_path)
        return {
            "success": True,
            "text": result.strip() if result else "",
            "video_path": video_path
        }
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        return {"error": f"Inference failed: {str(e)}"}
    finally:
        os.chdir(old_cwd)


def server_mode():
    """Persistent mode: load model once, read video paths from stdin, write JSON to stdout."""
    try:
        model, engine_path = load_model()
        # Signal that the model is ready
        print(json.dumps({"status": "ready"}), flush=True)
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}), flush=True)
        sys.exit(1)

    # Read one video path per line from stdin
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        result = run_inference(model, engine_path, line)
        print(json.dumps(result), flush=True)


def single_shot_mode(video_path):
    """Original mode: load model, infer once, exit."""
    if not os.path.exists(video_path):
        print(json.dumps({"error": f"Video file not found: {video_path}"}))
        sys.exit(1)

    if os.path.isdir(video_path):
        video_path = frames_dir_to_video(video_path)
        if video_path is None:
            print(json.dumps({"error": "Failed to assemble frames into video. Install ffmpeg or provide a video file."}))
            sys.exit(1)

    try:
        model, engine_path = load_model()
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    result = run_inference(model, engine_path, video_path)
    print(json.dumps(result), flush=True)
    if "error" in result:
        sys.exit(1)


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "--server":
        server_mode()
    elif len(sys.argv) >= 2:
        single_shot_mode(sys.argv[1])
    else:
        print(json.dumps({"error": "Usage: vsr_inference.py [--server | <video_path>]"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
