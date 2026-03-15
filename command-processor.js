class CommandProcessor {
  constructor() {
    this.commandMap = {
      // Deletion commands
      'delete': { type: 'key', key: 'backspace' },
      'delete everything': { type: 'key', key: 'backspace' },
      'delete all': { type: 'key', key: 'backspace' },
      'clear': { type: 'key', key: 'backspace' },
      'clear all': { type: 'key', key: 'backspace' },
      'backspace': { type: 'key', key: 'backspace' },
      'remove': { type: 'key', key: 'backspace' },
      'remove all': { type: 'key', key: 'backspace' },
      
      // Selection commands
      'select all': { type: 'shortcut', modifiers: ['command'], key: 'a' },
      'select everything': { type: 'shortcut', modifiers: ['command'], key: 'a' },
      'highlight everything': { type: 'shortcut', modifiers: ['command'], key: 'a' },
      'highlight all': { type: 'shortcut', modifiers: ['command'], key: 'a' },
      'select r': { type: 'shortcut', modifiers: ['command'], key: 'a' },
      'select or': { type: 'shortcut', modifiers: ['command'], key: 'a' },
      
      // Navigation
      'enter': { type: 'key', key: 'enter' },
      'return': { type: 'key', key: 'enter' },
      'space': { type: 'key', key: 'space' },
      'tab': { type: 'key', key: 'tab' },
      'escape': { type: 'key', key: 'escape' },
      
      // Copy/Paste/Cut
      'copy': { type: 'shortcut', modifiers: ['command'], key: 'c' },
      'paste': { type: 'shortcut', modifiers: ['command'], key: 'v' },
      'cut': { type: 'shortcut', modifiers: ['command'], key: 'x' },
      
      // Undo/Redo
      'undo': { type: 'shortcut', modifiers: ['command'], key: 'z' },
      'redo': { type: 'shortcut', modifiers: ['command', 'shift'], key: 'z' },
      
      // Save
      'save': { type: 'shortcut', modifiers: ['command'], key: 's' },
      
      // Find
      'find': { type: 'shortcut', modifiers: ['command'], key: 'f' },
      'search': { type: 'shortcut', modifiers: ['command'], key: 'f' },
      
      // Window management
      'close': { type: 'shortcut', modifiers: ['command'], key: 'w' },
      'quit': { type: 'shortcut', modifiers: ['command'], key: 'q' },
      'new tab': { type: 'shortcut', modifiers: ['command'], key: 't' },
      'new window': { type: 'shortcut', modifiers: ['command'], key: 'n' },
      
      // Arrow keys
      'up': { type: 'key', key: 'up' },
      'down': { type: 'key', key: 'down' },
      'left': { type: 'key', key: 'left' },
      'right': { type: 'key', key: 'right' },
      
      // Page navigation
      'page up': { type: 'key', key: 'pageup' },
      'page down': { type: 'key', key: 'pagedown' },
      'home': { type: 'key', key: 'home' },
      'end': { type: 'key', key: 'end' }
    };
    
    // Maximum word count to consider as a command (not a sentence)
    this.maxCommandWords = 4;
    
    // Minimum confidence threshold for command detection
    this.minConfidence = 0.6;
  }
  
  /**
   * Process transcript and determine if it's a command or regular text
   * @param {string} text - The transcribed text
   * @returns {Object} - { isCommand: boolean, action: Object|null, originalText: string }
   */
  processTranscript(text) {
    if (!text || typeof text !== 'string') {
      return { isCommand: false, action: null, originalText: text };
    }
    
    const normalized = text.toLowerCase().trim();
    
    // Remove punctuation/hyphens for command matching
    const cleanText = normalized
      .replace(/[\-_/]/g, ' ')
      .replace(/[.,!?;:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (!cleanText) {
      return { isCommand: false, action: null, originalText: text };
    }
    
    // Get unique words (in case of repetition like "enter enter")
    const words = cleanText.split(/\s+/).filter(w => w.length > 0);
    const uniqueWords = [...new Set(words)];
    
    // Skip command detection if input is too long (likely a sentence, not a command)
    if (words.length > this.maxCommandWords) {
      return { isCommand: false, action: null, originalText: text };
    }
    
    // Prefer single word when everything is repeated ("enter enter")
    const repeatedCandidate = uniqueWords.length === 1 ? uniqueWords[0] : null;
    
    const match = this.matchCommand(cleanText) ||
      (repeatedCandidate ? this.matchCommand(repeatedCandidate) : null) ||
      this.findCommandInWords(words);
    
    if (match) {
      console.log(`[CommandProcessor] Detected command: "${match}"`);
      return {
        isCommand: true,
        action: this.commandMap[match],
        originalText: text,
        matchedCommand: match
      };
    }
    
    return { isCommand: false, action: null, originalText: text };
  }
  
  /**
   * Find fuzzy match for common command variations
   * @param {string} text - Normalized text
   * @returns {string|null} - Matched command key or null
   */
  findFuzzyMatch(text) {
    // Common variations
    const variations = {
      'del': 'delete',
      'erase': 'delete',
      'ctrl a': 'select all',
      'control a': 'select all',
      'command a': 'select all',
      'ctrl-a': 'select all',
      'control-a': 'select all',
      'command-a': 'select all',
      'select r': 'select all',
      'select or': 'select all',
      'contrary a': 'select all',
      'ctrl c': 'copy',
      'control c': 'copy',
      'command c': 'copy',
      'ctrl v': 'paste',
      'control v': 'paste',
      'command v': 'paste',
      'ctrl x': 'cut',
      'control x': 'cut',
      'command x': 'cut',
      'ctrl z': 'undo',
      'control z': 'undo',
      'command z': 'undo',
      'ctrl s': 'save',
      'control s': 'save',
      'command s': 'save',
      'spacebar': 'space',
      'press enter': 'enter',
      'press space': 'space',
      'hit enter': 'enter',
      'hit space': 'space'
    };
    
    if (variations[text]) {
      return variations[text];
    }
    
    // Check if text contains a command word
    for (const [key, value] of Object.entries(variations)) {
      if (text.includes(key)) {
        return value;
      }
    }
    
    return null;
  }

  matchCommand(text) {
    if (!text) return null;
    if (this.commandMap[text]) {
      return text;
    }
    const fuzzy = this.findFuzzyMatch(text);
    if (fuzzy) {
      return fuzzy;
    }
    return null;
  }

  findCommandInWords(words) {
    if (!words || words.length === 0) {
      return null;
    }
    const maxWindow = Math.min(this.maxCommandWords, words.length);
    for (let window = maxWindow; window >= 1; window--) {
      for (let i = 0; i <= words.length - window; i++) {
        const phrase = words.slice(i, i + window).join(' ');
        const match = this.matchCommand(phrase);
        if (match) {
          return match;
        }
      }
    }
    return null;
  }
  
  /**
   * Add a custom command mapping
   * @param {string} phrase - The phrase to recognize
   * @param {Object} action - The action to perform
   */
  addCommand(phrase, action) {
    this.commandMap[phrase.toLowerCase()] = action;
  }
  
  /**
   * Remove a command mapping
   * @param {string} phrase - The phrase to remove
   */
  removeCommand(phrase) {
    delete this.commandMap[phrase.toLowerCase()];
  }
  
  /**
   * Get all registered commands
   * @returns {Object} - Command map
   */
  getCommands() {
    return { ...this.commandMap };
  }
}

module.exports = CommandProcessor;
