/**
 * Automator.js
 *
 * Main API class for jw-automator v5
 */

const fs = require('fs');
const path = require('path');
const SchedulerHost = require('./host/SchedulerHost');
const CoreEngine = require('./core/CoreEngine');

class Automator {
  constructor(options = {}) {
    this.options = {
      storageFile: options.storageFile || null,
      autoSave: options.autoSave !== false, // default true
      saveInterval: options.saveInterval || 15000, // 15 seconds (disk wear mitigation)
      bootMode: options.bootMode !== false, // default true
      defaultCatchUpMode: options.defaultCatchUpMode || 'default',
      ...options
    };

    this.host = new SchedulerHost();
    this.nextId = 1;

    // Create the save manager, which encapsulates all persistence logic.
    this._saveManager = this._createSaveManager(
      () => this._performSave(),
      this.options.saveInterval
    );

    // Disable boot mode immediately if configured
    if (this.options.bootMode === false) {
      this.host.bootMode = false;
    }

    // Forward events from host
    this.host.on('ready', (...args) => this._emit('ready', ...args));
    this.host.on('task', (...args) => {
      // Task execution: ask to save (respects moratorium)
      this._requestSave(false);
      this._emit('task', ...args);
    });
    this.host.on('error', (...args) => this._emit('error', ...args));
    this.host.on('debug', (...args) => this._emit('debug', ...args));

    // Save state after boot completes
    this.host.on('boot-complete', () => {
      if (this.options.autoSave) {
        this._requestSave(true);
      }
    });

    // Event listeners
    this.listeners = new Map();

    // Load initial state
    this._loadState();
  }

  /**
   * Seed the automator with initial tasks (runs only on first use)
   *
   * @param {Function} callback - Function to execute when database is empty
   * @returns {Object} - Result object with success/error
   */
  seed(callback) {
    if (typeof callback !== 'function') {
      return this._error(
        'seed() requires a callback function',
        'INVALID_CALLBACK',
        { providedType: typeof callback }
      );
    }

    const state = this.host.getState();

    // Check if already populated
    if (state.tasks && state.tasks.length > 0) {
      return this._success({ seeded: false, message: 'Database already populated' });
    }

    // Execute seeding callback
    callback(this);

    // Save immediately
    this._requestSave(true);

    return this._success({ seeded: true, message: 'Database seeded successfully' });
  }

  /**
   * Start the automator
   */
  start() {
    this.host.start();
    // No periodic timer needed - moratorium state machine handles saves
  }

