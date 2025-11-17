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
    this.state = { actions: [] };
    this.running = false;
    this.lastTick = null;
    this.timer = null;
    this.functions = new Map();
  }

  /**
   * Start the scheduler
   */
  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.lastTick = new Date();
    this.lastTick.setMilliseconds(0);

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
        if (event.type === 'action') {
          this._executeActionEvent(event);
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
   * Execute an action event by calling its registered function
   */
  _executeActionEvent(event) {
    // Emit the action event
    this.emit('action', event);

    // Execute the command function if registered
    const fn = this.functions.get(event.cmd);
    if (fn) {
      try {
        fn(event.payload, event);
      } catch (error) {
        this.emit('error', {
          type: 'error',
          message: `Error executing command ${event.cmd}: ${error.message}`,
          actionId: event.actionId,
          error
        });
      }
    } else {
      this.emit('debug', {
        type: 'debug',
        message: `No function registered for command: ${event.cmd}`,
        actionId: event.actionId
      });
    }
  }

  /**
   * Add an action to the state
   */
  addAction(action) {
    this.state.actions.push(action);
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
