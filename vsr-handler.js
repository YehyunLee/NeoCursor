// Visual Speech Recognition Handler
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class VSRHandler {
  constructor() {
    this.isRecording = false;
    this.recordedFrames = [];
    this.fps = 16;
    this.minFrames = 24; // Minimum 1.5 seconds at 16fps
    this.outputDir = path.join(__dirname, 'vsr_temp');
    this.pythonProcess = null;
    
    // Ensure temp directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  startRecording() {
    if (this.isRecording) return false;
    
    this.isRecording = true;
    this.recordedFrames = [];
    console.log('[VSR] Recording started');
    return true;
  }

  addFrame(frameData) {
    if (!this.isRecording) return;
    
    // frameData should be base64 encoded image
    this.recordedFrames.push(frameData);
  }

  async stopRecording() {
    if (!this.isRecording) return null;
    
    this.isRecording = false;
    const frameCount = this.recordedFrames.length;
    
    console.log(`[VSR] Recording stopped. Captured ${frameCount} frames`);
    
    if (frameCount < this.minFrames) {
      console.log(`[VSR] Recording too short (${frameCount} frames). Minimum is ${this.minFrames}.`);
      this.recordedFrames = [];
      return null;
    }

    // Save frames as video file
    const timestamp = Date.now();
    const videoPath = path.join(this.outputDir, `speech_${timestamp}.mp4`);
    
    try {
      await this.saveFramesAsVideo(videoPath);
      console.log(`[VSR] Video saved to ${videoPath}`);
      
      // Process with VSR engine (placeholder for now)
      const result = await this.processVideo(videoPath);
      
      // Cleanup
      this.recordedFrames = [];
      
      return result;
    } catch (error) {
      console.error('[VSR] Error processing recording:', error);
      this.recordedFrames = [];
      return null;
    }
  }

  async saveFramesAsVideo(outputPath) {
    return new Promise((resolve, reject) => {
      // For now, we'll save frames as individual images
      // In production, you'd use ffmpeg to create video
      const frameDir = path.join(this.outputDir, `frames_${Date.now()}`);
      fs.mkdirSync(frameDir, { recursive: true });
      
      this.recordedFrames.forEach((frameData, index) => {
        const framePath = path.join(frameDir, `frame_${String(index).padStart(4, '0')}.jpg`);
        const base64Data = frameData.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(framePath, Buffer.from(base64Data, 'base64'));
      });
      
      // Create a simple video using ffmpeg if available
      const ffmpeg = spawn('ffmpeg', [
        '-framerate', String(this.fps),
        '-i', path.join(frameDir, 'frame_%04d.jpg'),
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-y',
        outputPath
      ]);

      ffmpeg.on('close', (code) => {
        // Cleanup frame directory
        fs.rmSync(frameDir, { recursive: true, force: true });
        
        if (code === 0) {
          resolve(outputPath);
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });

      ffmpeg.on('error', (err) => {
        // If ffmpeg not available, just resolve with frame directory
        console.warn('[VSR] ffmpeg not available, skipping video creation');
        resolve(frameDir);
      });
    });
  }

  async processVideo(videoPath) {
    // Placeholder for VSR processing
    // In production, this would call the actual VSR inference engine
    
    return new Promise((resolve) => {
      // Simulate processing delay
      setTimeout(() => {
        resolve({
          text: '[VSR Output Placeholder - Engine Not Connected]',
          confidence: 0.0,
          videoPath: videoPath
        });
      }, 500);
    });
  }

  cleanup() {
    // Clean up temp files
    if (fs.existsSync(this.outputDir)) {
      const files = fs.readdirSync(this.outputDir);
      files.forEach(file => {
        const filePath = path.join(this.outputDir, file);
        try {
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          }
        } catch (err) {
          console.error(`[VSR] Error cleaning up ${filePath}:`, err);
        }
      });
    }
  }
}

module.exports = VSRHandler;