  /**
   * Stop the automator
   */
  stop() {
    this.host.stop();

    // On shutdown, flush any pending saves and cancel any future timers.
    if (this.options.autoSave) {
      this._saveManager.flush();
      this._saveManager.cancel();
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
   * Add a task
   * @returns {Object} - Result object with success/error
   */
  addTask(taskSpec) {
    // Normalize catch-up settings using the helper
    const { catchUpWindow, catchUpLimit } = this._normalizeCatchUpSettings(taskSpec);

    // Validate task (returns error result if invalid)
    const validationResult = this._validateTask(taskSpec);
    if (!validationResult.success) {
      return validationResult;
    }

    // Defensive: Default missing date to 5 seconds from now
    let startDate;
    if (!taskSpec.date) {
      startDate = new Date(Date.now() + 5000);
      this._emit('debug', {
        type: 'debug',
        message: 'No date provided - defaulting to 5 seconds from now'
      });
    } else {
      startDate = new Date(taskSpec.date);
    }

    // Create task with state
    const task = {
      id: this.nextId++,
      name: taskSpec.name || null,
      cmd: taskSpec.cmd,
      payload: taskSpec.payload !== undefined ? taskSpec.payload : null,
      date: startDate,
      catchUpWindow: catchUpWindow, // Use normalized value
      catchUpLimit: catchUpLimit,   // Use normalized value
      repeat: taskSpec.repeat ? { ...taskSpec.repeat } : null,
      count: 0
    };

    // Set default dstPolicy if not specified
    if (task.repeat && !task.repeat.dstPolicy) {
      task.repeat.dstPolicy = 'once';
    }

    this.host.addTask(task);

    this._emit('update', {
      type: 'update',
      operation: 'add',
      task: { ...task }
    });

    // Save immediately
    this._requestSave(true);

    return this._success({ id: task.id });
  }

  /**
   * Update a task by ID
   * @returns {Object} - Result object with success/error
   */
  updateTaskByID(id, updates) {
    const state = this.host.getState();
    const task = state.tasks.find(t => t.id === id);

    if (!task) {
      return this._error(
        `Task with id ${id} not found`,
        'TASK_NOT_FOUND',
        { taskId: id }
      );
    }

    // Normalize catch-up settings using the helper, passing existing task for context
    const { catchUpWindow, catchUpLimit } = this._normalizeCatchUpSettings(updates, task);

    // Apply resolved catchUp values to updates object
    updates.catchUpWindow = catchUpWindow;
    updates.catchUpLimit = catchUpLimit;

    // Validate catchUpWindow and catchUpLimit if being updated
    if ('catchUpWindow' in updates) {
      const result = this._validateCatchUpWindow(updates.catchUpWindow);
      if (!result.success) return result;
    }
    if ('catchUpLimit' in updates) {
      const result = this._validateCatchUpLimit(updates.catchUpLimit);
      if (!result.success) return result;
    }

    // Update allowed fields
    const allowedUpdates = ['name', 'cmd', 'payload', 'date', 'catchUpWindow', 'catchUpLimit', 'repeat', 'count'];

    for (const key of allowedUpdates) {
      if (key in updates) {
        if (key === 'date' && updates[key]) {
          task[key] = new Date(updates[key]);
        } else if (key === 'repeat' && updates[key]) {
          // Merge repeat object instead of overwriting, to preserve existing fields
          task[key] = { ...(task[key] || {}), ...updates[key] };
          if (!task[key].dstPolicy) {
            task[key].dstPolicy = 'once';
          }
        } else {
          task[key] = updates[key];
        }
      }
    }

    this._emit('update', {
      type: 'update',
      operation: 'update',
      taskId: id,
      task: { ...task }
    });

    // Save immediately
    this._requestSave(true);

    return this._success({ id, task: { ...task } });
  }

  /**
   * Update tasks by name
   * @returns {Object} - Result object with success/error
   */
  updateTaskByName(name, updates) {
    const state = this.host.getState();
    const toUpdate = state.tasks.filter(t => t.name === name);

    if (toUpdate.length === 0) {
      return this._success({ count: 0 }); // Not an error, just no matches
    }

    // Create a mutable copy of updates for each task so _normalizeCatchUpSettings can modify it
    const clonedUpdates = { ...updates };
    // Normalize catch-up settings using the helper, passing existing task for context
    // This needs to be done for each task because 'auto' mode might depend on task.repeat
    const normalizedCatchUp = this._normalizeCatchUpSettings(clonedUpdates, toUpdate[0]); // Normalize once, assumes all tasks of same name have similar repeat structure for 'auto' mode

    // Apply resolved catchUp values to clonedUpdates object
    clonedUpdates.catchUpWindow = normalizedCatchUp.catchUpWindow;
    clonedUpdates.catchUpLimit = normalizedCatchUp.catchUpLimit;

    // Validate catchUpWindow and catchUpLimit if being updated
    if ('catchUpWindow' in clonedUpdates) {
      const result = this._validateCatchUpWindow(clonedUpdates.catchUpWindow);
      if (!result.success) return result;
    }
    if ('catchUpLimit' in clonedUpdates) {
      const result = this._validateCatchUpLimit(clonedUpdates.catchUpLimit);
      if (!result.success) return result;
    }

    const allowedUpdates = ['cmd', 'payload', 'date', 'catchUpWindow', 'catchUpLimit', 'repeat', 'count'];

    for (const task of toUpdate) {
      for (const key of allowedUpdates) {
        if (key in clonedUpdates) { // Use clonedUpdates here
          if (key === 'date' && clonedUpdates[key]) {
            task[key] = new Date(clonedUpdates[key]);
          } else if (key === 'repeat' && clonedUpdates[key]) {
            task[key] = { ...(task[key] || {}), ...clonedUpdates[key] };
            if (!task[key].dstPolicy) {
              task[key].dstPolicy = 'once';
            }
          } else {
            task[key] = clonedUpdates[key];
          }
        }
      }

      this._emit('update', {
        type: 'update',
        operation: 'update',
        taskId: task.id,
        task: { ...task }
      });
    }

    // Save immediately
    this._requestSave(true);

    return this._success({ count: toUpdate.length });
  }

  /**
   * Remove task by ID
   * @returns {Object} - Result object with success/error
   */
  removeTaskByID(id) {
    const state = this.host.getState();
    const index = state.tasks.findIndex(t => t.id === id);

    if (index === -1) {
      return this._error(
        `Task with id ${id} not found`,
        'TASK_NOT_FOUND',
        { taskId: id }
      );
    }

    const removed = state.tasks.splice(index, 1)[0];

    this._emit('update', {
      type: 'update',
      operation: 'remove',
      taskId: id,
      task: removed
    });

    // Save immediately
    this._requestSave(true);

    return this._success({ id, task: removed });
  }

  /**
   * Remove tasks by name
   * @returns {Object} - Result object with success/error
   */
  removeTaskByName(name) {
    const state = this.host.getState();
    const toRemove = state.tasks.filter(t => t.name === name);

    if (toRemove.length === 0) {
      return this._error(
        `No tasks found with name: ${name}`,
        'NO_TASKS_FOUND',
        { taskName: name }
      );
    }

    for (const task of toRemove) {
      const index = state.tasks.indexOf(task);
      if (index !== -1) {
        state.tasks.splice(index, 1);

        this._emit('update', {
          type: 'update',
          operation: 'remove',
          taskId: task.id,
          task
        });
      }
    }

    // Save immediately
    this._requestSave(true);

    return this._success({ count: toRemove.length });
  }

  /**
   * Deep clone a task
   */
  _cloneTask(task) {
    const cloned = { ...task };

    // Deep copy nested objects
    if (task.repeat) {
      cloned.repeat = { ...task.repeat };
    }

    // Clone Date objects properly
    if (task.date) {
      cloned.date = new Date(task.date);
    }

    return cloned;
  }

  /**
   * Get all tasks (deep copy)
   */
  getTasks() {
    const state = this.host.getState();
    return state.tasks.map(t => this._cloneTask(t));
  }

  /**
   * Get tasks by name
   */
  getTasksByName(name) {
    const state = this.host.getState();
    return state.tasks
      .filter(t => t.name === name)
      .map(t => this._cloneTask(t));
  }

  /**
   * Get task by ID
   */
  getTaskByID(id) {
    const state = this.host.getState();
    const task = state.tasks.find(t => t.id === id);
    return task ? this._cloneTask(task) : null;
  }

  /**
   * Get tasks scheduled in a time range
   */
  getTasksInRange(startDate, endDate, callback) {
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
   * Simulate range (alias for getTasksInRange)
   */
  simulateRange(startDate, endDate) {
    return this.getTasksInRange(startDate, endDate);
  }

  /**
   * Describe a task in human-readable format
   */
  describeTask(id) {
    const task = this.getTaskByID(id);
    if (!task) {
      return null;
    }

    let description = `Task #${task.id}`;
    if (task.name) {
      description += ` - ${task.name}`;
    }

    description += `\n  Command: ${task.cmd}`;
    description += `\n  Next run: ${task.date ? task.date.toLocaleString() : 'None'}`;
    description += `\n  Executions: ${task.count}`;
    description += `\n  Catch-up Window: ${task.catchUpWindow === 'unlimited' ? 'unlimited' : `${task.catchUpWindow}ms`}`;
    description += `\n  Catch-up Limit: ${task.catchUpLimit === 'all' ? 'all' : task.catchUpLimit}`;

    if (task.repeat) {
      description += `\n  Recurrence: ${task.repeat.type}`;
      if (task.repeat.interval > 1) {
        description += ` (every ${task.repeat.interval})`;
      }
      if (task.repeat.limit) {
        description += `\n  Limit: ${task.repeat.limit}`;
      }
      if (task.repeat.endDate) {
        description += `\n  End date: ${new Date(task.repeat.endDate).toLocaleString()}`;
      }
      description += `\n  DST policy: ${task.repeat.dstPolicy}`;
    } else {
      description += `\n  Recurrence: One-time`;
    }

    return description;
  }

  /**
   * Creates a self-contained save manager that replicates the moratorium logic.
   * This avoids external dependencies while still encapsulating the complex state.
   * @param {Function} func The save function to wrap.
   * @param {number} interval The cooldown interval in milliseconds.
   * @returns {Function} A manager function with .flush() and .cancel() methods.
   * @private
   */
  _createSaveManager(func, interval) {
    let moratoriumActive = false;
    let stateDirty = false;
    let moratoriumTimer = null;

    const manager = (force = false) => {
      if (force) {
        // A forced call immediately saves, marks as clean, and starts a new cooldown.
        func();
        stateDirty = false;
        startMoratorium();
        return;
      }

      // A non-forced call is an "ask". Mark as dirty.
      stateDirty = true;
      // If in a cooldown, do nothing more. The trailing call will handle it.
      if (moratoriumActive) {
        return;
      }

      // If not in a cooldown, perform the leading-edge save.
      func();
      stateDirty = false;
      startMoratorium();
    };

    function startMoratorium() {
      moratoriumActive = true;
      // Clear any existing timer to restart the cooldown period.
      if (moratoriumTimer) {
        clearTimeout(moratoriumTimer);
      }
      moratoriumTimer = setTimeout(onMoratoriumEnd, interval);
    }

    function onMoratoriumEnd() {
      moratoriumActive = false;
      moratoriumTimer = null;
      // If changes occurred during the cooldown, perform the trailing-edge save.
      if (stateDirty) {
        manager(false);
      }
    }

    // Method to force an immediate save.
    manager.flush = () => manager(true);

    // Method to clear any pending timers, e.g., on shutdown.
    manager.cancel = () => {
      if (moratoriumTimer) {
        clearTimeout(moratoriumTimer);
        moratoriumTimer = null;
      }
    };

    return manager;
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
   * Create a success result object
   * @private
   */
  _success(data) {
    return { success: true, ...data };
  }

  /**
   * Create an error result object and emit error event
   * @private
   */
  _error(message, code, additionalData = {}) {
    const result = {
      success: false,
      error: message,
      code,
      ...additionalData
    };

    // Still emit error event for logging/monitoring
    this._emit('error', {
      type: 'validation_error',
      message,
      code,
      ...additionalData
    });

    return result;
  }

  /**
   * Load state from storage
   */
  _loadState() {
    if (!this.options.storageFile) {
      // Memory-only: start with empty state
      this.host.setState({ tasks: [] });
      return;
    }

    try {
      const filePath = path.resolve(this.options.storageFile);

      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        const state = JSON.parse(data);

        // Deserialize Date objects
        if (state.tasks) {
          state.tasks = state.tasks.map(task => {
            if (task.date) {
              task.date = new Date(task.date);
            }
            if (task.repeat && task.repeat.endDate) {
              task.repeat.endDate = new Date(task.repeat.endDate);
            }
            return task;
          });
        }

        // Set nextId from loaded state
        if (state.tasks && state.tasks.length > 0) {
          const maxId = Math.max(...state.tasks.map(t => t.id || 0));
          this.nextId = maxId + 1;
        }

        this.host.setState(state);
      } else {
        // File doesn't exist yet
        this.host.setState({ tasks: [] });
      }
    } catch (error) {
      this._emit('error', {
        type: 'error',
        message: `Failed to load state: ${error.message}`,
        error
      });
      // Defensive: continue with empty state
      this.host.setState({ tasks: [] });
    }
  }

  /**
   * Perform actual save to storage (called by state machine)
   * @private
   */
  _performSave() {
    if (!this.options.storageFile) {
      // Memory-only: no-op
      return;
    }

    try {
      const filePath = path.resolve(this.options.storageFile);
      const state = this.host.getState();
      const data = JSON.stringify(state, null, 2);

      fs.writeFileSync(filePath, data, 'utf8');
    } catch (error) {
      this._emit('error', {
        type: 'error',
        message: `Failed to save state: ${error.message}`,
        error
      });
      // Keep dirty=true on error so we retry later
    }
  }

  /**
   * Request a save, which is handled by the save manager.
   * @param {boolean} force - true to force an immediate save, false to make a normal request.
   * @private
   */
  _requestSave(force = false) {
    if (!this.options.autoSave) {
      return;
    }
    // Delegate directly to the save manager.
    this._saveManager(force);
  }

  /**
   * Normalizes catch-up settings (catchUpWindow, catchUpLimit) from a task specification.
   * This handles cascading defaults: explicit on taskSpec > taskSpec.catchUpMode > existingTask > automator.defaultCatchUpMode > hardcoded defaults.
   * Also deletes `catchUpMode` from the incomingSpec after processing.
   *
   * @param {Object} incomingSpec - The task specification or update object (e.g., from addTask or updateTask).
   * @param {Object} [existingTask=null] - The current state of the task, if an update operation.
   * @returns {{catchUpWindow: number|string, catchUpLimit: number|string}} The resolved catch-up settings.
   * @private
   */
  _normalizeCatchUpSettings(incomingSpec, existingTask = null) {
    let resolvedWindow;
    let resolvedLimit;

    // A. Check for instructions in the new spec first (highest precedence)
    const hasExplicitWindow = incomingSpec.catchUpWindow !== undefined;
    const hasExplicitLimit = incomingSpec.catchUpLimit !== undefined;
    const hasMode = incomingSpec.catchUpMode !== undefined;

    if (hasExplicitWindow || hasExplicitLimit) {
        // Use explicit values directly. If one is missing, use the other from existing or default to 0.
        resolvedWindow = hasExplicitWindow ? incomingSpec.catchUpWindow : (existingTask ? existingTask.catchUpWindow : 0);
        resolvedLimit = hasExplicitLimit ? incomingSpec.catchUpLimit : (existingTask ? existingTask.catchUpLimit : 0);
    } else if (hasMode) {
        // Apply the mode from the incoming spec
        switch (incomingSpec.catchUpMode) {
            case 'default':
                resolvedWindow = 500;
                resolvedLimit = 1;
                break;
            case 'realtime':
                resolvedWindow = 0;
                resolvedLimit = 0;
                break;
            case 'auto':
                const MIN_WINDOW = 500; // 0.5 seconds
                const MAX_WINDOW = 900000; // 15 minutes

                resolvedLimit = 1; // 'auto' mode always catches up one missed instance.
                const repeat = incomingSpec.repeat || (existingTask ? existingTask.repeat : null);

                if (repeat && repeat.type && repeat.interval) {
                    let intervalMs = 0;
                    switch (repeat.type) {
                        case 'second': intervalMs = repeat.interval * 1000; break;
                        case 'minute': intervalMs = repeat.interval * 60 * 1000; break;
                        case 'hour':   intervalMs = repeat.interval * 60 * 60 * 1000; break;
                        case 'day':    intervalMs = repeat.interval * 24 * 60 * 60 * 1000; break;
                        // week, weekend, weekday, month, year are more complex and less predictable in duration.
                        // Default to a safe, medium-sized window for these.
                        default:       intervalMs = 60000; // Assume 1 minute for complex types
                    }
                    
                    // Calculate the elastic window (25% of interval)
                    const elasticWindow = Math.floor(intervalMs * 0.25);
                    
                    // Apply the min and max caps
                    let finalWindow = Math.max(MIN_WINDOW, elasticWindow);
                    finalWindow = Math.min(finalWindow, MAX_WINDOW);
                    resolvedWindow = finalWindow;
                } else {
                    // If no repeat info, 'auto' falls back to the same as 'default'
                    resolvedWindow = 500; 
                    resolvedLimit = 1;
                }
                break;
            default:
                this._emit('warning', {
                    type: 'warning',
                    message: `Unknown catchUpMode "${incomingSpec.catchUpMode}" - defaulting to 'default'`,
                    taskSpec: incomingSpec
                });
                resolvedWindow = 500;
                resolvedLimit = 1;
                break;
        }
    } else if (existingTask) {
        // B. No new instructions, so preserve the existing task's values
        resolvedWindow = existingTask.catchUpWindow;
        resolvedLimit = existingTask.catchUpLimit;
    } else {
        // C. No new instructions and no existing task (i.e., addTask), so use automator default
        const automatorDefaultMode = this.options.defaultCatchUpMode || 'default';
        switch (automatorDefaultMode) {
            case 'realtime':
                resolvedWindow = 0;
                resolvedLimit = 0;
                break;
            case 'default':
            default:
                resolvedWindow = 500;
                resolvedLimit = 1;
                break;
        }
    }

    // Always delete catchUpMode from the incoming spec as it's a transient macro
    delete incomingSpec.catchUpMode;

    return { catchUpWindow: resolvedWindow, catchUpLimit: resolvedLimit };
  }



  /**
   * Validate catchUpWindow value (returns result object)
   * @private
   */
  _validateCatchUpWindow(value) {
    if (value === undefined) return this._success({});

    const isValidString = value === "unlimited";
    const isValidNumber = typeof value === 'number' && !isNaN(value) && value >= 0 && value !== Infinity;

    if (!isValidString && !isValidNumber) {
      return this._error(
        `Invalid catchUpWindow "${value}". Must be "unlimited" or a non-negative number (not Infinity).`,
        'INVALID_CATCHUP_WINDOW',
        { field: 'catchUpWindow', provided: value }
      );
    }

    return this._success({});
  }

  /**
   * Validate catchUpLimit value (returns result object)
   * @private
   */
  _validateCatchUpLimit(value) {
    if (value === undefined) return this._success({});

    const isValidString = value === "all";
    const isValidNumber = typeof value === 'number' && !isNaN(value) && value >= 0 && Number.isInteger(value);

    if (!isValidString && !isValidNumber) {
      return this._error(
        `Invalid catchUpLimit "${value}". Must be "all" or a non-negative integer.`,
        'INVALID_CATCHUP_LIMIT',
        { field: 'catchUpLimit', provided: value }
      );
    }

    return this._success({});
  }

  /**
   * Validate and normalize task specification
   * Philosophy: "Fail loudly, run defensively" - but return errors instead of throwing
   * - Return error results for invalid catch-up values and critical fields
   * - Emit DEBUG/WARNING events for auto-corrections
   * - Never throw - always return result objects
   */
  _validateTask(task) {
    if (!task.cmd) {
      return this._error(
        'Task must have a cmd property',
        'MISSING_CMD',
        { field: 'cmd' }
      );
    }

    if (task.repeat) {
      const validTypes = ['second', 'minute', 'hour', 'day', 'weekday', 'weekend', 'week', 'month', 'year'];

      // CRITICAL: An invalid repeat.type is a fatal error, as intent is lost.
      if (!task.repeat.type || !validTypes.includes(task.repeat.type)) {
        return this._error(
          `Invalid repeat.type "${task.repeat.type}". Must be one of: ${validTypes.join(', ')}`,
          'INVALID_REPEAT_TYPE',
          { field: 'repeat.type', provided: task.repeat.type }
        );
      }

      // Defensive: Coerce invalid interval to Math.max(1, Math.floor(value))
      if (task.repeat.interval !== undefined) {
        const original = task.repeat.interval;
        const coerced = Math.max(1, Math.floor(original));
        if (original !== coerced) {
          this._emit('warning', {
            type: 'warning',
            message: `Invalid repeat.interval ${original} - coerced to ${coerced}`,
            taskSpec: task
          });
          task.repeat.interval = coerced;
        }
      }

      // Defensive: Validate dstPolicy
      if (task.repeat.dstPolicy && !['once', 'twice'].includes(task.repeat.dstPolicy)) {
        this._emit('warning', {
          type: 'warning',
          message: `Invalid dstPolicy "${task.repeat.dstPolicy}" - defaulting to "once"`,
          taskSpec: task
        });
        task.repeat.dstPolicy = 'once';
      }

      // Defensive: Coerce invalid repeat.limit to null (unlimited) with WARNING event
      if (task.repeat.limit !== undefined && task.repeat.limit !== null) {
        if (typeof task.repeat.limit !== 'number' || task.repeat.limit < 1) {
          this._emit('warning', {
            type: 'warning',
            message: `Invalid repeat.limit ${task.repeat.limit} - defaulting to null (unlimited)`,
            taskSpec: task
          });
          task.repeat.limit = null;
        }
      }

      // Defensive: Validate repeat.endDate
      if (task.repeat.endDate !== undefined && task.repeat.endDate !== null) {
        try {
          new Date(task.repeat.endDate);
        } catch (e) {
          this._emit('warning', {
            type: 'warning',
            message: `Invalid repeat.endDate - ignoring`,
            taskSpec: task
          });
          task.repeat.endDate = null;
        }
      }
    }

    // Strict validation for catch-up properties (advanced feature)
    const windowResult = this._validateCatchUpWindow(task.catchUpWindow);
    if (!windowResult.success) return windowResult;

    const limitResult = this._validateCatchUpLimit(task.catchUpLimit);
    if (!limitResult.success) return limitResult;

    return this._success({});
  }

}

module.exports = Automator;
