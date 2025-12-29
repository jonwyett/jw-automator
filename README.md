# **jw-automator v6**

### A resilient, local-time, 1-second precision automation scheduler for Node.js

**Human-friendly recurrence rules. Offline catch-up. DST-safe. Predictable. Extensible.**

---

## Overview

**jw-automator** is a robust automation engine designed for small devices, home automation hubs, personal servers, and Node.js environments where **correctness, resilience, and local-time behavior** matter more than millisecond precision. Version 6 introduces result-based error handling with structured error codes, making it ideal for web interfaces and ensuring the scheduler never crashes your application.

Where traditional cron falls short — missed executions, poor DST handling, limited recurrence, lack of catch-up semantics — **jw-automator** provides a predictable, human-centric scheduling model:

* **1-second granularity** with zero drift
* **Local calendar semantics** (weekday/weekend, monthly, yearly)
* **Configurable DST policies** (fall-back once/twice)
* **Offline resiliency & catch-up logic**
* **Buffered/unBuffered execution policies**
* **Rich introspection and event lifecycle**
* **Meta-tasks** that can dynamically create/update other tasks
* **Pluggable persistence** (file, memory, custom storage)
* **Deterministic step engine** suitable for simulation/testing

This makes jw-automator ideal for:

* Small Raspberry Pi home automation hubs
* IoT applications
* Sensor sampling / periodic readings
* Daily/weekly routines
* "Smart home" orchestrations
* Systems that must *survive restarts, reboots, offline gaps, and DST transitions*

jw-automator v3 is a **clean-room re-architecture** of the original library, keeping its best ideas while formalizing its semantics, improving correctness, and providing a crisp developer experience.

---

## Quick Start

### Installation

```bash
npm install jw-automator
```

### Basic Usage

```js
const Automator = require('jw-automator');

// Create an automator with file-based persistence
const automator = new Automator({
  storage: Automator.storage.file('./tasks.json')
});

// Register a command function
automator.addFunction('turnLightOn', function(payload) {
  console.log('Turning light on');
});

// Seed initial tasks (runs only on first use)
automator.seed((auto) => {
  auto.addTask({
    name: 'Morning Lights',
    cmd: 'turnLightOn',
    date: new Date('2025-05-01T07:00:00'),
    payload: null,
    catchUpMode: 'default', // Use default catch-up behavior
    repeat: {
      type: 'day',
      interval: 1,
      limit: null,
      endDate: null,
      dstPolicy: 'once'
    }
  });
});

// Start the scheduler
automator.start();
```

---

## Features

### 1. **True 1-Second Precision**

* Scheduler tick interval is fixed at **1 second**.
* Execution times are aligned to the nearest whole second.
* No promise of sub-second timing (by design).
* Ideal for low-power hardware prone to event-loop delays.

> **Why?**
> A scheduler that *promises less* is dramatically more reliable.

---

### 2. **Human-Friendly Recurrence Rules**

Each task can specify a recurrence like:

```js
repeat: {
  type: 'weekday',      // or: second, minute, hour, day, week,
                        //      month, year, weekend
  interval: 1,          // every N occurrences
  limit: null,          // optional max count
  endDate: null,        // optional cutoff date
  dstPolicy: 'once',    // or 'twice'
}
```

Examples:

* Every day at 7:00 AM
* Every 15 minutes
* Every weekend at 10:00
* Every month on the 1st
* Every weekday at market open
* Once per second for 5 minutes (limit-based)

---

### 3. **Local-Time First, DST-Aware**

jw-automator's recurrence rules operate in **local wall-clock time**, not UTC.

This means:

* "7:00 AM" always means **local** 7:00 AM.
* Weekdays/weekends follow the user's locale.
* DST transitions are **explicit and predictable**:

  * **Spring forward:** missing hour handled via buffered/unBuffered rules
  * **Fall back:** user chooses `dstPolicy: 'once' | 'twice'`

This avoids cron's silent-but-surprising behaviors.

---

### 4. **Resilient Catch-Up with `catchUpMode`**

By default, `jw-automator` is resilient to minor event loop delays and jitter. This is managed through a simple `catchUpMode` property on each task, which makes behavior predictable without needing to configure complex settings.

**`catchUpMode` (The Easy Way)**

This is the recommended way to control catch-up behavior.

