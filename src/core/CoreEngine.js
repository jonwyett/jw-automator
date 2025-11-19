/**
 * CoreEngine.js
 *
 * Pure state machine for scheduling.
 * Deterministic step function: step(state, lastTick, now) -> { newState, events }
 */

const RecurrenceEngine = require('./RecurrenceEngine');

class CoreEngine {
  /**
   * Process one scheduling step
   *
   * @param {Object} state - Current scheduler state (actions array)
   * @param {Date} lastTick - Previous tick time
   * @param {Date} now - Current tick time
   * @param {number} maxIterations - Safety limit for catch-up loops
   * @returns {Object} - { newState, events }
   */
  static step(state, lastTick, now, maxIterations = 10000) {
    const events = [];
    const newState = this._cloneState(state);

    // Process each action
    for (let i = 0; i < newState.actions.length; i++) {
      const action = newState.actions[i];

      if (!action.date) {
        // No scheduled time - run immediately
        const event = this._executeAction(action, now);
        events.push(event);

        // Advance to next occurrence
        this._advanceAction(action);

        // Check if action should be removed
        if (RecurrenceEngine.shouldStop(action)) {
          newState.actions.splice(i, 1);
          i--;
        }
        continue;
      }

      const nextRun = new Date(action.date);

      // Safety: prevent processing actions in the future
      if (nextRun > now) {
        continue;
      }

      // Catch-up loop: process all missed occurrences
      let iterationCount = 0;
      let currentNextRun = nextRun;

      // Get catchUpWindow (defaults to "unlimited" for backwards compatibility)
      const catchUpWindow = action.catchUpWindow !== undefined ? action.catchUpWindow : "unlimited";

      // Fast-forward optimization: if we're far outside the catch-up window,
      // jump directly to near the current time using mathematical projection
      if (catchUpWindow !== "unlimited" && action.repeat) {
        const lag = now.getTime() - currentNextRun.getTime();

        if (lag > catchUpWindow * 2) {
          // We're deep in the "Dead Zone" - use fast-forward
          const fastForwardResult = this._fastForwardAction(action, now, catchUpWindow);

          if (fastForwardResult) {
            currentNextRun = fastForwardResult.nextRun;
            action.date = currentNextRun;
            action.count = fastForwardResult.count;

            // After fast-forward, if still outside window, just advance without executing
            if (currentNextRun <= now) {
              const finalLag = now.getTime() - currentNextRun.getTime();
              if (finalLag > catchUpWindow) {
                // Still outside window after fast-forward, skip to next viable occurrence
                this._advanceAction(action);
                currentNextRun = action.date ? new Date(action.date) : null;
              }
            }
          }
        }
      }

      while (currentNextRun <= now && iterationCount < maxIterations) {
        iterationCount++;

        const lag = now.getTime() - currentNextRun.getTime();

        // Determine if we should execute this occurrence based on catchUpWindow
        const isInCurrentTick = currentNextRun > lastTick && currentNextRun <= now;
        const isWithinWindow = catchUpWindow === "unlimited" || lag <= catchUpWindow;

        // Legacy unBuffered behavior (maps to catchUpWindow: 0 or Infinity)
        const shouldExecute = isWithinWindow;

        if (shouldExecute) {
          const event = this._executeAction(action, currentNextRun);
          events.push(event);
        }

        // Advance to next occurrence
        const prevTime = currentNextRun.getTime();
        this._advanceAction(action);

        // Check if action should stop
        if (RecurrenceEngine.shouldStop(action)) {
          newState.actions.splice(i, 1);
          i--;
          break;
        }

        // Update currentNextRun for next iteration
        if (action.date) {
          currentNextRun = new Date(action.date);

          // SAFETY: Ensure monotonic progression
          if (currentNextRun.getTime() <= prevTime) {
            events.push({
              type: 'error',
              message: `Action ${action.id} failed to advance time monotonically`,
              actionId: action.id
            });
            // Force advancement
            currentNextRun = new Date(prevTime + 1000);
            action.date = currentNextRun;
          }
        } else {
          // No more occurrences
          break;
        }
      }

      // Safety check: iteration limit reached
      if (iterationCount >= maxIterations) {
        events.push({
          type: 'error',
          message: `Action ${action.id} exceeded max iterations (${maxIterations}) - possible infinite loop`,
          actionId: action.id
        });
      }
    }

    return { newState, events };
  }

