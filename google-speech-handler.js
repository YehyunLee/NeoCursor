// Google Speech-to-Text v2 Handler
const speech = require('@google-cloud/speech');
const { Writable } = require('stream');

class GoogleSpeechHandler {
  constructor(apiKey) {
    this.isActive = false;
    this.client = null;
    this.recognizeStream = null;
    this.onTranscriptReady = null;
    
    // Initialize client with API key
    if (apiKey) {
      this.client = new speech.SpeechClient({
        apiKey: apiKey
      });
    } else {
      console.error('[GoogleSpeech] No API key provided');
    }
  }

  start() {
    if (this.isActive) {
      console.log('[GoogleSpeech] Already active');
      return { success: false, error: 'Already active' };
    }

    if (!this.client) {
      return { success: false, error: 'No API key configured' };
    }

    console.log('[GoogleSpeech] Starting streaming recognition');

    const request = {
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
        model: 'latest_long',
        useEnhanced: true,
      },
      interimResults: false,
    };

    try {
      this.recognizeStream = this.client
        .streamingRecognize(request)
        .on('error', (error) => {
          console.error('[GoogleSpeech] Stream error:', error);
          this.isActive = false;
        })
        .on('data', (data) => {
          if (data.results[0] && data.results[0].alternatives[0]) {
            const transcript = data.results[0].alternatives[0].transcript;
            const isFinal = data.results[0].isFinal;
            
            if (isFinal) {
              console.log(`[GoogleSpeech] Final: "${transcript}"`);
              
              // Trigger callback to type the text
              if (this.onTranscriptReady) {
                this.onTranscriptReady(transcript + ' ');
              }
            } else {
              console.log(`[GoogleSpeech] Interim: "${transcript}"`);
            }
          }
        });

      this.isActive = true;
      return { success: true };
    } catch (error) {
      console.error('[GoogleSpeech] Failed to start:', error);
      return { success: false, error: error.message };
    }
  }

  feedAudio(audioBuffer) {
    if (!this.isActive || !this.recognizeStream) {
      return false;
    }
    
    try {
      this.recognizeStream.write(audioBuffer);
      return true;
    } catch (err) {
      console.error('[GoogleSpeech] Error feeding audio:', err);
      return false;
    }
  }

  stop() {
    if (!this.isActive) {
      return { success: false, error: 'Not active' };
    }

    console.log('[GoogleSpeech] Stopping recognition');
    
    if (this.recognizeStream) {
      try {
        this.recognizeStream.end();
      } catch (err) {
        console.error('[GoogleSpeech] Error stopping stream:', err);
      }
      this.recognizeStream = null;
    }

    this.isActive = false;
    return { success: true };
  }
}

module.exports = GoogleSpeechHandler;
