/**
 * FileStorage.js
 *
 * Pluggable file-based storage adapter
 */

const fs = require('fs');
const path = require('path');

class FileStorage {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
  }

  /**
   * Load state from file
   */
  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf8');
        const state = JSON.parse(data);

        // Convert date strings back to Date objects
        if (state.actions) {
          state.actions = state.actions.map(action => {
            if (action.date) {
              action.date = new Date(action.date);
            }
            if (action.repeat && action.repeat.endDate) {
              action.repeat.endDate = new Date(action.repeat.endDate);
            }
            return action;
          });
        }

        return state;
      }
    } catch (error) {
      throw new Error(`Failed to load from ${this.filePath}: ${error.message}`);
    }

    return { actions: [] };
  }

  /**
   * Save state to file
   */
  save(state) {
    try {
      const data = JSON.stringify(state, null, 2);
      fs.writeFileSync(this.filePath, data, 'utf8');
    } catch (error) {
      throw new Error(`Failed to save to ${this.filePath}: ${error.message}`);
    }
  }
}

module.exports = FileStorage;
