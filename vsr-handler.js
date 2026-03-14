// Visual Speech Recognition Handler
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const LLMImprover = require('./llm-improver');

class VSRHandler {
  constructor() {
    this.isRecording = false;
    this.recordedFrames = [];
    this.fps = 25; // Match LRS3 capture rate to avoid resampling artifacts
    this.minFrames = 50; // Minimum 2 seconds at 25fps
    this.outputDir = path.join(__dirname, 'vsr_temp');
    this.serverProcess = null;
    this.serverReady = false;
    this.pendingRequests = [];  // queue of {resolve, reject} for in-flight requests
    this.stdoutBuffer = '';
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

    // Start persistent Python server process
    this._startServer();
  }

  _startServer() {
    const pythonCmd = process.platform === 'win32' ? 'py' : 'python3';
    const scriptPath = path.join(__dirname, 'vsr_inference.py');

    console.log('[VSR] Starting persistent inference server...');
    this.serverProcess = spawn(pythonCmd, [scriptPath, '--server'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.serverProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.warn('[VSR-py]', msg);
    });

    this.serverProcess.stdout.on('data', (data) => {
      this.stdoutBuffer += data.toString();
      // Process complete JSON lines
      let newlineIdx;
      while ((newlineIdx = this.stdoutBuffer.indexOf('\n')) !== -1) {
        const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.status === 'ready') {
            this.serverReady = true;
            console.log('[VSR] Inference server ready (model loaded)');
          } else if (msg.status === 'error') {
            console.error('[VSR] Server failed to start:', msg.error);
            this.serverReady = false;
          } else if (this.pendingRequests.length > 0) {
            const { resolve } = this.pendingRequests.shift();
            resolve(msg);
          }
        } catch (e) {
          console.error('[VSR] Failed to parse server output:', line);
        }
      }
    });

    this.serverProcess.on('exit', (code) => {
      console.warn(`[VSR] Server process exited with code ${code}`);
      this.serverReady = false;
      // Reject any pending requests
      while (this.pendingRequests.length > 0) {
        const { resolve } = this.pendingRequests.shift();
        resolve({ error: 'Server process exited unexpectedly' });
      }
      this.serverProcess = null;
    });

    this.serverProcess.on('error', (err) => {
      console.error('[VSR] Failed to start server process:', err);
      this.serverReady = false;
      this.serverProcess = null;
    });
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
      let t0 = Date.now();
      const savedPath = await this.saveFramesAsVideo(videoPath);
      console.log(`[VSR] Video saved to ${savedPath} (${Date.now() - t0}ms)`);
      
      t0 = Date.now();
      const rawResult = await this.processVideo(savedPath);
      console.log(`[VSR] Raw inference: "${rawResult.text}" (${Date.now() - t0}ms)`);
      
      // Send all non-error outputs through LLM correction
      let improvedResult;
      const rawText = rawResult.text || '';
      if (this.llmImprover && rawText.trim().length > 0 && !rawText.startsWith('Error:') && !rawText.startsWith('[')) {
        t0 = Date.now();
        improvedResult = await this.llmImprover.improveTranscript(rawText);
        console.log(`[VSR] LLM improved (${Date.now() - t0}ms): "${improvedResult}"`);
      } else {
        improvedResult = rawText;
        if (!this.llmImprover) console.log(`[VSR] No LLM configured, using raw output`);
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
      let ffmpegFailed = false;
      const ffmpeg = spawn('ffmpeg', [
        '-framerate', String(this.fps),
        '-i', path.join(frameDir, 'frame_%04d.jpg'),
        '-vf', 'format=gray',
        '-c:v', 'mpeg4',
        '-q:v', '5',
        '-y',
        outputPath
      ]);

      ffmpeg.on('close', (code) => {
        if (ffmpegFailed) return;
        // Only clean up frames when ffmpeg succeeded (video file replaces them)
        if (code === 0) {
          fs.rmSync(frameDir, { recursive: true, force: true });
          resolve(outputPath);
        } else {
          resolve(frameDir);
        }
      });

      ffmpeg.on('error', (err) => {
        ffmpegFailed = true;
        console.warn('[VSR] ffmpeg not available, keeping frames directory');
        resolve(frameDir);
      });
    });
  }

  async processVideo(videoPath) {
    // Use persistent server if available, otherwise fall back to single-shot
    if (this.serverReady && this.serverProcess && this.serverProcess.stdin) {
      return this._processViaServer(videoPath);
    }
    return this._processViaSingleShot(videoPath);
  }

  _processViaServer(videoPath) {
    return new Promise((resolve) => {
      console.log(`[VSR] Sending to server: ${videoPath}`);
      this.pendingRequests.push({
        resolve: (msg) => {
          if (msg.success) {
            console.log(`[VSR] Inference successful: "${msg.text}"`);
            resolve({ text: msg.text || '[No speech detected]', confidence: 1.0, videoPath });
          } else if (msg.error) {
            console.error(`[VSR] Inference error: ${msg.error}`);
            resolve({ text: `Error: ${msg.error}`, confidence: 0.0, videoPath });
          } else {
            resolve({ text: '[Unexpected response format]', confidence: 0.0, videoPath });
          }
        }
      });
      this.serverProcess.stdin.write(videoPath + '\n');
    });
  }

  _processViaSingleShot(videoPath) {
    return new Promise((resolve) => {
      const pythonCmd = process.platform === 'win32' ? 'py' : 'python3';
      const scriptPath = path.join(__dirname, 'vsr_inference.py');

      console.log(`[VSR] Fallback single-shot: ${pythonCmd} ${scriptPath} ${videoPath}`);
      const proc = spawn(pythonCmd, [scriptPath, videoPath]);

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          console.error(`[VSR] Python exited ${code}: ${stderr}`);
          try {
            const err = JSON.parse(stdout);
            if (err.error) { resolve({ text: `Error: ${err.error}`, confidence: 0.0, videoPath }); return; }
          } catch (_) {}
          resolve({ text: '[VSR Engine Error]', confidence: 0.0, videoPath });
          return;
        }
        try {
          const result = JSON.parse(stdout);
          if (result.success) {
            resolve({ text: result.text || '[No speech detected]', confidence: 1.0, videoPath });
          } else {
            resolve({ text: `Error: ${result.error || 'unknown'}`, confidence: 0.0, videoPath });
          }
        } catch (e) {
          console.error(`[VSR] Parse error: ${e}\nstdout: ${stdout}`);
          resolve({ text: '[Failed to parse VSR output]', confidence: 0.0, videoPath });
        }
      });

      proc.on('error', (err) => {
        console.error(`[VSR] Failed to start Python: ${err}`);
        resolve({ text: '[VSR Engine Not Available]', confidence: 0.0, videoPath });
      });
    });
  }

  cleanup() {
    // Shut down persistent server
    if (this.serverProcess) {
      try {
        this.serverProcess.stdin.end();
        this.serverProcess.kill();
      } catch (_) {}
      this.serverProcess = null;
      this.serverReady = false;
    }

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
