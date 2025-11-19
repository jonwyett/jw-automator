/**
 * Automator.js
 *
 * Main API class for jw-automator v3
 */

const SchedulerHost = require('./host/SchedulerHost');
const CoreEngine = require('./core/CoreEngine');
const FileStorage = require('./storage/FileStorage');
const MemoryStorage = require('./storage/MemoryStorage');

class Automator {
  constructor(options = {}) {
    this.options = {
      storage: options.storage || new MemoryStorage(),
      autoSave: options.autoSave !== false, // default true
      saveInterval: options.saveInterval || 5000, // 5 seconds
      ...options
    };

    this.host = new SchedulerHost();
    this.nextId = 1;
    this.saveTimer = null;

    // Forward events from host
    this.host.on('ready', (...args) => this._emit('ready', ...args));
    this.host.on('action', (...args) => this._emit('action', ...args));
    this.host.on('error', (...args) => this._emit('error', ...args));
    this.host.on('debug', (...args) => this._emit('debug', ...args));

    // Event listeners
    this.listeners = new Map();

    // Load initial state
    this._loadState();
  }

  /**
   * Seed the automator with initial actions (runs only on first use)
   *
   * @param {Function} callback - Function to execute when database is empty
   * @returns {boolean} - True if seeding ran, false if skipped
   */
  seed(callback) {
    if (typeof callback !== 'function') {
      throw new Error('seed() requires a callback function');
    }

    const state = this.host.getState();

    // Check if already populated
    if (state.actions && state.actions.length > 0) {
      return false;
    }

    // Execute seeding callback
    callback(this);

    // Immediately save the seeded state
    this._saveState();

    return true;
  }

  /**
   * Start the automator
   */
  start() {
    this.host.start();

    // Start auto-save if enabled
    if (this.options.autoSave) {
      this._startAutoSave();
    }
  }

  /**
   * Stop the automator
   */
  stop() {
    this.host.stop();

    // Stop auto-save
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }

