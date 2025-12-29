# Boot Mode Design Specification

**Status**: Design Document (For Discussion)
**Created**: 2025-11-24
**Version**: 2.0 - MAJOR REVISION: Boot Sequence Architecture

---

## Executive Summary

**CRITICAL ARCHITECTURAL CHANGE:** Boot sweep now runs BEFORE the perfect timer starts.

### Why This Matters

The scheduler implements a "perfect timer" that self-corrects to fire exactly on whole-second boundaries. This prevents drift and ensures deterministic behavior. Boot processing (loading state, advancing tasks through potentially thousands of slots, executing catch-up tasks) can take seconds.

**Current Problem:** Boot processing happens during the first tick, contaminating the perfect timer with delays.

**Solution:** Boot sweep is now a separate phase that completes BEFORE the timer starts. The perfect timer starts clean, perfectly aligned, and untainted by boot processing.

### Impact

- **Timer Quality:** Perfect timer starts perfectly, no drift risk
- **Truthful Events:** `ready` event fires when scheduler is truly operational
- **Cleaner Architecture:** Clear separation between initialization (boot) and runtime (ticking)
- **No Breaking Changes:** Boot sweep is synchronous, so `ready` still fires "immediately" from user's perspective

### Secondary Feature

The `skipExecuteOnBoot: true` option (enabled by default) suppresses task execution during boot sweep, preventing "catch-up storms" after long offline periods.

---

## Table of Contents

