const https = require('https');

class LLMImprover {
  constructor(apiKey, provider = 'gemini') {
    this.apiKey = apiKey;
    this.provider = provider;
    
    // Configure based on provider
    if (provider === 'bitdeer') {
      this.model = 'deepseek-chat';  // Bitdeer AI uses DeepSeek models
      this.baseUrl = 'https://api.bitdeer.ai/v1';
    } else {
      this.model = 'gemini-2.0-flash-exp';
      this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    }
  }

  async improveTranscript(rawText) {
    const fallback = { text: rawText || '', command: null };

    if (!rawText || rawText.trim().length === 0) {
      return fallback;
    }

    if (!this.apiKey) {
      console.log('[LLM] No API key configured, returning raw text');
      return fallback;
    }

    try {
      const prompt = `You are helping a hands-free computer control system.
Given a noisy speech transcript, do two things:
1. Clean up the text by fixing spelling/grammar while keeping the same meaning.
2. Decide if the user is issuing a direct command (e.g., "delete everything", "select all", "press enter"). If so, set "command" to a concise imperative phrase that the system can act on. Otherwise set "command" to null.

Return STRICT JSON with this shape (no explanations):
{ "text": "<cleaned sentence>", "command": "<command phrase>" | null }

Input Text: ${rawText}`;

      let requestBody;
      if (this.provider === 'bitdeer') {
        // Bitdeer AI uses OpenAI-compatible format
        requestBody = JSON.stringify({
          model: this.model,
          messages: [{
            role: 'user',
            content: prompt
          }],
          temperature: 0.2,
          max_tokens: 256
        });
      } else {
        // Gemini format
        requestBody = JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.2,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 256
          }
        });
      }

      const result = await this._makeRequest(requestBody);
      
      if (!result) {
        console.log('[LLM] No response from API, returning raw text');
        return fallback;
      }

      if (result.error) {
        console.error('[LLM] API error:', result.error);
        return fallback;
      }

      let rawResponse;
      if (this.provider === 'bitdeer') {
        // Bitdeer AI response format
        if (!result.choices || result.choices.length === 0) {
          console.log('[LLM] No choices in response:', JSON.stringify(result));
          return fallback;
        }
        rawResponse = result.choices[0].message.content.trim();
      } else {
        // Gemini response format
        if (!result.candidates || result.candidates.length === 0) {
          console.log('[LLM] No candidates in response:', JSON.stringify(result));
          return fallback;
        }
        rawResponse = result.candidates[0].content.parts[0].text.trim();
      }
      
      const parsed = this._parseJsonResponse(rawResponse, fallback);

      if (parsed.text && parsed.text.length > 0) {
        parsed.text = this._normalizeSentence(parsed.text);
      } else {
        parsed.text = fallback.text;
      }

      console.log(`[LLM] Improved: "${rawText}" → "${parsed.text}"${parsed.command ? ' [cmd=' + parsed.command + ']' : ''}`);
      return parsed;
    } catch (error) {
      console.error('[LLM] Error improving transcript:', error.message);
      return fallback;
    }
  }

  _normalizeSentence(text) {
    let trimmed = text.trim();
    if (trimmed.length === 0) return '';

    trimmed = trimmed[0].toUpperCase() + trimmed.slice(1);
    if (!/[.!?]$/.test(trimmed)) {
      trimmed += '.';
    }
    return trimmed;
  }

  _parseJsonResponse(responseText, fallback) {
    const tryParse = (text) => {
      try {
        const obj = JSON.parse(text);
        if (obj && typeof obj === 'object') {
          return {
            text: typeof obj.text === 'string' ? obj.text : fallback.text,
            command: typeof obj.command === 'string' && obj.command.trim().length > 0 ? obj.command.trim() : null
          };
        }
      } catch (_) {
        return null;
      }
      return null;
    };

    let parsed = tryParse(responseText);
    if (parsed) return parsed;

    // Attempt to find JSON block inside response
    const match = responseText.match(/\{[\s\S]*\}/);
    if (match) {
      parsed = tryParse(match[0]);
      if (parsed) return parsed;
    }

    return { ...fallback };
  }

  _makeRequest(body) {
    return new Promise((resolve, reject) => {
      let url, headers;
      
      if (this.provider === 'bitdeer') {
        url = `${this.baseUrl}/chat/completions`;
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Length': Buffer.byteLength(body)
        };
      } else {
        url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;
        headers = {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        };
      }
      
      const urlObj = new URL(url);

      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: headers
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode !== 200) {
            console.error(`[LLM] API returned status ${res.statusCode}`);
            console.error(`[LLM] Response: ${data}`);
            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (error) {
              resolve(null);
            }
            return;
          }

          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (error) {
            console.error('[LLM] Failed to parse API response:', error.message);
            console.error('[LLM] Raw response:', data);
            resolve(null);
          }
        });
      });

      req.on('error', (error) => {
        console.error('[LLM] Request error:', error.message);
        resolve(null);
      });

      req.write(body);
      req.end();
    });
  }
}

module.exports = LLMImprover;