  /**
   * Clone state for immutability
   */
  static _cloneState(state) {
    return {
      actions: state.actions.map(action => ({ ...action }))
    };
  }

  /**
   * Check if a time falls within the current tick window
   */
  static _isCurrentTick(time, lastTick, now) {
    return time > lastTick && time <= now;
  }

  /**
   * Create an action execution event
   */
  static _executeAction(action, scheduledTime) {
    return {
      type: 'action',
      actionId: action.id,
      name: action.name,
      cmd: action.cmd,
      payload: action.payload,
      scheduledTime: new Date(scheduledTime),
      actualTime: new Date(),
      count: action.count || 0
    };
  }

  /**
   * Advance an action to its next occurrence
   */
  static _advanceAction(action) {
    // Increment count
    action.count = (action.count || 0) + 1;

    // Calculate next run time
    if (action.repeat) {
      const currentTime = action.date ? new Date(action.date) : new Date();
      const dstPolicy = action.repeat.dstPolicy || 'once';

      const nextTime = RecurrenceEngine.getNextOccurrence(
        currentTime,
        action.repeat,
        dstPolicy
      );

      action.date = nextTime;
    } else {
      // One-time action - clear date
      action.date = null;
    }
  }

  /**
   * Fast-forward an action to near the current time using mathematical projection
   * This avoids iterating through thousands/millions of occurrences for high-frequency tasks
   *
   * @param {Object} action - The action to fast-forward
   * @param {Date} now - Current time
   * @param {number} catchUpWindow - The catch-up window in milliseconds
   * @returns {Object|null} - { nextRun, count } or null if not applicable
   */
  static _fastForwardAction(action, now, catchUpWindow) {
    if (!action.repeat || !action.date) {
      return null;
    }

    const { type, interval = 1 } = action.repeat;
    const currentTime = new Date(action.date);
    const lag = now.getTime() - currentTime.getTime();

    // Only applicable for simple time-based recurrence (not weekday/weekend)
    let stepMilliseconds = 0;

    switch (type) {
      case 'second':
        stepMilliseconds = interval * 1000;
        break;
      case 'minute':
        stepMilliseconds = interval * 60 * 1000;
        break;
      case 'hour':
        stepMilliseconds = interval * 60 * 60 * 1000;
        break;
      case 'day':
        stepMilliseconds = interval * 24 * 60 * 60 * 1000;
        break;
      case 'week':
        stepMilliseconds = interval * 7 * 24 * 60 * 60 * 1000;
        break;
      default:
        // Complex recurrence (weekday, weekend, month, year) - can't fast-forward easily
        return null;
    }

    if (stepMilliseconds === 0) {
      return null;
    }

    // Calculate how many steps we can skip
    // We want to jump to just before the catch-up window starts
    const targetLag = catchUpWindow;
    const timeToSkip = lag - targetLag;

    if (timeToSkip <= 0) {
      return null;
    }

    const stepsToSkip = Math.floor(timeToSkip / stepMilliseconds);

    if (stepsToSkip <= 0) {
      return null;
    }

    // Project forward
    const newTime = new Date(currentTime.getTime() + (stepsToSkip * stepMilliseconds));
    const newCount = (action.count || 0) + stepsToSkip;

    return {
      nextRun: newTime,
      count: newCount
    };
  }

  /**
   * Simulate actions in a time range without mutating state
   */
  static simulate(state, startDate, endDate, maxIterations = 100000) {
    const simulatedEvents = [];
    const simulatedState = this._cloneState(state);

    // Start simulation from the earliest action time or startDate
    let currentTime = new Date(startDate);

    // Align to second boundary
    currentTime.setMilliseconds(0);

    const endTime = new Date(endDate);
    let lastTick = new Date(currentTime.getTime() - 1000);

    let iterationCount = 0;
    const maxTotalIterations = maxIterations * 10;

    // Step through time second by second
    while (currentTime <= endTime && iterationCount < maxTotalIterations) {
      iterationCount++;

      const { newState, events } = this.step(simulatedState, lastTick, currentTime, maxIterations);
      simulatedState.actions = newState.actions;

      // Collect action events (filter out errors for cleaner simulation output)
      const actionEvents = events.filter(e => e.type === 'action');
      simulatedEvents.push(...actionEvents);

      // Advance time by 1 second
      lastTick = currentTime;
      currentTime = new Date(currentTime.getTime() + 1000);
    }

    return simulatedEvents;
  }
}

module.exports = CoreEngine;