1. [Overview](#overview)
2. [Problem Statement](#problem-statement)
3. [Current Behavior Analysis](#current-behavior-analysis)
4. [Design Decisions](#design-decisions)
5. [Implementation Specification](#implementation-specification)
6. [Edge Cases & Considerations](#edge-cases--considerations)
7. [Testing Strategy](#testing-strategy)
8. [Future Enhancements](#future-enhancements)
9. [Open Questions](#open-questions)

---

## Overview

### Goals

**PRIMARY GOAL (Critical Architecture Change):**
Implement a dedicated boot sequence that runs BEFORE the perfect timer starts. This ensures:
- Boot processing (state loading, task advancement, potential execution) completes synchronously
- The "perfect timer" (second-aligned ticking) starts clean and aligned
- No boot delays interfere with tick timing or cause drift
- Clear separation between initialization and runtime operation

**SECONDARY GOAL:**
Provide option to skip task execution during boot sweep, preventing "catch-up storms" when the scheduler has been offline for extended periods.

### User-Facing API
```javascript
const automator = new Automator({
  storage: Automator.storage.file('./scheduler.json'),
  skipExecuteOnBoot: true  // NEW: default true
});

automator.on('boot-complete', (stats) => {
  console.log(`Boot complete: ${stats.tasksProcessed} tasks, ${stats.slotsAdvanced} slots`);
});

automator.start();
```

### Behavior Summary

**New Boot Sequence:**
1. `automator.start()` called
2. **Boot sweep executes** (before timer starts):
   - All tasks advanced to present time
   - Tasks optionally executed (if `skipExecuteOnBoot: false`)
   - State saved to disk
3. **Events emitted**:
   - `boot-complete` (with statistics)
   - `ready` (signals timer is starting)
4. **Perfect timer starts**:
   - Aligned to next whole second boundary
   - First tick happens at exactly :00.000
   - Self-correcting for event loop delays

**Key Architectural Change:**
- Boot sweep is NOT a tick - it happens BEFORE ticking begins
- Perfect timer starts clean, untainted by boot processing
- No risk of boot delays cascading into normal operation

---

## Problem Statement

### Current Behavior (Without Boot Mode)

When the scheduler starts after being offline:

1. State loads from disk (tasks may have dates in the past)
2. `start()` is called, setting `lastTick = now`
3. First tick fires ~1 second later
4. First tick processes ALL catch-up logic for ALL tasks
5. If `catchUpWindow` and `catchUpLimit` allow it, hundreds/thousands of executions occur

**Example Scenario:**
```javascript
// Task scheduled to run every second
automator.addTask({
  cmd: 'processData',
  date: new Date('2025-01-01T12:00:00'),
  repeat: { type: 'second' },
  catchUpWindow: 'unlimited',
  catchUpLimit: 'all'
});

// Program stopped at 12:00:00, restarted at 15:00:00
// First tick would execute 10,800 tasks (3 hours × 3600 seconds)
```

### Desired Behavior (With Boot Mode)

Same scenario with `skipExecuteOnBoot: true`:

1. `start()` triggers boot sweep (NOT a tick)
2. Boot sweep advances task through all 10,800 slots
3. Task's `count` incremented by 10,800
4. Task's `date` set to next future occurrence (15:00:01)
5. **NO task executions** during boot sweep
6. State saved to disk
7. `boot-complete` and `ready` events emitted
8. Perfect timer starts, aligned to next whole second
9. First TICK happens cleanly with no catch-up needed

---

## Current Behavior Analysis

### Investigation Findings

#### Finding 1: Boot Mode is Partially Redundant

**Current code already supports "advance without execute":**

```javascript
// CoreEngine.js lines 56-57, 120
const catchUpWindow = task.catchUpWindow !== undefined ? task.catchUpWindow : 0;
const catchUpLimit = task.catchUpLimit !== undefined ? task.catchUpLimit : 0;

// Line 120: "If catchUpLimit is 0, don't execute (real-time mode)"
```

Setting `catchUpWindow=0, catchUpLimit=0` provides:
- ✅ Tasks advance through all slots
- ✅ No executions occur (outside window or zero limit)
- ✅ Deterministic state progression
- ✅ Fast-forward optimization still applies

**Why boot mode is still valuable:**
1. **Clear semantics**: "This is boot" vs. "This is a configuration"
2. **User intent**: Boot is one-time system initialization, not a task policy
3. **Events**: Explicit `boot-complete` event signals ready state
4. **Flexibility**: Future per-task boot behavior (some tasks run on boot, others don't)
5. **Debugging**: Debug events can distinguish boot skips from catch-up skips

#### Finding 2: **CRITICAL - Timing Architecture Issue**

**Current sequence (PROBLEMATIC):**
```
T=0ms:    automator.start() called
T=0ms:    SchedulerHost.start() sets lastTick=now, schedules first tick
T=0ms:    'ready' event emitted (LIES - not ready yet!)
T=1000ms: First tick fires, starts processing catch-up
T=1000ms-3500ms: First tick processes 10,800 slots (takes 2.5 seconds)
T=3500ms: First tick completes, schedules next tick
T=4000ms: Second tick (delayed, imperfect alignment)
```

**Problems:**
1. **`'ready'` fires before scheduler is actually ready** - misleading
2. **All catch-up happens during first tick** - can take seconds
3. **Boot delays contaminate the perfect timer** - first tick takes 2.5s, delays subsequent ticks
4. **Perfect timer doesn't start perfectly** - drift risk, alignment issues
5. **Boot processing interferes with tick timing** - architectural smell

**The Perfect Timer Architecture:**

The scheduler implements a self-correcting "perfect timer" via `_scheduleTick()`:

```javascript
_scheduleTick() {
  const now = new Date();
  const milliseconds = now.getMilliseconds();
  const waitTime = 1000 - milliseconds;  // Wait to next whole second
  this.timer = setTimeout(() => this._tick(), waitTime);
}
```

**This ensures:**
- Every tick fires at exactly :XX.000 milliseconds
- Self-corrects for event loop delays
- Prevents drift over time
- Deterministic, testable behavior

**Boot processing MUST NOT interfere with this perfect timer.**

#### Finding 3: No Skip Detection

**Currently, no debug events are emitted when:**
- Slots are skipped due to `catchUpWindow` exceeded
- Slots are skipped due to `catchUpLimit` exceeded
- Slots are skipped due to `catchUpLimit=0` (real-time mode)
- Ticks are delayed due to event loop being busy

**This makes debugging difficult**: Users can't tell why tasks didn't run.

---

## Design Decisions

### Decision 1: **Boot Sweep Runs BEFORE Perfect Timer Starts (CRITICAL)**

**Rationale:**
- **Protects the perfect timer** - boot processing cannot interfere with tick timing
- **Clear separation of concerns** - initialization vs. runtime operation
- **Truthful `ready` event** - only fires when scheduler is truly operational
- **No drift risk** - timer starts perfectly aligned, no contamination from boot delays
- **Simpler mental model** - boot is boot, ticking is ticking, they're separate

**Sequence:**
```javascript
// SchedulerHost.start()
start(options = {}) {
  if (this.running) return;

  const skipExecuteOnBoot = options.skipExecuteOnBoot !== false;

  // 1. FIRST: Perform boot sweep (before timer starts)
  const bootStats = this._performBootSweep(skipExecuteOnBoot);

  // 2. Emit boot-complete
  this.emit('boot-complete', bootStats);

  // 3. NOW start the perfect timer
  this.running = true;
  this.lastTick = new Date();
  this.lastTick.setMilliseconds(0);
  this._scheduleTick();

  // 4. Emit ready (timer is now running)
  this.emit('ready');
}
```

**Alternative considered (REJECTED):**
- First tick IS boot tick
- **Problem**: Boot delays contaminate perfect timer
- **Problem**: First tick can take seconds, delaying subsequent ticks
- **Problem**: `ready` fires before boot completes
- **Problem**: Architectural smell - mixing initialization with runtime

**This is the PRIMARY architectural change. The `skipExecuteOnBoot` option is secondary.**

### Decision 2: Boot Sweep Triggers Once Per Process

**Rationale:**
- Boot sweep prevents "catch-up storms" after offline periods
- Calling `stop()` then `start()` in same process isn't an "offline period"
- Simplifies implementation (no need to track stop/start cycles)

**Implementation:**
```javascript
start(options = {}) {
  if (this.running) return;

  // Only perform boot sweep if we haven't booted yet
  if (!this.bootComplete) {
    const skipExecuteOnBoot = options.skipExecuteOnBoot !== false;
    const bootStats = this._performBootSweep(skipExecuteOnBoot);
    this.bootComplete = true;
    this.emit('boot-complete', bootStats);
  }

  // Start perfect timer (happens every time)
  this.running = true;
  this.lastTick = new Date();
  this.lastTick.setMilliseconds(0);
  this._scheduleTick();
  this.emit('ready');
}
```

### Decision 3: Boot Mode Option Name

**Chosen:** `skipExecuteOnBoot: true` (default `true`)

**Rationale:**
- Clear intent: "skip execution on boot"
- Default `true` = safe default (prevents storms)
- Opt-out: set to `false` to execute on boot

**Alternative names considered:**
- `bootMode: true` - less clear (boot mode does what?)
- `enableBootMode: true` - verbose
- `suppressBootExecution: true` - verbose

### Decision 4: Ready Event Timing

**New behavior:** `'ready'` event fires AFTER boot sweep completes, just before timer starts

**Rationale:**
- Signals "scheduler is caught up and operational, timer starting now"
- Users can safely query tasks knowing they're current
- Prevents race conditions
- Truthful event - scheduler IS ready when this fires

**Breaking change?** **NO** - actually makes the event more meaningful:
- Current behavior: `'ready'` fires immediately on `start()` (misleading - not really ready)
- New behavior: `'ready'` fires after boot sweep, before first tick (truthful - actually ready)
- **Impact**: Code waiting for `ready` now gets accurate signal
- **Benefit**: Boot sweep is synchronous (or awaited), so `ready` fires "immediately" after `start()` returns/resolves

### Decision 5: State Persistence After Boot

**Decision:** YES, automatically save state after boot completes

**Rationale:**
- During boot, tasks may advance through thousands of slots
- `count` values updated, `date` values updated
- If program crashes post-boot, should have current state
- Prevents re-processing same catch-up on next boot

**Implementation:**
```javascript
// SchedulerHost.start()
start(options = {}) {
  if (this.running) return;

  if (!this.bootComplete) {
    const skipExecuteOnBoot = options.skipExecuteOnBoot !== false;
    const bootStats = this._performBootSweep(skipExecuteOnBoot);
    this.bootComplete = true;

    // Emit boot-complete
    this.emit('boot-complete', bootStats);

    // Signal to Automator to save state
    this.emit('boot-save-required');
  }

  // Start timer
  this.running = true;
  this.lastTick = new Date();
  this.lastTick.setMilliseconds(0);
  this._scheduleTick();

  // Emit ready (after boot, before first tick)
  this.emit('ready');
}
```

```javascript
// Automator.js
this.host.on('boot-save-required', () => {
  if (this.options.autoSave) {
    this._saveState();
  }
});
```

### Decision 6: Error Events During Boot

**Decision:** YES, error events still emitted during boot

**Rationale:**
- Errors indicate bugs (iteration limits, monotonic progression failures)
- Should be visible regardless of boot mode
- Safety violations are not execution events

---

## Implementation Specification

### File 1: SchedulerHost.js

#### New State Properties

```javascript
class SchedulerHost {
  constructor() {
    // ... existing properties ...

    // Boot tracking
    this.bootComplete = false;  // Has boot sweep ever run?
  }
}
```

#### Modified: start() method

**Location:** `src/host/SchedulerHost.js` lines 24-35

**CRITICAL CHANGE: Boot sweep runs BEFORE timer starts**

```javascript
start(options = {}) {
  if (this.running) {
    return;
  }

  // PHASE 1: Boot sweep (if not yet booted)
  // This happens BEFORE the timer starts
  if (!this.bootComplete) {
    const skipExecuteOnBoot = options.skipExecuteOnBoot !== false; // default true

    // Perform boot sweep (synchronous)
    const bootStartTime = Date.now();
    const bootStats = this._performBootSweep(skipExecuteOnBoot);
    const bootEndTime = Date.now();

    bootStats.duration = bootEndTime - bootStartTime;

    // Mark boot as complete
    this.bootComplete = true;

    // Emit boot-complete event
    this.emit('boot-complete', {
      type: 'boot-complete',
      ...bootStats
    });

    // Signal to Automator to save state
    this.emit('boot-save-required');
  }

  // PHASE 2: Start the perfect timer
  // Timer starts clean, untainted by boot processing
  this.running = true;
  this.lastTick = new Date();
  this.lastTick.setMilliseconds(0);

  this._scheduleTick();

  // PHASE 3: Emit ready (timer is now running)
  this.emit('ready');
}
```

#### New: _performBootSweep() method

**Location:** `src/host/SchedulerHost.js` (new method)

**This is the core of the boot sequence - runs BEFORE timer starts**

```javascript
/**
 * Perform boot sweep to bring all tasks up to present time
 * This runs BEFORE the perfect timer starts
 *
 * @param {boolean} skipExecuteOnBoot - If true, suppress task execution
 * @returns {Object} Boot statistics
 */
_performBootSweep(skipExecuteOnBoot) {
  const now = new Date();
  now.setMilliseconds(0); // Align to second boundary

  // Use a very old lastTick to ensure we catch up from saved state
  const lastTick = new Date(0);

  const bootStats = {
    tasksProcessed: 0,
    slotsAdvanced: 0,
    slotsSkipped: 0,
    tasksExecuted: 0
  };

  try {
    // Run CoreEngine.step() with boot mode flag
    const { newState, events } = CoreEngine.step(
      this.state,
      lastTick,
      now,
      undefined, // maxIterations (use default)
      skipExecuteOnBoot // isBootMode flag
    );

    // Update state
    this.state = newState;

    // Count tasks processed
    bootStats.tasksProcessed = this.state.tasks.length;

    // Process events
    for (const event of events) {
      if (event.type === 'task') {
        // Task execution event
        if (!skipExecuteOnBoot) {
          // Execute the task
          this._executeTaskEvent(event);
          bootStats.tasksExecuted++;
        } else {
          // Skip execution (boot mode)
          bootStats.slotsSkipped++;
        }
      } else if (event.type === 'error') {
        // Always emit error events
        this.emit('error', event);
      } else if (event.type === 'debug') {
        // Emit debug events
        this.emit('debug', event);

        // Track skipped slots from debug events
        if (event.subtype === 'slot-skipped' ||
            event.subtype === 'fast-forward-skipped' ||
            event.subtype === 'buffered-slots-skipped') {
          bootStats.slotsSkipped += event.slotsSkipped || 1;
        }
      }
    }

    // Set lastTick to now for when timer starts
    this.lastTick = now;

  } catch (error) {
    this.emit('error', {
      type: 'error',
      message: `Boot sweep error: ${error.message}`,
      error
    });
  }

  return bootStats;
}
```

#### Modified: _tick() method

**Location:** `src/host/SchedulerHost.js` lines 87-121

**NO MAJOR CHANGES - Boot logic removed, ticks remain pure**

```javascript
_tick() {
  if (!this.running) {
    return;
  }

  const now = new Date();
  now.setMilliseconds(0);

  try {
    // Normal tick - no boot logic, no boot flag
    const { newState, events } = CoreEngine.step(
      this.state,
      this.lastTick,
      now
      // Note: NO isBootMode parameter - boot happens before ticking starts
    );

    this.state = newState;
    this.lastTick = now;

    // Process events normally
    for (const event of events) {
      if (event.type === 'task') {
        this._executeTaskEvent(event);
      } else if (event.type === 'error') {
        this.emit('error', event);
      } else if (event.type === 'debug') {
        this.emit('debug', event);
      }
    }

  } catch (error) {
    this.emit('error', {
      type: 'error',
      message: `Tick error: ${error.message}`,
      error
    });
  }

  // Schedule next tick (self-correcting perfect timer)
  this._scheduleTick();
}
```

### File 2: CoreEngine.js

#### Modified: step() method signature

**Location:** `src/core/CoreEngine.js` line 20

```javascript
/**
 * Process one scheduling step
 *
 * @param {Object} state - Current scheduler state (tasks array)
 * @param {Date} lastTick - Previous tick time
 * @param {Date} now - Current tick time
 * @param {number} maxIterations - Safety limit for catch-up loops
 * @param {boolean} isBootMode - If true, suppress task execution events
 * @returns {Object} - { newState, events, bootStats }
 */
static step(state, lastTick, now, maxIterations = 10000, isBootMode = false) {
  const events = [];
  const newState = this._cloneState(state);

  // Boot statistics tracking
  const bootStats = isBootMode ? {
    tasksProcessed: 0,
    slotsAdvanced: 0,
    slotsSkipped: 0
  } : null;

  // ... rest of step logic ...

  return { newState, events, bootStats };
}
```

#### Modified: Task processing loop

**Location:** `src/core/CoreEngine.js` lines 25-180

**Changes required at 4 locations:**

**1. Immediate execution tasks (lines 28-42):**

```javascript
if (!task.date) {
  // No scheduled time - run immediately (unless boot mode)
  if (!isBootMode) {
    const event = this._executeTask(task, now);
    events.push(event);
  } else {
    // Boot mode: skip execution but track
    if (bootStats) {
      bootStats.slotsSkipped++;
    }
    events.push({
      type: 'debug',
      subtype: 'slot-skipped',
      reason: 'boot-mode',
      taskId: task.id,
      scheduledTime: now
    });
  }

  // Advance to next occurrence
  this._advanceTask(task);

  if (bootStats) {
    bootStats.tasksProcessed++;
    bootStats.slotsAdvanced++;
  }

  // Check if task should be removed
  if (RecurrenceEngine.shouldStop(task)) {
    newState.tasks.splice(i, 1);
    i--;
  }
  continue;
}
```

**2. Fast-forward events (lines 66-77):**

```javascript
if (fastForwardResult) {
  currentNextRun = fastForwardResult.nextRun;
  task.date = currentNextRun;
  task.count = fastForwardResult.count;

  if (bootStats) {
    bootStats.slotsAdvanced += fastForwardResult.slotsSkipped || 0;
  }

  // Execute the buffered events from fast-forward (unless boot mode)
  if (!isBootMode && fastForwardResult.events) {
    events.push(...fastForwardResult.events);
  } else if (isBootMode && fastForwardResult.events) {
    // Boot mode: track skipped events
    if (bootStats) {
      bootStats.slotsSkipped += fastForwardResult.events.length;
    }
    // Emit single debug event (not one per slot - too verbose)
    events.push({
      type: 'debug',
      subtype: 'fast-forward-skipped',
      reason: 'boot-mode',
      taskId: task.id,
      slotsSkipped: fastForwardResult.events.length
    });
  }

  // ... rest of fast-forward logic ...
}
```

**3. Direct execution in catch-up loop (lines 115-119):**

```javascript
} else if (catchUpLimit === "all") {
  // Execute immediately - no limit (unless boot mode)
  if (!isBootMode) {
    const event = this._executeTask(task, currentNextRun);
    events.push(event);
  } else {
    // Boot mode: track skip
    if (bootStats) {
      bootStats.slotsSkipped++;
    }
  }
}
```

**4. Buffered execution (lines 156-170):**

```javascript
// Execute buffered slots (if we were buffering)
if (needsBuffering && eligibleBuffer.length > 0) {
  if (!isBootMode) {
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
  } else {
    // Boot mode: track skipped buffered slots
    if (bootStats) {
      bootStats.slotsSkipped += eligibleBuffer.length;
    }
    events.push({
      type: 'debug',
      subtype: 'buffered-slots-skipped',
      reason: 'boot-mode',
      taskId: task.id,
      slotsSkipped: eligibleBuffer.length
    });
  }
}
```

**5. Track slot advancement (lines 123-125):**

```javascript
// Advance to next occurrence
const prevTime = currentNextRun.getTime();
this._advanceTask(task);

if (bootStats) {
  bootStats.slotsAdvanced++;
}
```

**6. Track task processing (after task loop, line 180):**

```javascript
// End of task loop
for (let i = 0; i < newState.tasks.length; i++) {
  const task = newState.tasks[i];

  if (bootStats) {
    bootStats.tasksProcessed++;
  }

  // ... task processing logic ...
}
```

#### Modified: simulate() method

**Location:** `src/core/CoreEngine.js` lines 360-393

**Ensure simulate never uses boot mode:**

```javascript
static simulate(state, startDate, endDate, maxIterations = 100000) {
  // ... existing logic ...

  while (currentTime <= endTime && iterationCount < maxTotalIterations) {
    iterationCount++;

    // IMPORTANT: simulate always passes isBootMode=false
    const { newState, events } = this.step(
      simulatedState,
      lastTick,
      currentTime,
      maxIterations,
      false  // NEVER use boot mode in simulation
    );

    // ... rest of simulate logic ...
  }

  return simulatedEvents;
}
```

### File 3: Automator.js

#### New Constructor Option

**Location:** `src/Automator.js` lines 13-19

```javascript
constructor(options = {}) {
  this.options = {
    storage: options.storage || new MemoryStorage(),
    autoSave: options.autoSave !== false, // default true
    saveInterval: options.saveInterval || 5000, // 5 seconds
    skipExecuteOnBoot: options.skipExecuteOnBoot !== false, // NEW: default true
    ...options
  };

  // ... rest of constructor ...
}
```

#### Forward boot-complete Event

**Location:** `src/Automator.js` lines 26-29

```javascript
// Forward events from host
this.host.on('ready', (...args) => this._emit('ready', ...args));
this.host.on('task', (...args) => this._emit('task', ...args));
this.host.on('error', (...args) => this._emit('error', ...args));
this.host.on('debug', (...args) => this._emit('debug', ...args));

// NEW: Forward boot-complete event
this.host.on('boot-complete', (...args) => this._emit('boot-complete', ...args));
```

#### Handle boot-save-required Event

**Location:** `src/Automator.js` after line 29

```javascript
// NEW: Handle boot save requirement
this.host.on('boot-save-required', () => {
  if (this.options.autoSave) {
    this._saveState();
  }
});
```

#### Pass skipExecuteOnBoot to Host

**Challenge:** How does SchedulerHost know about the `skipExecuteOnBoot` option?

**Option A:** Pass via constructor
```javascript
// Automator.js line 21
this.host = new SchedulerHost({
  skipExecuteOnBoot: this.options.skipExecuteOnBoot
});
```

**Option B:** Pass via start()
```javascript
// Automator.js line 69
start() {
  this.host.start({
    skipExecuteOnBoot: this.options.skipExecuteOnBoot
  });

  // ... rest of start logic ...
}
```

**Option C:** Make SchedulerHost query Automator (coupling issue)

**RECOMMENDATION: Option B** - Pass via start()
- Cleaner: boot mode is a start-time concern
- Flexible: Could theoretically boot differently on different starts
- Minimal changes to SchedulerHost constructor

**SchedulerHost.js modification:**

```javascript
start(options = {}) {
  if (this.running) {
    return;
  }

  const skipExecuteOnBoot = options.skipExecuteOnBoot !== false; // default true

  this.running = true;
  this.lastTick = new Date();
  this.lastTick.setMilliseconds(0);

  // Boot mode only if:
  // 1. We haven't booted yet (bootComplete = false)
  // 2. AND skipExecuteOnBoot is enabled
  this.isBootTick = !this.bootComplete && skipExecuteOnBoot;

  this._scheduleTick();

  if (this.bootComplete) {
    this.emit('ready');
  }
}
```

**Automator.js modification:**

```javascript
start() {
  this.host.start({
    skipExecuteOnBoot: this.options.skipExecuteOnBoot
  });

  // Start auto-save if enabled
  if (this.options.autoSave) {
    this._startAutoSave();
  }
}
```

---

## Edge Cases & Considerations

### Edge Case 1: Empty Task List

**Scenario:** Scheduler starts with no tasks (fresh database or after seed).

**Behavior:**
- Boot tick still fires
- No tasks to process
- `bootStats.tasksProcessed = 0`
- `boot-complete` event still emitted
- `ready` event emitted immediately after

**No special handling needed** - works naturally.

### Edge Case 2: All Tasks Are Future-Scheduled

**Scenario:** All tasks have `date > now` (no catch-up needed).

**Behavior:**
- Boot tick processes all tasks
- No slots to advance (all in future)
- `bootStats.slotsAdvanced = 0`
- `boot-complete` event emitted
- Second tick begins normal operation

**No special handling needed** - works naturally.

### Edge Case 3: Seed Function Interaction

**Scenario:** User calls `seed()` which adds tasks, then `start()`.

```javascript
automator.seed((auto) => {
  auto.addTask({
    cmd: 'initialize',
    date: new Date(Date.now() - 3600000), // 1 hour ago
    repeat: { type: 'hour' }
  });
});
automator.start(); // Boot mode triggers
```

**Behavior:**
- `seed()` adds task with date in the past
- Boot tick advances task through all slots from 1 hour ago to now
- Task positioned at next future hour
- No execution during boot

**Works correctly** - no special handling needed.

### Edge Case 4: Tasks Added During Boot Tick

**Scenario:** User calls `addTask()` while boot tick is running.

**Analysis:**
- Boot tick is synchronous JavaScript
- `addTask()` cannot interrupt boot tick
- If `addTask()` called before boot tick starts, task included in boot
- If `addTask()` called after boot tick ends, task processed normally

**Potential issue:**
```javascript
automator.on('boot-complete', () => {
  automator.addTask({ cmd: 'test', date: new Date() });
});
automator.start();
```

**Behavior:**
- Boot tick completes
- `boot-complete` event emitted
- `addTask()` called (adds task with date = now)
- Second tick processes new task
- Task might be slightly late (now + 1 second)

**No special handling needed** - acceptable behavior.

### Edge Case 5: Stop/Start Cycles

**Scenario:** User calls `stop()` then `start()` multiple times.

**Expected behavior:**
```javascript
automator.start();  // Boot mode: YES (first ever start)
// ... time passes ...
automator.stop();
automator.start();  // Boot mode: NO (already booted)
automator.stop();
automator.start();  // Boot mode: NO (already booted)
```

**Implementation validates this** - `bootComplete` flag persists.

**Edge case within edge case:** What if stop() takes a long time?

```javascript
automator.start();  // Started at 12:00:00
// ... runs for 1 hour ...
automator.stop();   // Stopped at 13:00:00
// ... offline for 2 hours ...
automator.start();  // Started at 15:00:00
```

**Should this trigger boot mode again?**

**Arguments for YES:**
- There's a 2-hour gap (offline period)
- Could have missed events

**Arguments for NO:**
- Boot mode is "per process" (design decision 2)
- User can call `new Automator()` if they want fresh boot
- Simpler implementation

**RECOMMENDATION: NO** - stick with "once per process" semantics.

If users need boot on every start, they can:
```javascript
let automator = new Automator({ ... });
automator.start();

// Later, to "reboot":
automator.stop();
automator = new Automator({ ... }); // Fresh instance, fresh boot
automator.start();
```

### Edge Case 6: Boot Tick Takes Multiple Seconds

**Scenario:** Boot tick processing takes 3.5 seconds due to massive catch-up.

**Timeline:**
```
T=0.000s: start() called, sets lastTick=0.000, schedules tick for T=1.000
T=1.000s: Boot tick STARTS
T=4.500s: Boot tick ENDS (took 3.5 seconds)
T=4.500s: Next tick scheduled for T=5.000
T=5.000s: Second tick fires (normal operation)
```

**What happens to slots at T=2, T=3, T=4?**

**Analysis:**
- `lastTick = 0.000` when boot tick starts
- `now = 1.000` when boot tick starts (aligned to second boundary)
- Boot tick processes slots from `lastTick` to `now` (0.000 to 1.000)
- After boot tick, `lastTick = 1.000`
- Second tick at T=5.000 has `lastTick=1.000, now=5.000`
- Second tick processes slots from 1.000 to 5.000 (including 2, 3, 4)

**Slots at T=2, T=3, T=4 are NOT missed** - they're processed on the second tick.

**But:** Second tick might also take a long time if there's catch-up.

**Is this a problem?**

**For boot mode: NO** - boot mode only affects first tick. Subsequent ticks use normal catch-up logic (catchUpWindow/catchUpLimit).

**For general scheduler health: YES** - slow ticks cause cascading delays.

**Recommendation:** Document performance considerations. If boot takes too long, users should:
1. Reduce catch-up window/limit on individual tasks
2. Use fast-forward optimization (already implemented)
3. Consider archiving old tasks
4. Profile task functions (execution time)

### Edge Case 7: catchUpWindow/catchUpLimit on Boot

**Scenario:** Task has `catchUpWindow=3600000` (1 hour). During boot, task is 5 hours late.

**Question:** Should boot mode respect the task's catchUpWindow, or override it?

**Design decision:** Boot mode OVERRIDES catchUpWindow/catchUpLimit.

**Rationale:**
- Boot mode goal: "bring all tasks up to present time"
- catchUpWindow is a runtime policy (how much catch-up during normal operation)
- Boot is special: system initialization, not normal operation
- Forcing advancement ensures deterministic state

**Implementation:** Boot mode effectively sets `catchUpWindow="unlimited", catchUpLimit=0` for the boot tick.

**Wait, does current implementation do this?**

Let's check our specification above...

**In CoreEngine.step(), boot mode only suppresses execution, doesn't change window/limit.**

So currently:
- If `catchUpWindow=0` and task is 5 hours late
- Boot tick: `isWithinWindow = false` (lag > window)
- Slot is skipped (not eligible)
- Task advances through slot (via `_advanceTask()`)
- No execution (boot mode suppresses it anyway)

**This works!** Tasks advance regardless of window/limit. Boot mode just ensures no execution.

**Except:** What if `catchUpWindow=3600000` and task is 30 minutes late?

- Boot tick: `isWithinWindow = true` (30 min < 60 min)
- Slot is eligible
- Boot mode: `isBootMode=true`, so execution suppressed
- Debug event emitted: "slot-skipped: boot-mode"

**This also works!** Boot mode correctly overrides execution regardless of eligibility.

**No changes needed to specification.**

### Edge Case 8: skipExecuteOnBoot = false

**Scenario:** User explicitly sets `skipExecuteOnBoot: false`.

**Expected behavior:**
- Boot tick runs normally
- All catch-up logic applies
- Tasks execute according to catchUpWindow/catchUpLimit
- `boot-complete` event still emitted (with execution counts)
- State saved after boot

**Implementation check:**
```javascript
// SchedulerHost.start()
this.isBootTick = !this.bootComplete && skipExecuteOnBoot;
```

If `skipExecuteOnBoot=false`:
- `this.isBootTick = false`
- CoreEngine.step() receives `isBootMode=false`
- Normal execution logic applies
- Boot statistics NOT collected (bootStats=null)

**Wait, should we still emit boot-complete event?**

**Option A:** Only emit if skipExecuteOnBoot=true
**Option B:** Always emit on first tick, regardless of option

**Recommendation: Option B** - always emit boot-complete after first tick.

**Rationale:**
- Consistent API: users can always listen for boot-complete
- boot-complete signals "first tick done, scheduler fully operational"
- Stats will show actual executions if skipExecuteOnBoot=false

**Modification needed:**

```javascript
// SchedulerHost.start()
this.isFirstTick = !this.bootComplete; // Track first tick separately
this.isBootTick = !this.bootComplete && skipExecuteOnBoot; // Boot mode flag

// SchedulerHost._tick()
if (this.isFirstTick) {
  this.isFirstTick = false;
  this.isBootTick = false; // Ensure cleared
  this.bootComplete = true;

  // Emit boot-complete with stats (may show executions if skipExecuteOnBoot=false)
  this.emit('boot-complete', { ... });
  this.emit('ready');
  this.emit('boot-save-required');
}
```

**Updated Implementation Specification** needed for SchedulerHost.

---

## Testing Strategy

### Unit Tests (CoreEngine)

**Test 1: Boot mode suppresses execution events**
```javascript
test('step() with isBootMode=true suppresses task events', () => {
  const state = {
    tasks: [{
      id: 1,
      cmd: 'test',
      date: new Date('2025-01-01T12:00:00'),
      catchUpWindow: 'unlimited',
      catchUpLimit: 'all',
      repeat: null,
      count: 0
    }]
  };

  const lastTick = new Date('2025-01-01T11:59:59');
  const now = new Date('2025-01-01T12:00:01');

  const { events } = CoreEngine.step(state, lastTick, now, 10000, true);

  const taskEvents = events.filter(e => e.type === 'task');
  expect(taskEvents).toHaveLength(0); // No task events

  const debugEvents = events.filter(e => e.type === 'debug' && e.subtype === 'slot-skipped');
  expect(debugEvents.length).toBeGreaterThan(0); // Has debug events
});
```

**Test 2: Boot mode still advances tasks**
```javascript
test('step() with isBootMode=true advances task state', () => {
  const state = {
    tasks: [{
      id: 1,
      cmd: 'test',
      date: new Date('2025-01-01T12:00:00'),
      catchUpWindow: 'unlimited',
      catchUpLimit: 'all',
      repeat: { type: 'hour', interval: 1 },
      count: 0
    }]
  };

  const lastTick = new Date('2025-01-01T11:59:59');
  const now = new Date('2025-01-01T15:00:00'); // 3 hours later

  const { newState } = CoreEngine.step(state, lastTick, now, 10000, true);

  expect(newState.tasks[0].count).toBe(3); // Advanced through 3 slots
  expect(newState.tasks[0].date.getTime()).toBeGreaterThan(now.getTime()); // Next occurrence in future
});
```

**Test 3: Boot mode returns statistics**
```javascript
test('step() with isBootMode=true returns bootStats', () => {
  const state = {
    tasks: [
      { id: 1, cmd: 'test1', date: new Date('2025-01-01T11:00:00'), repeat: { type: 'hour' }, count: 0, catchUpWindow: 'unlimited', catchUpLimit: 'all' },
      { id: 2, cmd: 'test2', date: new Date('2025-01-01T10:00:00'), repeat: { type: 'hour' }, count: 0, catchUpWindow: 'unlimited', catchUpLimit: 'all' }
    ]
  };

  const lastTick = new Date('2025-01-01T09:59:59');
  const now = new Date('2025-01-01T15:00:00');

  const { bootStats } = CoreEngine.step(state, lastTick, now, 10000, true);

  expect(bootStats).not.toBeNull();
  expect(bootStats.tasksProcessed).toBe(2);
  expect(bootStats.slotsAdvanced).toBeGreaterThan(0);
  expect(bootStats.slotsSkipped).toBeGreaterThan(0);
});
```

**Test 4: Boot mode works with fast-forward**
```javascript
test('step() with isBootMode=true uses fast-forward but skips executions', () => {
  const state = {
    tasks: [{
      id: 1,
      cmd: 'test',
      date: new Date('2025-01-01T00:00:00'),
      catchUpWindow: 60000, // 1 minute
      catchUpLimit: 5,
      repeat: { type: 'second', interval: 1 },
      count: 0
    }]
  };

  const lastTick = new Date('2025-01-01T00:00:00');
  const now = new Date('2025-01-01T01:00:00'); // 1 hour later (3600 seconds)

  const { newState, events } = CoreEngine.step(state, lastTick, now, 10000, true);

  // Fast-forward should have triggered
  expect(newState.tasks[0].count).toBeGreaterThan(3500); // Most slots skipped via fast-forward

  // No task events
  const taskEvents = events.filter(e => e.type === 'task');
  expect(taskEvents).toHaveLength(0);

  // Debug event for fast-forward skip
  const ffSkip = events.find(e => e.subtype === 'fast-forward-skipped');
  expect(ffSkip).toBeDefined();
});
```

### Integration Tests (SchedulerHost)

**Test 5: Boot tick fires first, normal ticks follow**
```javascript
test('SchedulerHost boots on first tick', (done) => {
  const host = new SchedulerHost();

  let bootFired = false;
  let readyFired = false;
  let tickCount = 0;

  host.on('boot-complete', (event) => {
    bootFired = true;
    expect(readyFired).toBe(false); // boot-complete before ready
  });

  host.on('ready', () => {
    readyFired = true;
    expect(bootFired).toBe(true); // boot-complete before ready
  });

  host.on('task', () => {
    tickCount++;
    if (tickCount === 1) {
      // First task execution should happen AFTER boot
      expect(bootFired).toBe(true);
      expect(readyFired).toBe(true);
      host.stop();
      done();
    }
  });

  host.setState({
    tasks: [{
      id: 1,
      cmd: 'test',
      date: new Date(Date.now() + 2000), // 2 seconds from now
      repeat: null,
      count: 0,
      catchUpWindow: 0,
      catchUpLimit: 0
    }]
  });

  host.addFunction('test', () => {}); // No-op
  host.start({ skipExecuteOnBoot: true });
});
```

**Test 6: Boot does not fire on second start()**
```javascript
test('SchedulerHost only boots once per instance', (done) => {
  const host = new SchedulerHost();

  let bootCount = 0;

  host.on('boot-complete', () => {
    bootCount++;
  });

  host.on('ready', () => {
    if (bootCount === 1) {
      // After first boot, stop and restart
      host.stop();

      setTimeout(() => {
        host.start({ skipExecuteOnBoot: true });

        setTimeout(() => {
          expect(bootCount).toBe(1); // Still only 1 boot
          host.stop();
          done();
        }, 2000);
      }, 100);
    }
  });

  host.start({ skipExecuteOnBoot: true });
});
```

### End-to-End Tests (Automator)

**Test 7: skipExecuteOnBoot option works**
```javascript
test('Automator skipExecuteOnBoot prevents execution on boot', (done) => {
  const automator = new Automator({
    storage: new MemoryStorage(),
    skipExecuteOnBoot: true
  });

  let executionCount = 0;

  automator.addFunction('test', () => {
    executionCount++;
  });

  // Add task that's 10 seconds late
  automator.addTask({
    cmd: 'test',
    date: new Date(Date.now() - 10000),
    repeat: { type: 'second' },
    catchUpWindow: 'unlimited',
    catchUpLimit: 'all'
  });

  automator.on('boot-complete', () => {
    // After boot, no executions should have happened
    expect(executionCount).toBe(0);

    // Wait for second tick
    setTimeout(() => {
      // Second tick should execute normally
      expect(executionCount).toBeGreaterThan(0);
      automator.stop();
      done();
    }, 2000);
  });

  automator.start();
});
```

**Test 8: skipExecuteOnBoot=false allows execution**
```javascript
test('Automator skipExecuteOnBoot=false executes on boot', (done) => {
  const automator = new Automator({
    storage: new MemoryStorage(),
    skipExecuteOnBoot: false // Execute on boot
  });

  let executionCount = 0;

  automator.addFunction('test', () => {
    executionCount++;
  });

  automator.addTask({
    cmd: 'test',
    date: new Date(Date.now() - 5000), // 5 seconds late
    repeat: { type: 'second' },
    catchUpWindow: 'unlimited',
    catchUpLimit: 'all'
  });

  automator.on('boot-complete', () => {
    // After boot WITH execution, should have run tasks
    expect(executionCount).toBeGreaterThan(0);
    automator.stop();
    done();
  });

  automator.start();
});
```

**Test 9: State persistence after boot**
```javascript
test('Automator saves state after boot', (done) => {
  const storage = new MemoryStorage();
  const automator = new Automator({
    storage,
    skipExecuteOnBoot: true,
    autoSave: true
  });

  automator.addTask({
    cmd: 'test',
    date: new Date(Date.now() - 3600000), // 1 hour ago
    repeat: { type: 'minute' },
    catchUpWindow: 'unlimited',
    catchUpLimit: 0
  });

  const taskIdBefore = automator.getTasks()[0].id;
  const countBefore = automator.getTasks()[0].count;

  automator.on('boot-complete', () => {
    // Give auto-save a moment
    setTimeout(() => {
      // Load state from storage
      const savedState = storage.load();
      const savedTask = savedState.tasks.find(t => t.id === taskIdBefore);

      expect(savedTask.count).toBeGreaterThan(countBefore); // Count advanced
      expect(new Date(savedTask.date).getTime()).toBeGreaterThan(Date.now()); // Date in future

      automator.stop();
      done();
    }, 100);
  });

  automator.start();
});
```

### Regression Tests

**Test 10: Existing tests still pass**
- Run full existing test suite
- Ensure boot mode doesn't break normal operation
- Verify simulate() still works (should never use boot mode)

---

## Future Enhancements

### Enhancement 1: Tick Delay Detection

**Goal:** Emit debug events when ticks are delayed due to event loop being busy.

**Implementation:**
```javascript
// SchedulerHost
_scheduleTick() {
  const now = new Date();
  const milliseconds = now.getMilliseconds();
  const waitTime = 1000 - milliseconds;
  const expectedTickTime = new Date(now.getTime() + waitTime);
  expectedTickTime.setMilliseconds(0);

  this.expectedNextTick = expectedTickTime; // NEW: track expected

  this.timer = setTimeout(() => {
    this._tick();
  }, waitTime);
}

_tick() {
  const now = new Date();
  now.setMilliseconds(0);

  // NEW: Detect delay
  if (this.expectedNextTick && now > this.expectedNextTick) {
    const delay = now.getTime() - this.expectedNextTick.getTime();
    this.emit('debug', {
      type: 'debug',
      subtype: 'tick-delayed',
      expectedTime: this.expectedNextTick,
      actualTime: now,
      delayMs: delay,
      reason: 'event-loop-busy'
    });
  }

  // ... rest of tick logic ...
}
```

**Benefit:** Users can diagnose performance issues.

### Enhancement 2: Comprehensive Skip Event Instrumentation

**Goal:** Emit debug events for ALL types of slot skipping.

**Implementation:** Add debug events in CoreEngine.step() for:
- Slots outside catchUpWindow
- Slots excluded by catchUpLimit
- Slots skipped due to real-time mode (catchUpLimit=0)
- Slots skipped during boot mode

**Example:**
```javascript
// In catch-up loop
if (isWithinWindow) {
  // Eligible
  if (catchUpLimit === 0) {
    events.push({
      type: 'debug',
      subtype: 'slot-skipped',
      reason: isBootMode ? 'boot-mode' : 'real-time-mode',
      taskId: task.id,
      scheduledTime: currentNextRun,
      lag: lag
    });
  }
} else {
  // Not eligible
  events.push({
    type: 'debug',
    subtype: 'slot-skipped',
    reason: 'outside-catchup-window',
    taskId: task.id,
    scheduledTime: currentNextRun,
    lag: lag,
    catchUpWindow: catchUpWindow
  });
}
```

**Configuration:**
```javascript
const automator = new Automator({
  debugSkippedSlots: false // Default false (too verbose)
});
```

**Benefit:** Deep debugging of scheduler behavior.

### Enhancement 3: Boot Performance Metrics

**Goal:** Provide detailed timing breakdown of boot process.

**Implementation:**
```javascript
// In SchedulerHost._tick()
if (this.isFirstTick) {
  const bootMetrics = {
    loadStateMs: /* track in _loadState() */,
    catchUpMs: /* track in step() */,
    saveStateMs: /* track in _saveState() */,
    totalBootMs: /* end-to-end */
  };

  this.emit('boot-complete', {
    type: 'boot-complete',
    stats: bootStats,
    metrics: bootMetrics
  });
}
```

**Benefit:** Users can optimize boot performance.

### Enhancement 4: Per-Task Boot Behavior

**Goal:** Allow individual tasks to opt-in to execution during boot.

**API:**
```javascript
automator.addTask({
  cmd: 'initialize-system',
  date: new Date(),
  executeOnBoot: true, // NEW: run this task even during boot
  repeat: null
});
```

**Use case:** Some tasks (like "initialize-system") should run on boot, while others shouldn't.

**Implementation:** Check `task.executeOnBoot` flag in CoreEngine.step() boot mode logic.

**Complexity:** Medium - requires per-task boot logic.

### Enhancement 5: Boot Replay Log

**Goal:** Log all skipped slots during boot for audit purposes.

**Implementation:**
```javascript
automator.on('boot-complete', (event) => {
  console.log('Boot complete:', event.stats);

  // Optionally request boot replay log
  const replayLog = automator.getBootReplayLog();
  // Returns array of all slots that would have executed
  console.log('Skipped slots:', replayLog);
});
```

**Use case:** Debugging, compliance, auditing.

**Complexity:** High - requires buffering all skipped events during boot.

---

## Open Questions

### Question 1: Should boot mode be configurable per-task?

**Current design:** Global `skipExecuteOnBoot` option applies to all tasks.

**Alternative:** Per-task `executeOnBoot` flag.

**Trade-offs:**
- Global: Simple, consistent, easy to understand
- Per-task: Flexible, handles "initialization tasks" that should run on boot

**Recommendation:** Start with global option. Add per-task flag in future if needed.

### Question 2: Should ready event timing be configurable?

**Current design:** `ready` fires after boot completes (breaking change).

**Alternative:** Add `emitReadyAfterBoot: true` option.

**Trade-offs:**
- Breaking change: Existing code may rely on immediate `ready`
- Opt-in: Adds complexity, most users won't understand difference
- Two-event system: Emit both `ready` (immediate) and `boot-complete` (delayed)

**Recommendation:** Breaking change is acceptable. Document in migration guide. If users complain, add option later.

### Question 3: Should boot statistics be more detailed?

**Current design:**
```javascript
{
  tasksProcessed: 10,
  slotsAdvanced: 1234,
  slotsSkipped: 1234,
  duration: 45
}
```

**Possible additions:**
- Per-task breakdown (which tasks advanced how many slots)
- Memory usage before/after
- Execution count (if skipExecuteOnBoot=false)
- Error count during boot

**Recommendation:** Start simple. Add detail in future if users request it.

### Question 4: Should boot mode affect simulate()?

**Current design:** `simulate()` never uses boot mode (always `isBootMode=false`).

**Rationale:** Simulation is for preview/analysis, not system initialization.

**Alternative:** Add `includeBootSimulation` option to `simulateRange()`.

**Use case:** User wants to see what WOULD happen during boot.

**Recommendation:** Keep current design. Simulation is separate concern.

### Question 5: What if boot takes longer than the tick interval?

**Scenario:** Boot tick starts at T=1s, finishes at T=4s.

**Current behavior:** Next tick scheduled for T=5s (processes T=1 to T=5).

**Alternative:** Immediately fire "catch-up tick" to process T=1 to T=4.

**Trade-offs:**
- Current: Simple, leverages existing catch-up logic
- Alternative: Faster recovery, but more complex tick scheduling

**Recommendation:** Keep current design. If boot is very slow, users should optimize tasks or reduce catch-up windows.

### Question 6: Should there be a maximum boot duration warning?

**Example:**
```javascript
if (bootDuration > 10000) { // 10 seconds
  this.emit('warning', {
    type: 'warning',
    message: 'Boot took longer than 10 seconds - consider reducing catch-up windows',
    bootDuration
  });
}
```

**Recommendation:** Yes, add this. Helps users diagnose performance issues.

---

## Summary

This design document proposes implementing boot mode with the following characteristics:

**Core Design:**
- First tick after process start is "boot tick"
- Boot tick advances all tasks to present time
- Boot tick suppresses task execution (if `skipExecuteOnBoot=true`)
- Boot tick emits `boot-complete` event with statistics
- `ready` event fires AFTER boot completes (breaking change)
- State saved immediately after boot
- Boot happens once per process lifetime

**Options:**
- `skipExecuteOnBoot: true` (default) - Skip execution during boot
- `skipExecuteOnBoot: false` - Execute normally during boot

**Events:**
- `boot-complete` - Emitted after first tick, includes statistics
- `ready` - Emitted after boot complete (timing change)
- `debug` - Emitted for skipped slots during boot (if enabled)

**Implementation:**
- 3 files modified: SchedulerHost.js, CoreEngine.js, Automator.js
- ~200 lines of new code
- ~50 lines of modified code
- Extensive test coverage required

**Future Work:**
- Tick delay detection
- Comprehensive skip event instrumentation
- Per-task boot behavior
- Boot performance metrics
- Boot replay log

---

## Next Steps

1. **Review this design document** - Discuss open questions and design decisions
2. **Finalize API** - Confirm option names, event formats, timing behavior
3. **Write tests** - TDD approach, write tests before implementation
4. **Implement in phases** - Core functionality first, enhancements later
5. **Document migration** - Clear migration guide for breaking changes (ready event timing)
6. **Update architecture docs** - Add boot mode to ARCHITECTURE.md

---

**End of Design Document**
