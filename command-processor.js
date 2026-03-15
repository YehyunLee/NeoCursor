class CommandProcessor {
  constructor() {
    this.commandMap = {
      // Deletion commands
      'delete': { type: 'key', key: 'backspace' },
      'backspace': { type: 'key', key: 'backspace' },
      'remove': { type: 'key', key: 'backspace' },
      
      // Selection commands
      'select all': { type: 'shortcut', modifiers: ['command'], key: 'a' },
      'select everything': { type: 'shortcut', modifiers: ['command'], key: 'a' },
      
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
    this.maxCommandWords = 3;
    
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
    
    // Remove punctuation for command matching
    const cleanText = normalized.replace(/[.,!?;:]/g, '').trim();
    
    // Get unique words (in case of repetition like "enter enter")
    const words = cleanText.split(/\s+/).filter(w => w.length > 0);
    const uniqueWords = [...new Set(words)];
    
    // If all words are the same (repeated command), use just one
    const testText = uniqueWords.length === 1 ? uniqueWords[0] : cleanText;
    
    // Count unique words for length check
    const wordCount = uniqueWords.length;
    
    // If it's too long, it's probably not a command
    if (wordCount > this.maxCommandWords) {
      return { isCommand: false, action: null, originalText: text };
    }
    
    // Check for exact command match
    if (this.commandMap[testText]) {
      console.log(`[CommandProcessor] Detected command: "${testText}"`);
      return {
        isCommand: true,
        action: this.commandMap[testText],
        originalText: text,
        matchedCommand: testText
      };
    }
    
    // Check for partial matches (fuzzy matching for common variations)
    const fuzzyMatch = this.findFuzzyMatch(testText);
    if (fuzzyMatch) {
      console.log(`[CommandProcessor] Fuzzy matched: "${testText}" -> "${fuzzyMatch}"`);
      return {
        isCommand: true,
        action: this.commandMap[fuzzyMatch],
        originalText: text,
        matchedCommand: fuzzyMatch
      };
    }
    
    // Not a command, return as regular text
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