*   `catchUpMode: 'default'` (System-wide default)
    *   **Behavior:** Provides a small buffer for tasks to recover from brief delays. If a task is missed by a few moments, it will run. If it's missed by a long time (e.g., the system was off), it will be skipped.
    *   **Implementation:** Sets `catchUpWindow: 500` (milliseconds) and `catchUpLimit: 1`.
    *   **Use Case:** The best setting for most tasks. It prevents tasks from being skipped due to normal system fluctuations.

*   `catchUpMode: 'realtime'`
    *   **Behavior:** The task will only run if the scheduler ticks at its exact scheduled second. If the event loop is busy and the moment is missed, the task is skipped.
    *   **Implementation:** Sets `catchUpWindow: 0` and `catchUpLimit: 0`.
    *   **Use Case:** For tasks where executing late is worse than not executing at all.

You can also set a system-wide default in the constructor:
```js
const automator = new Automator({
  defaultCatchUpMode: 'realtime' // Make all tasks realtime by default
});
```

**`catchUpWindow` (The Advanced Way)**

For more advanced control, you can bypass `catchUpMode` and set `catchUpWindow` directly. An explicit `catchUpWindow` value on a task will always take precedence.

*   `catchUpWindow: 0`: Skip ALL missed executions (same as `catchUpMode: 'realtime'`).
*   `catchUpWindow: 5000`: Catch up if missed by ≤5 seconds, skip if older.
*   `catchUpWindow: "unlimited"`: Catch up ALL missed executions.

**Backwards compatibility:**

The legacy `unBuffered` property is still supported and maps directly to `catchUpWindow` behavior:
*   `unBuffered: false` is equivalent to `catchUpWindow: "unlimited"`
*   `unBuffered: true` is equivalent to `catchUpWindow: 0`

---

### 5. **Deterministic "Step Engine"**

The heart of jw-automator is a pure scheduling primitive:

```
step(state, lastTick, now) → { newState, events }
```

This powers:

* Real-time ticking
* Offline catch-up
* Future schedule simulation
* Testing
* Meta-scheduling (tasks that schedule other tasks)

Because `step` is deterministic, you can:

* Test schedules without time passing
* Generate "what would happen tomorrow"
* Debug recurrence rules
* Build custom visual schedulers

---

### 6. **Meta-Tasks (Tasks that Create Tasks)**

jw-automator treats tasks as **data**, enabling higher-order patterns:

* A daily 7:00 AM task can spawn a sequence of 60 one-per-second tasks.
* A monthly billing task can create daily reminder tasks.
* A multi-step animation (e.g., dimming a light) can create timed sub-tasks.

Tasks have a `repeat.count` that can be pre-set or manipulated intentionally.

This makes jw-automator more like a *mini automation runtime* than just a cron clone.

---

## API Reference

### Constructor

```js
new Automator(options)
```

Options:
* `storage` - Storage adapter (default: memory)
* `autoSave` - Auto-save state (default: true)
* `saveInterval` - Save interval in ms (default: 5000)
* `defaultCatchUpMode` - The default catch-up behavior for all tasks (`'default'` or `'realtime'`). Defaults to `'default'`.

### Methods

#### `seed(callback)`
Seed the automator with initial tasks. Runs only when the database is empty (first use).

**Returns:** Result object with `{ success: true, seeded: boolean }` or `{ success: false, error: string, code: string }`

```js
const result = automator.seed((auto) => {
  auto.addTask({
    name: 'Daily Report',
    cmd: 'generateReport',
    date: new Date('2025-01-01T09:00:00'),
    catchUpWindow: "unlimited",
    repeat: { type: 'day', interval: 1 }
  });
});

if (result.success && result.seeded) {
  console.log('Database seeded successfully');
} else if (result.success) {
  console.log('Database already populated - seeding skipped');
} else {
  console.error('Seed failed:', result.error);
}
```

**Why use seed()?**

* Solves the bootstrapping problem: safely initialize tasks without resetting the schedule on every restart
* Preserves user-modified schedules perfectly
* Runs initialization logic only once in the application lifecycle
* Automatically saves state after seeding

#### `start()`
Start the scheduler.

#### `stop()`
Stop the scheduler and save state.

#### `addFunction(name, fn)`
Register a command function.

```js
automator.addFunction('myCommand', function(payload, event) {
  console.log('Executing command with payload:', payload);
});
```

