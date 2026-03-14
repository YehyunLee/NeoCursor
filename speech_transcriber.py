#!/usr/bin/env python3
"""
Streaming speech-to-text transcriber using faster-whisper.
Reads raw PCM audio from stdin, transcribes continuously, outputs JSON to stdout.
"""
import sys
import json
import numpy as np
import threading
import queue
import time

# Suppress warnings
import os
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

try:
    from faster_whisper import WhisperModel
except ImportError:
    print(json.dumps({"status": "error", "error": "faster-whisper not installed. Run: pip install faster-whisper"}), flush=True)
    sys.exit(1)


class StreamingTranscriber:
    def __init__(self, model_size="base", device="cpu", compute_type="int8"):
        """Initialize the Whisper model for streaming transcription."""
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.model = None
        
        # Audio buffer settings
        self.sample_rate = 16000
        self.chunk_duration = 3.0  # Process 3-second chunks
        self.chunk_samples = int(self.sample_rate * self.chunk_duration)
        
        # Threading
        self.audio_queue = queue.Queue()
        self.running = False
        
    def load_model(self):
        """Load the Whisper model."""
        try:
            print(json.dumps({"status": "loading", "model": self.model_size}), flush=True)
            self.model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type
            )
            print(json.dumps({"status": "ready"}), flush=True)
            return True
        except Exception as e:
            print(json.dumps({"status": "error", "error": str(e)}), flush=True)
            return False
    
    def transcribe_chunk(self, audio_data):
        """Transcribe a single audio chunk."""
        if self.model is None or len(audio_data) == 0:
            return None
        
        try:
            # Normalize audio to float32 [-1, 1]
            audio_float = audio_data.astype(np.float32) / 32768.0
            
            # Run transcription
            segments, info = self.model.transcribe(
                audio_float,
                language="en",
                beam_size=5,
                vad_filter=True,  # Voice activity detection to skip silence
                vad_parameters=dict(min_silence_duration_ms=500)
            )
            
            # Collect all segments
            text_parts = []
            for segment in segments:
                text_parts.append(segment.text.strip())
            
            full_text = " ".join(text_parts).strip()
            
            if full_text:
                return {
                    "success": True,
                    "text": full_text,
                    "language": info.language,
                    "language_probability": info.language_probability
                }
            return None
            
        except Exception as e:
            return {"error": str(e)}
    
    def audio_reader_thread(self):
        """Read raw PCM from stdin and queue chunks."""
        buffer = np.array([], dtype=np.int16)
        
        while self.running:
            try:
                # Read 1024 samples at a time (2048 bytes for int16)
                chunk = sys.stdin.buffer.read(2048)
                if not chunk:
                    time.sleep(0.01)
                    continue
                
                # Convert bytes to int16 array
                samples = np.frombuffer(chunk, dtype=np.int16)
                buffer = np.concatenate([buffer, samples])
                
                # If we have enough samples, queue for transcription
                while len(buffer) >= self.chunk_samples:
                    audio_chunk = buffer[:self.chunk_samples]
                    buffer = buffer[self.chunk_samples:]
                    self.audio_queue.put(audio_chunk)
                    
            except Exception as e:
                print(json.dumps({"error": f"Audio reader error: {str(e)}"}), flush=True)
                break
    
    def transcription_thread(self):
        """Process audio chunks from queue and output transcriptions."""
        while self.running:
            try:
                # Get audio chunk with timeout
                audio_chunk = self.audio_queue.get(timeout=0.5)
                
                # Transcribe
                result = self.transcribe_chunk(audio_chunk)
                
                if result:
                    print(json.dumps(result), flush=True)
                    
            except queue.Empty:
                continue
            except Exception as e:
                print(json.dumps({"error": f"Transcription error: {str(e)}"}), flush=True)
    
    def start(self):
        """Start the streaming transcriber."""
        if not self.load_model():
            return False
        
        self.running = True
        
        # Start reader thread
        reader = threading.Thread(target=self.audio_reader_thread, daemon=True)
        reader.start()
        
        # Start transcription thread
        transcriber = threading.Thread(target=self.transcription_thread, daemon=True)
        transcriber.start()
        
        # Keep main thread alive
        try:
            while self.running:
                time.sleep(0.1)
        except KeyboardInterrupt:
            self.running = False
        
        return True


def main():
    # Parse command line args
    model_size = "base"  # Options: tiny, base, small, medium, large
    if len(sys.argv) > 1:
        model_size = sys.argv[1]
    
    transcriber = StreamingTranscriber(model_size=model_size)
    transcriber.start()


if __name__ == "__main__":
    main()
