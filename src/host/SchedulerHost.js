/**
 * SchedulerHost.js
 *
 * Manages real-time ticking with 1-second alignment.
 * Wraps the core engine and drives it with wall-clock time.
 */

const EventEmitter = require('events');
const CoreEngine = require('../core/CoreEngine');

class SchedulerHost extends EventEmitter {
  constructor() {
    super();
    this.state = { tasks: [] };
    this.running = false;
    this.lastTick = null;
    this.timer = null;
    this.functions = new Map();
    this.bootMode = true;
  }

  /**
   * Start the scheduler
   */
  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    const now = new Date();
    now.setMilliseconds(0);

    // Boot sweep - advance state to current time without executing tasks
    if (this.bootMode) {
      try {
        // Boot sweep: advance state from lastTick to now without executing tasks
        // If lastTick is null (first start), use now (no catch-up needed)
        const { newState, events } = CoreEngine.step(this.state, this.lastTick || now, now);

        // Update state (tasks are now advanced to current time)
        this.state = newState;

        // Process events to ensure state consistency, but don't execute callbacks
        // The bootMode flag will prevent _executeTaskEvent from calling functions
        for (const event of events) {
          if (event.type === 'task') {
            this._executeTaskEvent(event);
          } else if (event.type === 'error') {
            this.emit('error', event);
          }
        }

        // Exit boot mode
        this.bootMode = false;

        // Signal to Automator that state should be saved
        this.emit('boot-complete');

      } catch (error) {
        this.emit('error', {
          type: 'error',
          message: `Boot sweep error: ${error.message}`,
          error
        });
        // Exit boot mode even on error to allow normal operation
        this.bootMode = false;
      }
    }

    // Set lastTick after boot sweep completes
    this.lastTick = now;

    this._scheduleTick();
    this.emit('ready');
  }

  /**
   * Stop the scheduler
   */
  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Register a command function
   */
  addFunction(name, fn) {
    if (typeof fn !== 'function') {
      throw new Error(`Function ${name} must be a function`);
    }
    this.functions.set(name, fn);
  }

  /**
   * Remove a command function
   */
  removeFunction(name) {
    this.functions.delete(name);
  }

  /**
   * Schedule the next tick aligned to whole seconds
   */
  _scheduleTick() {
    if (!this.running) {
      return;
    }

    const now = new Date();
    const milliseconds = now.getMilliseconds();

    // Calculate wait time to next whole second
    const waitTime = 1000 - milliseconds;

    this.timer = setTimeout(() => {
      this._tick();
    }, waitTime);
  }

  /**
   * Execute one tick
   */
  _tick() {
    if (!this.running) {
      return;
    }

    const now = new Date();
    now.setMilliseconds(0); // Align to second boundary

    try {
      // Run the core engine step
      const { newState, events } = CoreEngine.step(this.state, this.lastTick, now);

      // Update state
      this.state = newState;
      this.lastTick = now;

      // Process events
      for (const event of events) {
        if (event.type === 'task') {
          this._executeTaskEvent(event);
        } else if (event.type === 'error') {
          this.emit('error', event);
        }
      }
    } catch (error) {
      this.emit('error', {
        type: 'error',
        message: `Tick error: ${error.message}`,
        error
      });
    }

    // Schedule next tick
    this._scheduleTick();
  }

  /**
   * Execute a task event by calling its registered function
   */
  _executeTaskEvent(event) {
    // Skip execution during boot mode
    if (this.bootMode) {
      return;
    }

    // Emit the task event
    this.emit('task', event);

    // Execute the command function if registered
    const fn = this.functions.get(event.cmd);
    if (fn) {
      try {
        fn(event.payload, event);
      } catch (error) {
        this.emit('error', {
          type: 'error',
          message: `Error executing command ${event.cmd}: ${error.message}`,
          taskId: event.taskId,
          error
        });
      }
    } else {
      this.emit('debug', {
        type: 'debug',
        message: `No function registered for command: ${event.cmd}`,
        taskId: event.taskId
      });
    }
  }

  /**
   * Add a task to the state
   */
  addTask(task) {
    this.state.tasks.push(task);
  }

  /**
   * Get current state
   */
  getState() {
    return this.state;
  }

  /**
   * Set state
   */
  setState(state) {
    this.state = state;
  }
}

module.exports = SchedulerHost;