#### `addTask(taskSpec)`
Add a new task.

**Returns:** Result object with `{ success: true, id: number }` or `{ success: false, error: string, code: string }`

```js
const result = automator.addTask({
  name: 'My Task',
  cmd: 'myCommand',
  date: new Date('2025-05-01T10:00:00'),
  payload: { data: 'value' },
  catchUpMode: 'default',
  repeat: {
    type: 'hour',
    interval: 2,
    limit: 10,
    dstPolicy: 'once'
  }
});

if (result.success) {
  console.log('Task added with ID:', result.id);
} else {
  console.error('Failed to add task:', result.error);
}
```

#### `updateTaskByID(id, updates)`
Update an existing task.

**Returns:** Result object with `{ success: true, id: number, task: object }` or `{ success: false, error: string, code: string }`

```js
const result = automator.updateTaskByID(1, {
  name: 'Updated Name',
  repeat: { type: 'day', interval: 1 }
});

if (result.success) {
  console.log('Task updated:', result.id);
} else {
  console.error('Failed to update task:', result.error);
}
```

#### `updateTaskByName(name, updates)`
Update all tasks with the given name.

**Returns:** Result object with `{ success: true, count: number }` or `{ success: false, error: string, code: string }`

```js
const result = automator.updateTaskByName('My Task', {
  payload: { newData: 'newValue' }
});

if (result.success) {
  console.log(`Updated ${result.count} task(s)`);
} else {
  console.error('Failed to update tasks:', result.error);
}
```

#### `removeTaskByID(id)`
Remove a task by ID.

**Returns:** Result object with `{ success: true, id: number, task: object }` or `{ success: false, error: string, code: string }`

```js
const result = automator.removeTaskByID(1);

if (result.success) {
  console.log('Task removed:', result.id);
} else {
  console.error('Failed to remove task:', result.error);
}
```

#### `removeTaskByName(name)`
Remove all tasks with the given name.

**Returns:** Result object with `{ success: true, count: number }` or `{ success: false, error: string, code: string }`

```js
const result = automator.removeTaskByName('My Task');

if (result.success) {
  console.log(`Removed ${result.count} task(s)`);
} else {
  console.error('Failed to remove tasks:', result.error);
}
```

#### `getTasks()`
Get all tasks (deep copy).

#### `getTasksByName(name)`
Get tasks by name.

#### `getTaskByID(id)`
Get a specific task by ID.

#### `getTasksInRange(startDate, endDate, callback)`
Simulate tasks in a time range.

```js
const events = automator.getTasksInRange(
  new Date('2025-05-01'),
  new Date('2025-05-07')
);

console.log(events); // Array of scheduled events
```

#### `describeTask(id)`
Get a human-readable description of a task.

### Events

Listen to events using `automator.on(event, callback)`:

* `ready` - Scheduler started
* `task` - Task executed
* `update` - Task added/updated/removed
* `error` - Error occurred
* `warning` - Non-fatal data coercion or correction occurred
* `debug` - Debug information

```js
automator.on('task', (event) => {
  console.log('Task executed:', event.name);
  console.log('Scheduled:', event.scheduledTime);
  console.log('Actual:', event.actualTime);
});
```

---

## Error Handling (v6.0+)

Starting with v6.0, all CRUD methods return **result objects** instead of throwing errors. This design ensures:

1. **Never crashes your application** - No exceptions thrown for validation errors
2. **Synchronous error reporting** - Get immediate feedback for web interface integration
3. **Structured error codes** - Enable programmatic error handling
4. **Predictable behavior** - All methods follow the same pattern

### Result Object Pattern

All mutation methods (`addTask`, `updateTaskByID`, `updateTaskByName`, `removeTaskByID`, `removeTaskByName`, `seed`) return a result object:

#### Success Response

```js
const result = automator.addTask({
  cmd: 'myCommand',
  date: new Date()
});

// Success structure:
// {
//   success: true,
//   id: 1              // for addTask, updateTaskByID, removeTaskByID
//   count: 2,          // for updateTaskByName, removeTaskByName
//   seeded: true,      // for seed()
//   task: {...}        // optional - the task object
// }

if (result.success) {
  console.log('Task added with ID:', result.id);
}
```

#### Error Response

