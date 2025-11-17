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

      while (currentNextRun <= now && iterationCount < maxIterations) {
        iterationCount++;

        // Determine if we should execute this occurrence
        // UnBuffered: only execute if this is the actual current tick (not catching up)
        // Buffered: execute all missed occurrences
        const isInCurrentTick = currentNextRun > lastTick && currentNextRun <= now;
        const shouldExecute = action.unBuffered ? isInCurrentTick : true;

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
