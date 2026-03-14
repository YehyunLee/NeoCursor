const https = require('https');

/**
 * CommandDetector - Uses LLM to detect command intent from VSR text
 */
class CommandDetector {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.apiUrl = 'generativelanguage.googleapis.com';
    this.model = 'gemini-2.0-flash-exp';
  }   

  /**
   * Detect command from VSR text using Gemini
   * @param {string} text - Raw VSR output text
   * @returns {Promise<{command: string, params: object, confidence: number}>}
   */
  async detectCommand(text) {
    if (!this.apiKey) {
      console.warn('[CommandDetector] No API key, using fallback detection');
      return this.fallbackDetection(text);
    }

    const prompt = `You are a command parser for a silent speech interface. The user spoke silently and the lip-reading system detected: "${text}"

Your task: Identify the intended command from this list:
- alt_tab: Switch applications (phrases: "alt tab", "switch app", "next window")
- scroll_down: Scroll down (phrases: "scroll down", "down", "page down")
- scroll_up: Scroll up (phrases: "scroll up", "up", "page up")
- arrow_down: Press down arrow (phrases: "arrow down", "move down")
- arrow_up: Press up arrow (phrases: "arrow up", "move up")
- arrow_left: Press left arrow (phrases: "arrow left", "move left")
- arrow_right: Press right arrow (phrases: "arrow right", "move right")
- copy: Copy text (phrases: "copy", "copy that")
- paste: Paste text (phrases: "paste", "paste it")
- enter: Press enter (phrases: "enter", "return", "submit")
- escape: Press escape (phrases: "escape", "cancel", "close")
- backspace: Press backspace (phrases: "backspace", "delete", "back")

Respond ONLY with valid JSON in this exact format:
{"command": "command_name", "params": {}, "confidence": 0.95}

If no clear command is detected, respond:
{"command": "none", "params": {}, "confidence": 0.0}`;

    try {
      const response = await this.callGemini(prompt);
      const parsed = JSON.parse(response);
      console.log('[CommandDetector] Detected:', parsed);
      return parsed;
    } catch (error) {
      console.error('[CommandDetector] LLM detection failed:', error);
      return this.fallbackDetection(text);
    }
  }

  /**
   * Fallback command detection using simple keyword matching
   */
  fallbackDetection(text) {
    const lower = text.toLowerCase().trim();
    
    const patterns = [
      { regex: /alt\s*tab|switch|next\s*window/i, command: 'alt_tab', confidence: 0.8 },
      { regex: /scroll\s*down|scrolling\s*down/i, command: 'scroll_down', confidence: 0.9 },
      { regex: /scroll\s*up|scrolling\s*up/i, command: 'scroll_up', confidence: 0.9 },
      { regex: /^down$|arrow\s*down|move\s*down/i, command: 'arrow_down', confidence: 0.85 },
      { regex: /^up$|arrow\s*up|move\s*up/i, command: 'arrow_up', confidence: 0.85 },
      { regex: /copy/i, command: 'copy', confidence: 0.9 },
      { regex: /paste/i, command: 'paste', confidence: 0.9 },
      { regex: /enter|return|submit/i, command: 'enter', confidence: 0.85 },
      { regex: /escape|cancel|close/i, command: 'escape', confidence: 0.8 },
    ];

    for (const pattern of patterns) {
      if (pattern.regex.test(lower)) {
        console.log('[CommandDetector] Fallback matched:', pattern.command);
        return { command: pattern.command, params: {}, confidence: pattern.confidence };
      }
    }

    return { command: 'none', params: {}, confidence: 0.0 };
  }

  /**
   * Call Gemini API
   */
  callGemini(prompt) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 200
        }
      });

      const options = {
        hostname: this.apiUrl,
        path: `/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.candidates && parsed.candidates[0]?.content?.parts?.[0]?.text) {
              const text = parsed.candidates[0].content.parts[0].text.trim();
              // Extract JSON from markdown code blocks if present
              const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
              resolve(jsonMatch ? jsonMatch[1] || jsonMatch[0] : text);
            } else {
              reject(new Error('Invalid API response structure'));
            }
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }
}

module.exports = CommandDetector;
