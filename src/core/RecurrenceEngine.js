/**
 * RecurrenceEngine.js
 *
 * Pure recurrence calculation logic.
 * Handles all DST transitions, local-time semantics, and next-run computations.
 */

class RecurrenceEngine {
  /**
   * Calculate the next occurrence time for a task based on its recurrence rule.
   *
   * CRITICAL INVARIANT: nextTime.getTime() > currentTime.getTime()
   *
   * @param {Date} currentTime - The current scheduled time (local)
   * @param {Object} repeat - The repeat configuration
   * @param {string} dstPolicy - 'once' or 'twice' for fall-back behavior
   * @returns {Date} - The next scheduled time (always > currentTime in UTC milliseconds)
   */
  static getNextOccurrence(currentTime, repeat, dstPolicy = 'once') {
    if (!repeat || !repeat.type) {
      return null;
    }

    const { type, interval = 1 } = repeat;
    const current = new Date(currentTime);
    let next = null;

    switch (type) {
      case 'second':
        next = this._addSeconds(current, interval);
        break;
      case 'minute':
        next = this._addMinutes(current, interval);
        break;
      case 'hour':
        next = this._addHours(current, interval);
        break;
      case 'day':
        next = this._addDays(current, interval);
        break;
      case 'weekday':
        next = this._addWeekdays(current, interval);
        break;
      case 'weekend':
        next = this._addWeekends(current, interval);
        break;
      case 'week':
        next = this._addWeeks(current, interval);
        break;
      case 'month':
        next = this._addMonths(current, interval);
        break;
      case 'year':
        next = this._addYears(current, interval);
        break;
      default:
        throw new Error(`Unknown recurrence type: ${type}`);
    }

    // SAFETY: Ensure monotonic progression
    if (next && next.getTime() <= current.getTime()) {
      // Force forward by 1 second to prevent infinite loops
      next = new Date(current.getTime() + 1000);
    }

    // Handle DST transitions
    next = this._handleDSTTransition(current, next, dstPolicy);

    return next;
  }

  /**
   * Fast-forward a task to a target time using mathematical projection.
   * This is only applicable for simple, fixed-duration recurrence types.
   *
   * @param {Date} currentTime - The current scheduled time.
   * @param {Object} repeat - The repeat configuration.
   * @param {Date} targetTime - The time to project towards.
   * @returns {Object|null} - { nextRun, skippedOccurrences } or null if not applicable.
   */
  static fastForward(currentTime, repeat, targetTime) {
    if (!repeat || !repeat.type) {
      return null;
    }

    const { type, interval = 1 } = repeat;
    const timeToSkip = targetTime.getTime() - currentTime.getTime();

    if (timeToSkip <= 0) {
      return { nextRun: currentTime, skippedOccurrences: 0 };
    }

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
        // Complex recurrence types (weekday, weekend, month, year) cannot be fast-forwarded.
        return null;
    }

    if (stepMilliseconds === 0) {
      return null;
    }

    const stepsToSkip = Math.floor(timeToSkip / stepMilliseconds);

    if (stepsToSkip <= 0) {
      return { nextRun: currentTime, skippedOccurrences: 0 };
    }

    const newTime = new Date(currentTime.getTime() + (stepsToSkip * stepMilliseconds));

    return {
      nextRun: newTime,
      skippedOccurrences: stepsToSkip,
    };
  }

  /**
   * Add seconds to a date
   */
  static _addSeconds(date, count) {
    return new Date(date.getTime() + (count * 1000));
  }

  /**
   * Add minutes to a date
   */
  static _addMinutes(date, count) {
    return new Date(date.getTime() + (count * 60 * 1000));
  }

  /**
   * Add hours to a date
   */
  static _addHours(date, count) {
    return new Date(date.getTime() + (count * 60 * 60 * 1000));
  }

  /**
   * Add days to a date (preserving local time across DST)
   */
  static _addDays(date, count) {
    const result = new Date(date);
    result.setDate(result.getDate() + count);
    return result;
  }

  /**
   * Add weekdays (Mon-Fri) to a date
   */
  static _addWeekdays(date, count) {
    const result = new Date(date);
    let added = 0;

    while (added < count) {
      result.setDate(result.getDate() + 1);
      const day = result.getDay();
      // 0 = Sunday, 6 = Saturday
      if (day !== 0 && day !== 6) {
        added++;
      }
    }

    return result;
  }

  /**
   * Add weekend days (Sat-Sun) to a date
   */
  static _addWeekends(date, count) {
    const result = new Date(date);
    let added = 0;

    while (added < count) {
      result.setDate(result.getDate() + 1);
      const day = result.getDay();
      // 0 = Sunday, 6 = Saturday
      if (day === 0 || day === 6) {
        added++;
      }
    }

    return result;
  }

  /**
   * Add weeks to a date
   */
  static _addWeeks(date, count) {
    return this._addDays(date, count * 7);
  }

  /**
   * Add months to a date (preserving day-of-month when possible)
   */
  static _addMonths(date, count) {
    const result = new Date(date);
    const originalDay = result.getDate();

    result.setMonth(result.getMonth() + count);

    // Handle edge case: Jan 31 + 1 month should be Feb 28/29, not Mar 3
    if (result.getDate() !== originalDay) {
      result.setDate(0); // Set to last day of previous month
    }

    return result;
  }

  /**
   * Add years to a date
   */
  static _addYears(date, count) {
    const result = new Date(date);
    result.setFullYear(result.getFullYear() + count);
    return result;
  }

  /**
   * Handle DST transitions between current and next time
   *
   * - Spring forward: missing hour handled naturally by Date constructor
   * - Fall back: prevent duplicate execution based on dstPolicy
   */
  static _handleDSTTransition(currentTime, nextTime, dstPolicy) {
    if (!nextTime) return nextTime;

    const currentOffset = currentTime.getTimezoneOffset();
    const nextOffset = nextTime.getTimezoneOffset();

    // No DST transition
    if (currentOffset === nextOffset) {
      return nextTime;
    }

    // Spring forward (offset decreased - clock jumped ahead)
    // The missing hour is handled naturally by Date arithmetic
    // No special handling needed

    // Fall back (offset increased - clock fell back)
    if (nextOffset > currentOffset) {
      // We've crossed into the repeated hour
      if (dstPolicy === 'once') {
        // Skip the second occurrence by adding the offset difference
        const offsetDiff = (nextOffset - currentOffset) * 60 * 1000;
        return new Date(nextTime.getTime() + offsetDiff);
      }
      // dstPolicy === 'twice': allow both occurrences (no adjustment needed)
    }

    return nextTime;
  }

  /**
   * Check if a task should stop based on limit or endDate
   */
  static shouldStop(task) {
    const { repeat } = task;

    if (!repeat) return true;

    // Check count limit
    if (repeat.limit !== null && repeat.limit !== undefined) {
      const count = task.count || 0;
      if (count >= repeat.limit) {
        return true;
      }
    }

    // Check end date
    if (repeat.endDate) {
      const endDate = new Date(repeat.endDate);
      const nextRun = new Date(task.date);
      if (nextRun > endDate) {
        return true;
      }
    }

    return false;
  }
}

module.exports = RecurrenceEngine;
