#!/usr/bin/env python3
"""
Standalone VSR inference script for SilentCursor Electron app.
Accepts a video file path and outputs the transcribed text.
"""
import os
import sys
import json

# Suppress TensorFlow warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

def find_vsr_engine():
    """Locate the VSR engine directory containing pipelines/pipeline.py"""
    cur_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(cur_dir)
    
    for dr in os.listdir(parent_dir):
        cand = os.path.join(parent_dir, dr)
        if os.path.isdir(cand) and os.path.exists(os.path.join(cand, 'pipelines', 'pipeline.py')):
            return cand
    return None

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No video path provided"}))
        sys.exit(1)
    
    video_path = sys.argv[1]
    
    if not os.path.exists(video_path):
        print(json.dumps({"error": f"Video file not found: {video_path}"}))
        sys.exit(1)
    
    # Find and load VSR engine
    engine_path = find_vsr_engine()
    
    if not engine_path:
        print(json.dumps({"error": "VSR engine not found. Please ensure the inference engine is installed in the parent directory."}))
        sys.exit(1)
    
    sys.path.append(engine_path)
    
    try:
        from pipelines.pipeline import InferencePipeline
        import torch
    except ImportError as e:
        print(json.dumps({"error": f"Failed to import VSR dependencies: {str(e)}"}))
        sys.exit(1)
    
    # Load model
    cfg_path = os.path.join(engine_path, "configs", "LRS3_V_WER19.1.ini")
    
    if not os.path.exists(cfg_path):
        print(json.dumps({"error": f"Config file not found: {cfg_path}"}))
        sys.exit(1)
    
    try:
        # Use CPU for compatibility
        device = torch.device("cpu")
        
        # Change to engine directory for relative path resolution
        old_cwd = os.getcwd()
        os.chdir(engine_path)
        
        rel_cfg_path = os.path.relpath(cfg_path, engine_path)
        model = InferencePipeline(
            rel_cfg_path,
            device=device,
            detector="mediapipe",
            face_track=True
        )
        
        # Run inference
        result = model(video_path)
        
        os.chdir(old_cwd)
        
        # Output JSON result
        print(json.dumps({
            "success": True,
            "text": result.strip() if result else "",
            "video_path": video_path
        }))
        
    except Exception as e:
        print(json.dumps({"error": f"Inference failed: {str(e)}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