```js
const result = automator.addTask({
  name: 'Invalid Task'
  // Missing required 'cmd' property
});

// Error structure:
// {
//   success: false,
//   error: "Task must have a cmd property",
//   code: "MISSING_CMD",
//   field: "cmd"       // optional - which field caused the error
// }

if (!result.success) {
  console.error(`Error: ${result.error} (${result.code})`);
}
```

### Error Codes Reference

| Code | Description | Affected Methods |
|------|-------------|------------------|
| `MISSING_CMD` | Required `cmd` property missing | `addTask` |
| `INVALID_REPEAT_TYPE` | Invalid or missing `repeat.type` | `addTask`, `updateTaskByID`, `updateTaskByName` |
| `INVALID_CATCHUP_WINDOW` | Invalid `catchUpWindow` value | `addTask`, `updateTaskByID`, `updateTaskByName` |
| `INVALID_CATCHUP_LIMIT` | Invalid `catchUpLimit` value | `addTask`, `updateTaskByID`, `updateTaskByName` |
| `TASK_NOT_FOUND` | Task ID not found | `updateTaskByID`, `removeTaskByID` |
| `NO_TASKS_FOUND` | No tasks with given name | `removeTaskByName` |
| `INVALID_CALLBACK` | Callback is not a function | `seed` |

### Web Interface Integration Example

The result object pattern makes it easy to integrate with web APIs:

```js
const express = require('express');
const app = express();

// Add task endpoint
app.post('/api/tasks', (req, res) => {
  const result = automator.addTask(req.body);

  if (result.success) {
    res.json({
      message: 'Task created successfully',
      taskId: result.id
    });
  } else {
    res.status(400).json({
      error: result.error,
      code: result.code,
      field: result.field // helpful for form validation
    });
  }
});

// Update task endpoint
app.put('/api/tasks/:id', (req, res) => {
  const result = automator.updateTaskByID(
    parseInt(req.params.id),
    req.body
  );

  if (result.success) {
    res.json({
      message: 'Task updated successfully',
      task: result.task
    });
  } else {
    const status = result.code === 'TASK_NOT_FOUND' ? 404 : 400;
    res.status(status).json({
      error: result.error,
      code: result.code
    });
  }
});

// Delete task endpoint
app.delete('/api/tasks/:id', (req, res) => {
  const result = automator.removeTaskByID(parseInt(req.params.id));

  if (result.success) {
    res.json({
      message: 'Task deleted successfully',
      taskId: result.id
    });
  } else {
    res.status(404).json({
      error: result.error,
      code: result.code
    });
  }
});
```

### Validation Rules

The following validation rules apply:

**Fatal Errors** (return error result):
- Missing `cmd` property
- Invalid `repeat.type` (must be: second, minute, hour, day, weekday, weekend, week, month, year)
- Invalid `catchUpWindow` (must be "unlimited" or non-negative number)
- Invalid `catchUpLimit` (must be "all" or non-negative integer)
- Task not found (for update/remove by ID)

**Defensive Coercions** (emit warnings but allow task):
- Invalid `repeat.interval` → coerced to valid integer (minimum 1)
- Invalid `repeat.limit` → coerced to `null` (unlimited)
- Invalid `repeat.endDate` → coerced to `null`
- Invalid `repeat.dstPolicy` → coerced to `'once'`
- Missing `date` → defaults to 5 seconds in future

**Silent Defaults** (emit debug):
- Missing `catchUpWindow` → smart default based on task type
- Missing `repeat.interval` → defaults to 1

### Event-Based Error Monitoring

In addition to returning result objects, the automator still emits error events for logging and monitoring:

```js
automator.on('error', (event) => {
  console.error('Validation error:', event.message);
  console.error('Error code:', event.code);

  // Log to external monitoring service
  if (event.type === 'validation_error') {
    logToMonitoring({
      level: 'error',
      code: event.code,
      message: event.message
    });
  }
});

automator.on('warning', (event) => {
  console.warn('Data coercion:', event.message);
});
```

### Migration from v5.x

**Before (v5.x - throwing exceptions):**
```js
try {
  const id = automator.addTask({ cmd: 'test' });
  console.log('Task added:', id);
} catch (error) {
  console.error('Failed:', error.message);
}
```

**After (v6.0 - result objects):**
```js
const result = automator.addTask({ cmd: 'test' });

if (result.success) {
  console.log('Task added:', result.id);
} else {
  console.error('Failed:', result.error);
}
```

