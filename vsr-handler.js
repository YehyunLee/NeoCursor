// Visual Speech Recognition Handler
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const LLMImprover = require('./llm-improver');

class VSRHandler {
  constructor() {
    this.isRecording = false;
    this.recordedFrames = [];
    this.fps = 16;
    this.minFrames = 24; // Minimum 1.5 seconds at 16fps
    this.outputDir = path.join(__dirname, 'vsr_temp');
    this.pythonProcess = null;
    this.llmImprover = null;
    
    // Ensure temp directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    
    // Initialize LLM improver with API key from environment
    const apiKey = process.env.GEMINI_API_KEY || null;
    if (apiKey) {
      this.llmImprover = new LLMImprover(apiKey);
    } else {
      console.log('[VSR] No GEMINI_API_KEY found. VSR transcripts will not be improved.');
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
      const rawResult = await this.processVideo(videoPath);
      console.log(`[VSR] Raw inference: "${rawResult.text}"`);
      
      // Improve transcript with LLM
      let improvedResult;
      if (this.llmImprover) {
        improvedResult = await this.llmImprover.improveTranscript(rawResult.text);
        console.log(`[VSR] Final result: "${improvedResult}"`);
      } else {
        improvedResult = rawResult.text;
      }
      
      // Cleanup
      this.recordedFrames = [];
      
      return {
        text: improvedResult,
        confidence: rawResult.confidence,
        videoPath: videoPath
      };
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
    return new Promise((resolve, reject) => {
      // Determine Python executable (try python3 first, fallback to python)
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      const scriptPath = path.join(__dirname, 'vsr_inference.py');
      
      console.log(`[VSR] Running inference: ${pythonCmd} ${scriptPath} ${videoPath}`);
      
      const pythonProcess = spawn(pythonCmd, [scriptPath, videoPath]);
      
      let stdout = '';
      let stderr = '';
      
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          console.error(`[VSR] Python process exited with code ${code}`);
          console.error(`[VSR] stderr: ${stderr}`);
          
          // Try to parse error from stdout
          try {
            const errorResult = JSON.parse(stdout);
            if (errorResult.error) {
              resolve({
                text: `Error: ${errorResult.error}`,
                confidence: 0.0,
                videoPath: videoPath
              });
              return;
            }
          } catch (e) {
            // Not JSON, use raw error
          }
          
          resolve({
            text: '[VSR Engine Error - Check console for details]',
            confidence: 0.0,
            videoPath: videoPath
          });
          return;
        }
        
        try {
          const result = JSON.parse(stdout);
          
          if (result.success) {
            console.log(`[VSR] Inference successful: "${result.text}"`);
            resolve({
              text: result.text || '[No speech detected]',
              confidence: 1.0,
              videoPath: videoPath
            });
          } else if (result.error) {
            console.error(`[VSR] Inference error: ${result.error}`);
            resolve({
              text: `Error: ${result.error}`,
              confidence: 0.0,
              videoPath: videoPath
            });
          } else {
            resolve({
              text: '[Unexpected response format]',
              confidence: 0.0,
              videoPath: videoPath
            });
          }
        } catch (error) {
          console.error(`[VSR] Failed to parse Python output: ${error}`);
          console.error(`[VSR] stdout: ${stdout}`);
          resolve({
            text: '[Failed to parse VSR output]',
            confidence: 0.0,
            videoPath: videoPath
          });
        }
      });
      
      pythonProcess.on('error', (error) => {
        console.error(`[VSR] Failed to start Python process: ${error}`);
        resolve({
          text: '[VSR Engine Not Available - Install Python and dependencies]',
          confidence: 0.0,
          videoPath: videoPath
        });
      });
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
