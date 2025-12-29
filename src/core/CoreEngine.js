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
   * @param {Object} state - Current scheduler state (tasks array)
   * @param {Date} lastTick - Previous tick time
   * @param {Date} now - Current tick time
   * @param {number} maxIterations - Safety limit for catch-up loops
   * @returns {Object} - { newState, events }
   */
  static step(state, lastTick, now, maxIterations = 10000) {
    const events = [];
    const newState = this._cloneState(state);

    // Process each task
    for (let i = 0; i < newState.tasks.length; i++) {
      const task = newState.tasks[i];

      if (!task.date) {
        // No scheduled time - run immediately
        const event = this._executeTask(task, now);
        events.push(event);

        // Advance to next occurrence
        this._advanceTask(task);

        // Check if task should be removed
        if (RecurrenceEngine.shouldStop(task)) {
          newState.tasks.splice(i, 1);
          i--;
        }
        continue;
      }

      const nextRun = new Date(task.date);

      // Safety: prevent processing tasks in the future
      if (nextRun > now) {
        continue;
      }

      // Catch-up loop: process all missed occurrences
      let iterationCount = 0;
      let currentNextRun = nextRun;

      // Get catchUpWindow and catchUpLimit (defaults to 0 - real-time mode, no catch-up)
      const catchUpWindow = task.catchUpWindow !== undefined ? task.catchUpWindow : 0;
      const catchUpLimit = task.catchUpLimit !== undefined ? task.catchUpLimit : 0;

      // JUMP: Fast-forward to the beginning of the catch-up window.
      // This avoids iterating through a large number of occurrences outside the window.
      if (catchUpWindow !== "unlimited" && catchUpWindow > 0 && task.repeat) {
        const windowStart = new Date(now.getTime() - catchUpWindow);
        if (currentNextRun < windowStart) {
          const ffResult = RecurrenceEngine.fastForward(currentNextRun, task.repeat, windowStart);
          if (ffResult && ffResult.skippedOccurrences > 0) {
            task.date = ffResult.nextRun;
            task.count = (task.count || 0) + ffResult.skippedOccurrences;
            currentNextRun = ffResult.nextRun;
          }
        }
      }

      // Buffer for collecting eligible slots when catchUpLimit is set
      // This allows us to keep only the most recent N slots
      const eligibleBuffer = [];
      const needsBuffering = catchUpLimit !== "all" && catchUpLimit > 0;

      while (currentNextRun && currentNextRun <= now && iterationCount < maxIterations) {
        iterationCount++;

        const lag = now.getTime() - currentNextRun.getTime();

        // Determine if this occurrence is eligible based on catchUpWindow
        const isWithinWindow = catchUpWindow === "unlimited" || lag <= catchUpWindow;

        if (isWithinWindow) {
          if (needsBuffering) {
            // Buffer this eligible slot
            eligibleBuffer.push({
              scheduledTime: new Date(currentNextRun),
              count: task.count || 0
            });
            // Keep only the last N slots
            if (eligibleBuffer.length > catchUpLimit) {
              eligibleBuffer.shift();
            }
          } else if (catchUpLimit === "all") {
            // Execute immediately - no limit
            const event = this._executeTask(task, currentNextRun);
            events.push(event);
          }
          // If catchUpLimit is 0, don't execute (real-time mode)
        }

        // Advance to next occurrence
        const prevTime = currentNextRun.getTime();
        this._advanceTask(task);

        // Check if task should stop
        if (RecurrenceEngine.shouldStop(task)) {
          newState.tasks.splice(i, 1);
          i--;
          break;
        }

        // Update currentNextRun for next iteration
        if (task.date) {
          currentNextRun = new Date(task.date);

          // SAFETY: Ensure monotonic progression
          if (currentNextRun.getTime() <= prevTime) {
            events.push({
              type: 'error',
              message: `Task ${task.id} failed to advance time monotonically`,
              taskId: task.id
            });
            // Force advancement
            currentNextRun = new Date(prevTime + 1000);
            task.date = currentNextRun;
          }
        } else {
          // No more occurrences
          break;
        }
      }

      // Execute buffered slots (if we were buffering)
      if (needsBuffering && eligibleBuffer.length > 0) {
        for (const slot of eligibleBuffer) {
          const event = {
            type: 'task',
            taskId: task.id,
            name: task.name,
            cmd: task.cmd,
            payload: task.payload,
            scheduledTime: slot.scheduledTime,
            actualTime: new Date(),
            count: slot.count
          };
          events.push(event);
        }
      }

      // Safety check: iteration limit reached
      if (iterationCount >= maxIterations) {
        events.push({
          type: 'error',
          message: `Task ${task.id} exceeded max iterations (${maxIterations}) - possible infinite loop`,
          taskId: task.id
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
      tasks: state.tasks.map(task => ({ ...task }))
    };
  }

  /**
   * Create a task execution event
   */
  static _executeTask(task, scheduledTime) {
    return {
      type: 'task',
      taskId: task.id,
      name: task.name,
      cmd: task.cmd,
      payload: task.payload,
      scheduledTime: new Date(scheduledTime),
      actualTime: new Date(),
      count: task.count || 0
    };
  }

  /**
   * Advance a task to its next occurrence
   */
  static _advanceTask(task) {
    // Increment count
    task.count = (task.count || 0) + 1;

    // Calculate next run time
    if (task.repeat) {
      const currentTime = task.date ? new Date(task.date) : new Date();
      const dstPolicy = task.repeat.dstPolicy || 'once';

      const nextTime = RecurrenceEngine.getNextOccurrence(
        currentTime,
        task.repeat,
        dstPolicy
      );

      task.date = nextTime;
    } else {
      // One-time task - clear date
      task.date = null;
    }
  }



  /**
   * Simulate tasks in a time range without mutating state
   */
  static simulate(state, startDate, endDate, maxIterations = 100000) {
    const simulatedEvents = [];
    const simulatedState = this._cloneState(state);

    // Start simulation from the earliest task time or startDate
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
      simulatedState.tasks = newState.tasks;

      // Collect task events (filter out errors for cleaner simulation output)
      const taskEvents = events.filter(e => e.type === 'task');
      simulatedEvents.push(...taskEvents);

      // Advance time by 1 second
      lastTick = currentTime;
      currentTime = new Date(currentTime.getTime() + 1000);
    }

    return simulatedEvents;
  }
}

module.exports = CoreEngine;
