// Speech-to-Text Handler using faster-whisper
const { spawn } = require('child_process');
const path = require('path');
const LLMImprover = require('./llm-improver');

class SpeechHandler {
  constructor(llmProvider = 'gemini', llmApiKey = null) {
    this.isActive = false;
    this.transcriptionProcess = null;
    this.modelReady = false;
    this.stdoutBuffer = '';
    this.onTranscriptReady = null;
    
    // Initialize LLM improver with provided settings
    if (llmApiKey && llmProvider !== 'none') {
      this.llmImprover = new LLMImprover(llmApiKey, llmProvider);
      console.log(`[Speech] LLM improver initialized with provider: ${llmProvider}`);
    } else {
      console.log('[Speech] No LLM API key configured. Transcripts will not be improved.');
    }
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
      let llmResult = { text: msg.text, command: null };
      if (this.llmImprover && msg.text.trim().length > 0) {
        try {
          const t0 = Date.now();
          llmResult = await this.llmImprover.improveTranscript(msg.text);
          console.log(`[Speech] LLM improved (${Date.now() - t0}ms): "${llmResult.text}"${llmResult.command ? ' [cmd=' + llmResult.command + ']' : ''}`);
        } catch (err) {
          console.error('[Speech] LLM improvement failed:', err);
          llmResult = { text: msg.text, command: null };
        }
      }
      
      const payload = {
        text: (llmResult.text && llmResult.text.length > 0 ? llmResult.text : msg.text) + ' ',
        commandHint: llmResult.command
      };
      
      // Trigger callback to type the text / command
      if (this.onTranscriptReady) {
        this.onTranscriptReady(payload);
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
