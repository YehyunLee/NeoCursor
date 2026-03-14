const https = require('https');

class LLMImprover {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.model = 'gemini-1.5-flash-latest';
  }

  async improveTranscript(rawText) {
    if (!this.apiKey) {
      console.log('[LLM] No API key configured, returning raw text');
      return rawText;
    }

    if (!rawText || rawText.trim().length === 0) {
      return rawText;
    }

    try {
      const prompt = `Correct the typographical errors, spelling mistakes, and grammar in the following transcribed text. The text is derived from visual lip movement inference, so expect some wildly misinterpreted characters. Do NOT add new context or conversational filler. Output ONLY the corrected continuous text. Do not provide a list of changes or explanations.

Input Text: ${rawText}`;

      const requestBody = JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.1,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 1024
        }
      });

      const result = await this._makeRequest(requestBody);
      
      if (!result) {
        console.log('[LLM] No response from API, returning raw text');
        return rawText;
      }

      if (result.error) {
        console.error('[LLM] API error:', result.error);
        return rawText;
      }

      if (!result.candidates || result.candidates.length === 0) {
        console.log('[LLM] No candidates in response:', JSON.stringify(result));
        return rawText;
      }

      let corrected = result.candidates[0].content.parts[0].text.trim();
      
      // Ensure proper capitalization and punctuation
      if (corrected.length > 0) {
        corrected = corrected[0].toUpperCase() + corrected.slice(1);
      }
      
      if (!corrected.endsWith('.') && !corrected.endsWith('?') && !corrected.endsWith('!')) {
        corrected += '.';
      }

      console.log(`[LLM] Improved: "${rawText}" → "${corrected}"`);
      return corrected;
    } catch (error) {
      console.error('[LLM] Error improving transcript:', error.message);
      return rawText;
    }
  }

  _makeRequest(body) {
    return new Promise((resolve, reject) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
      const urlObj = new URL(url);

      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
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