    // Final save
    if (this.options.autoSave) {
      this._saveState();
    }
  }

  /**
   * Register a command function
   */
  addFunction(name, fn) {
    this.host.addFunction(name, fn);
  }

  /**
   * Remove a command function
   */
  removeFunction(name) {
    this.host.removeFunction(name);
  }

  /**
   * Add an action
   */
  addAction(actionSpec) {
    // Validate action (includes defensive coercion)
    this._validateAction(actionSpec);

    // Normalize catchUpWindow (handles backwards compatibility with unBuffered)
    const catchUpWindow = this._normalizeCatchUpWindow(actionSpec);

    // Defensive: Default missing date to 5 seconds from now
    let startDate;
    if (!actionSpec.date) {
      startDate = new Date(Date.now() + 5000);
      this._emit('debug', {
        type: 'debug',
        message: 'No date provided - defaulting to 5 seconds from now'
      });
    } else {
      startDate = new Date(actionSpec.date);
    }

    // Create action with state
    const action = {
      id: this.nextId++,
      name: actionSpec.name || null,
      cmd: actionSpec.cmd,
      payload: actionSpec.payload !== undefined ? actionSpec.payload : null,
      date: startDate,
      unBuffered: actionSpec.unBuffered !== undefined ? actionSpec.unBuffered : false,
      catchUpWindow: catchUpWindow,
      repeat: actionSpec.repeat ? { ...actionSpec.repeat } : null,
      count: 0
    };

    // Set default dstPolicy if not specified
    if (action.repeat && !action.repeat.dstPolicy) {
      action.repeat.dstPolicy = 'once';
    }

    this.host.addAction(action);

    this._emit('update', {
      type: 'update',
      operation: 'add',
      action: { ...action }
    });

    if (this.options.autoSave) {
      this._saveState();
    }

    return action.id;
  }

  /**
   * Update an action by ID
   */
  updateActionByID(id, updates) {
    const state = this.host.getState();
    const action = state.actions.find(a => a.id === id);

    if (!action) {
      throw new Error(`Action with id ${id} not found`);
    }

    // Update allowed fields
    const allowedUpdates = ['name', 'cmd', 'payload', 'date', 'unBuffered', 'catchUpWindow', 'repeat', 'count'];

    for (const key of allowedUpdates) {
      if (key in updates) {
        if (key === 'date' && updates[key]) {
          action[key] = new Date(updates[key]);
        } else if (key === 'repeat' && updates[key]) {
          action[key] = { ...updates[key] };
          if (!action[key].dstPolicy) {
            action[key].dstPolicy = 'once';
          }
        } else {
          action[key] = updates[key];
        }
      }
    }

    // Re-normalize catchUpWindow if unBuffered or catchUpWindow was updated
    if ('unBuffered' in updates || 'catchUpWindow' in updates) {
      action.catchUpWindow = this._normalizeCatchUpWindow({
        catchUpWindow: action.catchUpWindow,
        unBuffered: action.unBuffered
      });
    }

    this._emit('update', {
      type: 'update',
      operation: 'update',
      actionId: id,
      action: { ...action }
    });

    if (this.options.autoSave) {
      this._saveState();
    }
  }

  /**
   * Update actions by name
   */
  updateActionByName(name, updates) {
    const state = this.host.getState();
    const toUpdate = state.actions.filter(a => a.name === name);

    if (toUpdate.length === 0) {
      // For consistency with removeActionByName, we could throw an error.
      // However, it might be more convenient to simply return 0.
      // Let's return 0 for now.
      return 0;
    }

    const allowedUpdates = ['cmd', 'payload', 'date', 'unBuffered', 'catchUpWindow', 'repeat', 'count'];

    for (const action of toUpdate) {
      for (const key of allowedUpdates) {
        if (key in updates) {
          if (key === 'date' && updates[key]) {
            action[key] = new Date(updates[key]);
          } else if (key === 'repeat' && updates[key]) {
            action[key] = { ...action.repeat, ...updates[key] };
            if (!action[key].dstPolicy) {
              action[key].dstPolicy = 'once';
            }
          } else {
            action[key] = updates[key];
          }
        }
      }

      // Re-normalize catchUpWindow if unBuffered or catchUpWindow was updated
      if ('unBuffered' in updates || 'catchUpWindow' in updates) {
        action.catchUpWindow = this._normalizeCatchUpWindow({
          catchUpWindow: action.catchUpWindow,
          unBuffered: action.unBuffered
        });
      }

      this._emit('update', {
        type: 'update',
        operation: 'update',
        actionId: action.id,
        action: { ...action }
      });
    }

    if (this.options.autoSave) {
      this._saveState();
    }

    return toUpdate.length;
  }

  /**
   * Remove action by ID
   */
  removeActionByID(id) {
    const state = this.host.getState();
    const index = state.actions.findIndex(a => a.id === id);

    if (index === -1) {
      throw new Error(`Action with id ${id} not found`);
    }

    const removed = state.actions.splice(index, 1)[0];

    this._emit('update', {
      type: 'update',
      operation: 'remove',
      actionId: id,
      action: removed
    });

    if (this.options.autoSave) {
      this._saveState();
    }
  }

  /**
   * Remove actions by name
   */
  removeActionByName(name) {
    const state = this.host.getState();
    const toRemove = state.actions.filter(a => a.name === name);

    if (toRemove.length === 0) {
      throw new Error(`No actions found with name: ${name}`);
    }

    for (const action of toRemove) {
      const index = state.actions.indexOf(action);
      if (index !== -1) {
        state.actions.splice(index, 1);

        this._emit('update', {
          type: 'update',
          operation: 'remove',
          actionId: action.id,
          action
        });
      }
    }

    if (this.options.autoSave) {
      this._saveState();
    }

    return toRemove.length;
  }

  /**
   * Deep clone an action
   */
  _cloneAction(action) {
    const cloned = { ...action };

    // Deep copy nested objects
    if (action.repeat) {
      cloned.repeat = { ...action.repeat };
    }

    // Clone Date objects properly
    if (action.date) {
      cloned.date = new Date(action.date);
    }

    return cloned;
  }

  /**
   * Get all actions (deep copy)
   */
  getActions() {
    const state = this.host.getState();
    return state.actions.map(a => this._cloneAction(a));
  }

  /**
   * Get actions by name
   */
  getActionsByName(name) {
    const state = this.host.getState();
    return state.actions
      .filter(a => a.name === name)
      .map(a => this._cloneAction(a));
  }

  /**
   * Get action by ID
   */
  getActionByID(id) {
    const state = this.host.getState();
    const action = state.actions.find(a => a.id === id);
    return action ? this._cloneAction(action) : null;
  }

  /**
   * Get actions scheduled in a time range
   */
  getActionsInRange(startDate, endDate, callback) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const state = this.host.getState();
    const events = CoreEngine.simulate(state, start, end);

    if (callback && typeof callback === 'function') {
      callback(events);
    }

    return events;
  }

  /**
   * Simulate range (alias for getActionsInRange)
   */
  simulateRange(startDate, endDate) {
    return this.getActionsInRange(startDate, endDate);
  }

  /**
   * Describe an action in human-readable format
   */
  describeAction(id) {
    const action = this.getActionByID(id);
    if (!action) {
      return null;
    }

    let description = `Action #${action.id}`;
    if (action.name) {
      description += ` - ${action.name}`;
    }

    description += `\n  Command: ${action.cmd}`;
    description += `\n  Next run: ${action.date ? action.date.toLocaleString() : 'None'}`;
    description += `\n  Executions: ${action.count}`;
    description += `\n  Buffered: ${!action.unBuffered}`;

    if (action.repeat) {
      description += `\n  Recurrence: ${action.repeat.type}`;
      if (action.repeat.interval > 1) {
        description += ` (every ${action.repeat.interval})`;
      }
      if (action.repeat.limit) {
        description += `\n  Limit: ${action.repeat.limit}`;
      }
      if (action.repeat.endDate) {
        description += `\n  End date: ${new Date(action.repeat.endDate).toLocaleString()}`;
      }
      description += `\n  DST policy: ${action.repeat.dstPolicy}`;
    } else {
      description += `\n  Recurrence: One-time`;
    }

    return description;
  }

  /**
   * Event listener management
   */
  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);
  }

  off(event, listener) {
    if (!this.listeners.has(event)) {
      return;
    }
    const list = this.listeners.get(event);
    const index = list.indexOf(listener);
    if (index !== -1) {
      list.splice(index, 1);
    }
  }

  _emit(event, ...args) {
    if (!this.listeners.has(event)) {
      return;
    }
    const list = this.listeners.get(event);
    for (const listener of list) {
      try {
        listener(...args);
      } catch (error) {
        console.error(`Error in ${event} listener:`, error);
      }
    }
  }

  /**
   * Load state from storage
   */
  _loadState() {
    try {
      const state = this.options.storage.load();

      // Normalize catchUpWindow for existing actions (for backwards compatibility)
      if (state.actions && state.actions.length > 0) {
        state.actions = state.actions.map(action => ({
          ...action,
          catchUpWindow: action.catchUpWindow !== undefined
            ? action.catchUpWindow
            : this._normalizeCatchUpWindow(action)
        }));

        const maxId = Math.max(...state.actions.map(a => a.id || 0));
        this.nextId = maxId + 1;
      }

      this.host.setState(state);
    } catch (error) {
      this._emit('error', {
        type: 'error',
        message: `Failed to load state: ${error.message}`,
        error
      });
    }
  }

  /**
   * Save state to storage
   */
  _saveState() {
    try {
      const state = this.host.getState();
      this.options.storage.save(state);
    } catch (error) {
      this._emit('error', {
        type: 'error',
        message: `Failed to save state: ${error.message}`,
        error
      });
    }
  }

  /**
   * Start auto-save timer
   */
  _startAutoSave() {
    if (this.saveTimer) {
      return;
    }

    this.saveTimer = setInterval(() => {
      this._saveState();
    }, this.options.saveInterval);
  }

  /**
   * Normalize catchUpWindow property (handles backwards compatibility with unBuffered)
   *
   * Priority:
   * 1. catchUpWindow specified → normalize it (coerce Infinity to "unlimited" if needed)
   * 2. unBuffered specified → convert to catchUpWindow equivalent
   * 3. Neither specified → default to "unlimited" (catch up everything)
   *
   * @param {Object} spec - Action specification
   * @returns {string|number} - Normalized catchUpWindow value ("unlimited" or milliseconds)
   */
  _normalizeCatchUpWindow(spec) {
    // New property takes precedence
    if (spec.catchUpWindow !== undefined) {
      // Coerce Infinity to "unlimited" (backwards compatibility)
      if (spec.catchUpWindow === Infinity) {
        this._emit('debug', {
          type: 'debug',
          message: 'Coercing catchUpWindow: Infinity → "unlimited"'
        });
        return "unlimited";
      }
      return spec.catchUpWindow;
    }

    // Backwards compatibility mapping
    if (spec.unBuffered !== undefined) {
      return spec.unBuffered ? 0 : "unlimited";
    }

    // Default: catch up everything (current buffered behavior)
    return "unlimited";
  }

  /**
   * Validate and normalize action specification
   * Philosophy: "Fail loudly, run defensively"
   * - Emit ERROR events for serious issues but coerce to reasonable defaults
   * - Emit DEBUG events for auto-corrections
   * - Never silently fail
   */
  _validateAction(action) {
    if (!action.cmd) {
      throw new Error('Action must have a cmd property');
    }

    if (action.repeat) {
      const validTypes = ['second', 'minute', 'hour', 'day', 'weekday', 'weekend', 'week', 'month', 'year'];

      // Defensive: Coerce invalid repeat.type to 'day' with ERROR event
      if (!action.repeat.type || !validTypes.includes(action.repeat.type)) {
        this._emit('error', {
          type: 'error',
          message: `Invalid repeat.type "${action.repeat.type}" - defaulting to "day"`,
          actionSpec: action
        });
        action.repeat.type = 'day';
      }

      // Defensive: Coerce invalid interval to Math.max(1, Math.floor(value))
      if (action.repeat.interval !== undefined) {
        const original = action.repeat.interval;
        const coerced = Math.max(1, Math.floor(original));
        if (original !== coerced) {
          this._emit('error', {
            type: 'error',
            message: `Invalid repeat.interval ${original} - coerced to ${coerced}`,
            actionSpec: action
          });
          action.repeat.interval = coerced;
        }
      }

      // Defensive: Validate dstPolicy
      if (action.repeat.dstPolicy && !['once', 'twice'].includes(action.repeat.dstPolicy)) {
        this._emit('error', {
          type: 'error',
          message: `Invalid dstPolicy "${action.repeat.dstPolicy}" - defaulting to "once"`,
          actionSpec: action
        });
        action.repeat.dstPolicy = 'once';
      }

      // Defensive: Coerce invalid repeat.limit to null (unlimited) with ERROR event
      if (action.repeat.limit !== undefined && action.repeat.limit !== null) {
        if (typeof action.repeat.limit !== 'number' || action.repeat.limit < 1) {
          this._emit('error', {
            type: 'error',
            message: `Invalid repeat.limit ${action.repeat.limit} - defaulting to null (unlimited)`,
            actionSpec: action
          });
          action.repeat.limit = null;
        }
      }

      // Defensive: Validate repeat.endDate
      if (action.repeat.endDate !== undefined && action.repeat.endDate !== null) {
        try {
          new Date(action.repeat.endDate);
        } catch (e) {
          this._emit('error', {
            type: 'error',
            message: `Invalid repeat.endDate - ignoring`,
            actionSpec: action
          });
          action.repeat.endDate = null;
        }
      }
    }

    // Defensive: Validate catchUpWindow if provided
    if (action.catchUpWindow !== undefined) {
      const isValidString = action.catchUpWindow === "unlimited";
      const isNumber = typeof action.catchUpWindow === 'number';
      const isInfinity = action.catchUpWindow === Infinity; // Allow for backwards compatibility

      // Coerce negative numbers to 0 FIRST
      if (isNumber && action.catchUpWindow < 0) {
        this._emit('error', {
          type: 'error',
          message: `Negative catchUpWindow ${action.catchUpWindow} - coerced to 0`,
          actionSpec: action
        });
        action.catchUpWindow = 0;
      }
      // Then validate it's a valid value
      else if (!isValidString && !isNumber && !isInfinity) {
        this._emit('error', {
          type: 'error',
          message: `Invalid catchUpWindow "${action.catchUpWindow}" - defaulting to "unlimited"`,
          actionSpec: action
        });
        action.catchUpWindow = "unlimited";
      }
    }
  }

  /**
   * Static storage factory methods
   */
  static get storage() {
    return {
      file: (filePath) => new FileStorage(filePath),
      memory: () => new MemoryStorage()
    };
  }
}

module.exports = Automator;
