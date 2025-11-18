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
    // Validate action
    this._validateAction(actionSpec);

    // Create action with state
    const action = {
      id: this.nextId++,
      name: actionSpec.name || null,
      cmd: actionSpec.cmd,
      payload: actionSpec.payload !== undefined ? actionSpec.payload : null,
      date: actionSpec.date ? new Date(actionSpec.date) : new Date(),
      unBuffered: actionSpec.unBuffered || false,
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
    const allowedUpdates = ['name', 'cmd', 'payload', 'date', 'unBuffered', 'repeat', 'count'];

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

    const allowedUpdates = ['cmd', 'payload', 'date', 'unBuffered', 'repeat', 'count'];

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
   * Get all actions (deep copy)
   */
  getActions() {
    const state = this.host.getState();
    return JSON.parse(JSON.stringify(state.actions));
  }

  /**
   * Get actions by name
   */
  getActionsByName(name) {
    const state = this.host.getState();
    return state.actions
      .filter(a => a.name === name)
      .map(a => JSON.parse(JSON.stringify(a)));
  }

  /**
   * Get action by ID
   */
  getActionByID(id) {
    const state = this.host.getState();
    const action = state.actions.find(a => a.id === id);
    return action ? JSON.parse(JSON.stringify(action)) : null;
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
      this.host.setState(state);

      // Update nextId to be higher than any existing ID
      if (state.actions && state.actions.length > 0) {
        const maxId = Math.max(...state.actions.map(a => a.id || 0));
        this.nextId = maxId + 1;
      }
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
   * Validate action specification
   */
  _validateAction(action) {
    if (!action.cmd) {
      throw new Error('Action must have a cmd property');
    }

    if (action.repeat) {
      const validTypes = ['second', 'minute', 'hour', 'day', 'weekday', 'weekend', 'week', 'month', 'year'];
      if (!validTypes.includes(action.repeat.type)) {
        throw new Error(`Invalid repeat type: ${action.repeat.type}`);
      }

      if (action.repeat.interval !== undefined && action.repeat.interval < 1) {
        throw new Error('Repeat interval must be >= 1');
      }

      if (action.repeat.dstPolicy && !['once', 'twice'].includes(action.repeat.dstPolicy)) {
        throw new Error('DST policy must be "once" or "twice"');
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
