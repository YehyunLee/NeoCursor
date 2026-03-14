// Speech-to-Text Handler using faster-whisper
const { spawn } = require('child_process');
const path = require('path');
const LLMImprover = require('./llm-improver');

class SpeechHandler {
  constructor() {
    this.isActive = false;
    this.transcriptionProcess = null;
    this.modelReady = false;
    this.stdoutBuffer = '';
    this.llmImprover = null;
    
    // Initialize LLM improver with API key from environment
    const apiKey = process.env.GEMINI_API_KEY || null;
    if (apiKey) {
      this.llmImprover = new LLMImprover(apiKey);
    } else {
      console.log('[Speech] No GEMINI_API_KEY found. Transcripts will not be improved.');
    }
    
    // Callback for when transcripts are ready to type
    this.onTranscriptReady = null;
  }

  start(modelSize = 'base') {
    if (this.isActive) {
      console.log('[Speech] Already active');
      return { success: false, error: 'Already active' };
    }

    const pythonCmd = process.platform === 'win32' ? 'py' : 'python3';
    const scriptPath = path.join(__dirname, 'speech_transcriber.py');

    console.log(`[Speech] Starting transcriber with model: ${modelSize}`);
    
    this.transcriptionProcess = spawn(pythonCmd, [scriptPath, modelSize], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.transcriptionProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.warn('[Speech-py]', msg);
    });

    this.transcriptionProcess.stdout.on('data', (data) => {
      this.stdoutBuffer += data.toString();
      
      // Process complete JSON lines
      let newlineIdx;
      while ((newlineIdx = this.stdoutBuffer.indexOf('\n')) !== -1) {
        const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
        
        if (!line) continue;
        
        try {
          const msg = JSON.parse(line);
          this._handleMessage(msg);
        } catch (e) {
          console.error('[Speech] Failed to parse output:', line);
        }
      }
    });

    this.transcriptionProcess.on('exit', (code) => {
      console.warn(`[Speech] Transcriber exited with code ${code}`);
      this.modelReady = false;
      this.isActive = false;
      this.transcriptionProcess = null;
    });

    this.transcriptionProcess.on('error', (err) => {
      console.error('[Speech] Failed to start transcriber:', err);
      this.modelReady = false;
      this.isActive = false;
      this.transcriptionProcess = null;
    });

    this.isActive = true;
    return { success: true };
  }

  async _handleMessage(msg) {
    if (msg.status === 'loading') {
      console.log(`[Speech] Loading model: ${msg.model}`);
    } else if (msg.status === 'ready') {
      this.modelReady = true;
      console.log('[Speech] Model ready');
    } else if (msg.status === 'error') {
      console.error('[Speech] Error:', msg.error);
      this.modelReady = false;
    } else if (msg.success && msg.text) {
      // Got a transcription
      console.log(`[Speech] Raw: "${msg.text}"`);
      
      // Optionally improve with LLM
      let finalText = msg.text;
      if (this.llmImprover && msg.text.trim().length > 0) {
        try {
          const t0 = Date.now();
          finalText = await this.llmImprover.improveTranscript(msg.text);
          console.log(`[Speech] LLM improved (${Date.now() - t0}ms): "${finalText}"`);
        } catch (err) {
          console.error('[Speech] LLM improvement failed:', err);
          finalText = msg.text + ' ';
        }
      } else {
        finalText = msg.text + ' ';
      }
      
      // Trigger callback to type the text
      if (this.onTranscriptReady) {
        this.onTranscriptReady(finalText);
      }
    } else if (msg.error) {
      console.error('[Speech] Transcription error:', msg.error);
    }
  }

  feedAudio(audioBuffer) {
    if (!this.isActive || !this.transcriptionProcess || !this.transcriptionProcess.stdin) {
      return false;
    }
    
    try {
      this.transcriptionProcess.stdin.write(audioBuffer);
      return true;
    } catch (err) {
      console.error('[Speech] Error feeding audio:', err);
      return false;
    }
  }

  stop() {
    if (!this.isActive) {
      return { success: false, error: 'Not active' };
    }

    console.log('[Speech] Stopping transcriber');
    
    if (this.transcriptionProcess) {
      try {
        this.transcriptionProcess.stdin.end();
        this.transcriptionProcess.kill();
      } catch (err) {
        console.error('[Speech] Error stopping process:', err);
      }
      this.transcriptionProcess = null;
    }

    this.isActive = false;
    this.modelReady = false;
    
    return { success: true };
  }
}

module.exports = SpeechHandler;
