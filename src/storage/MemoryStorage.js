/**
 * MemoryStorage.js
 *
 * In-memory storage adapter (no persistence)
 */

class MemoryStorage {
  constructor() {
    this.state = { actions: [] };
  }

  /**
   * Load state from memory
   */
  load() {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Save state to memory
   */
  save(state) {
    this.state = JSON.parse(JSON.stringify(state));
  }
}

module.exports = MemoryStorage;