---

### Storage Options

#### File-Based Persistence

```js
const automator = new Automator({
  storageFile: './tasks.json',
  autoSave: true,        // default: true
  saveInterval: 15000    // default: 15000ms (15 seconds)
});
```

**Moratorium-Based Persistence:**
- **CRUD operations** (add/update/remove tasks) save immediately and start a moratorium period
- **Task execution** (state progression) marks state as dirty and saves if moratorium has expired
- If moratorium is active, dirty state waits until moratorium ends, then saves automatically
- `saveInterval` sets the moratorium period - the minimum cooling time between saves (default: 15s)
- `stop()` always saves immediately if dirty, ignoring any active moratorium

This moratorium-based approach minimizes disk writes from frequent task execution (important for SD cards/flash media) while ensuring CRUD changes are always persisted immediately.

#### Memory-Only Mode

```js
const automator = new Automator({
  // No storageFile = memory-only mode (no persistence)
});
```

State exists only in memory and is lost when the process ends.

#### Custom Storage (Database, Cloud, etc.)

For custom persistence needs, use `getTasks()` and event listeners:

```js
const automator = new Automator(); // Memory-only, no file

// Load from custom source on initialization
automator.seed(async (auto) => {
  const tasks = await loadFromDatabase();
  tasks.forEach(task => auto.addTask(task));
});

// Save on updates
automator.on('update', async () => {
  const tasks = automator.getTasks();
  await saveToDatabase(tasks);
});
```

---

## Example: Sensor Reading Every Second

```js
automator.addTask({
  name: 'TempSensor',
  cmd: 'readTemp',
  date: null,            // run immediately
  payload: null,
  catchUpMode: 'default',
  repeat: {
    type: 'second',
    interval: 1
  }
});
```

If the system stalls:

* At 00:00:00 → reading #1
* Heavy load → no ticks for 5 seconds
* At 00:00:06 → automator triggers readings #2–#6, advancing schedule

Your "60 readings per minute" pattern is preserved logically.

---

## DST Behavior Examples

### Fall Back (Repeated Hour)

07:30 happens twice:

```
1) 07:30 (DST)
2) 07:30 (Standard)
```

User chooses:

* `dstPolicy: 'twice'` → run both
* `dstPolicy: 'once'` → run only the first instance

### Spring Forward (Missing Hour)

02:30 does not exist.

* Buffered → run as soon as possible after the jump
* Unbuffered → skip silently

---

## Testing

```bash
npm test
npm run test:coverage
```

---

## Task Specification

### Top-level task fields:

| Field           | Description                                                           |
| --------------- | --------------------------------------------------------------------- |
| `id`            | Unique internal identifier (auto-generated)                          |
| `name`          | User label (optional)                                                |
| `cmd`           | Name of registered function to execute                               |
| `payload`       | Data passed to the command                                           |
| `date`          | Next scheduled run time (local `Date`)                               |
| `catchUpMode`   | Sets catch-up behavior ('default', 'realtime'). Overridden by explicit `catchUpWindow`. |
| `catchUpWindow` | Time window for catching up missed executions (in milliseconds).      |
| `catchUpLimit`  | Max number of missed executions to run (e.g., 1, or 'all').           |


### Repeat block:

| Field       | Description                       |
| ----------- | --------------------------------- |
| `type`      | Recurrence unit                   |
| `interval`  | Nth occurrence                    |
| `limit`     | Number of times to run, or `null` |
| `endDate`   | Max date, or `null`               |
| `count`     | Execution counter (internal)      |
| `dstPolicy` | `'once'` or `'twice'`             |

---

## Project Goals (v6)

* Deterministic behavior
* Rock-solid DST handling
* Predictable local-time recurrence
* Resilience to offline and delays
* Developer-friendly ergonomics
* Suitable for small devices
* Approachable but powerful API
* Long-term maintainability
* Never crash applications (result-based error handling)
* Web interface friendly (synchronous, structured error feedback)

---

## License

MIT

---

## Acknowledgments

jw-automator v6 builds on the solid foundations of previous versions, adding result-based error handling to ensure stability and web interface compatibility while preserving the spirit of predictable, human-friendly scheduling.

If you're building automation logic and want predictable, human-friendly scheduling that survives the real world — **welcome.**
