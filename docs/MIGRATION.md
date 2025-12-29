# Migration Guide

## v5.0.0 - Storage API Simplification & Moratorium-Based Persistence

### Breaking Change: Storage API Simplified

The pluggable storage adapter pattern has been removed in favor of a simpler direct configuration.

**Old API (v4):**
```javascript
const automator = new Automator({
  storage: Automator.storage.file('./tasks.json')
});

const automator = new Automator({
  storage: Automator.storage.memory()
});
```

**New API (v5):**
```javascript
// File storage
const automator = new Automator({
  storageFile: './tasks.json'
});

// Memory-only mode
const automator = new Automator({
  // No storageFile option = memory-only
});
```

### New: Moratorium-Based Persistence

v5 introduces a moratorium-based persistence state machine that reduces disk wear:

- **CRUD operations** (add/update/remove) save immediately and start a moratorium period
- **Task execution** (state progression) marks state as dirty and saves if moratorium has expired
- If moratorium is active, dirty state waits until moratorium ends, then saves automatically
- **Default `saveInterval`** changed from 5000ms to **15000ms (15 seconds)**
- `saveInterval` now defines the moratorium period (minimum cooling time between saves)
- `stop()` always saves immediately if dirty, ignoring any active moratorium

**Why this matters:** Reduces disk writes from task execution (critical for SD cards/flash media) while ensuring CRUD changes are persisted immediately. The moratorium-based approach eliminates wasteful periodic polling.

### Changes Required

1. **File storage:** Replace `storage: Automator.storage.file(path)` with `storageFile: path`
2. **Memory storage:** Remove `storage: Automator.storage.memory()` entirely (omit `storageFile`)
3. **Custom storage adapters:** No longer supported via plug-in interface
4. **`saveInterval` default:** Changed from 5000ms to 15000ms (update if you relied on the old default)

### Custom Storage Migration

If you were using custom storage adapters, use this pattern instead:

```javascript
const automator = new Automator(); // Memory-only

// Load from custom source on initialization
automator.seed(async (auto) => {
  const tasks = await yourCustomLoad();
  tasks.forEach(task => auto.addTask(task));
});

// Save on updates
automator.on('update', async () => {
  const tasks = automator.getTasks();
  await yourCustomSave(tasks);
});
```

### Removed

- `Automator.storage.file()` static method
- `Automator.storage.memory()` static method
- `FileStorage` class (integrated into Automator)
- `MemoryStorage` class (no longer needed)
- Custom storage adapter interface (`{ load(), save() }`)

---

# Migration Guide: v3 to v4

This guide helps you migrate from jw-automator v3 to v4.

---

## Overview

jw-automator v4 is a significant refinement of v3's architecture, focusing on making the scheduler's behavior even more predictable and robust out-of-the-box. While v3 represented a complete rewrite, v4 introduces breaking changes by refining default behaviors and error handling for task specifications.

v3 was the widely-deployed production version. v4 builds upon that foundation with enhanced predictability.

---

## Breaking Changes from v3 to v4

### 1. Default `catchUpWindow` Behavior Changed

**v3:** If `catchUpWindow` was not specified, it defaulted to `"unlimited"` (catch up all missed executions).
**v4:** If `catchUpWindow` is not specified, it now uses a **smart default** based on the task type:
-   For **recurring tasks**, it defaults to the **duration of the recurrence interval** (e.g., an hourly task gets a 1-hour `catchUpWindow`).
-   For **one-time tasks**, it defaults to **`0`** (skip all missed executions).

**Impact:** User applications that relied on the implicit "unlimited" catch-up for all tasks in v3 might now see tasks being skipped or fast-forwarded more aggressively. If you desire the old "unlimited" catch-up, you must explicitly set `catchUpWindow: "unlimited"`.

### 2. Invalid `repeat.type` Throws a Fatal Error

**v3:** If `repeat.type` was missing or invalid (e.g., a typo like `'horu'`), Automator would defensively coerce it to `'day'` and emit an `error` event.
**v4:** An invalid or missing `repeat.type` now throws a hard `Error` immediately.

**Impact:** Code that previously succeeded by silently allowing `repeat.type` coercions will now fail fast, forcing explicit correction. This ensures that the task's intent is never misinterpreted.

### 3. Coercion Events Changed from `error` to `warning`

**v3:** Non-fatal defensive coercions (e.g., an invalid `repeat.interval` being set to `1`, a negative `catchUpWindow` becoming `0`) would emit an `error` event.
**v4:** These same non-fatal coercions now emit a `warning` event. The `error` event is reserved for more critical issues (e.g., storage failures).

**Impact:** If your application was listening for `automator.on('error', ...)` to catch these coercion notifications, you must now update your event listener to `automator.on('warning', ...)` to continue receiving them.

### 4. API Method Names Changed (action → task)

**v3:** Methods used "action" terminology: `addAction`, `updateActionByID`, `getActions`, etc.
**v4:** All methods now use "task" terminology: `addTask`, `updateTaskByID`, `getTasks`, etc.

**Impact:** All API calls need to be updated to use the new method names.

### 5. Event Name Changed

**v3:** Task execution emitted an `'action'` event.
**v4:** Task execution now emits a `'task'` event.

**Impact:** Update event listeners from `automator.on('action', ...)` to `automator.on('task', ...)`.

### 6. Event Object Properties Changed

**v3:** Event objects contained `actionId` and `action` properties.
**v4:** Event objects now contain `taskId` and `task` properties.

**Impact:** Update code that accesses these properties in event handlers.

### 7. State Structure Changed

**v3:** State contained an `actions` array.
**v4:** State now contains a `tasks` array.

**Impact:** Custom storage adapters need to return `{ tasks: [...] }` instead of `{ actions: [...] }`. Existing stored state files need migration.

---

## Breaking Changes from v2 to v3

### 1. Constructor and Initialization

**v2:**
```javascript
const automator = require('jw-automator');
automator.init({ file: './tasks.json' });
```

**v3:**
```javascript
const Automator = require('jw-automator');
const automator = new Automator({
  storage: Automator.storage.file('./tasks.json')
});
```

### 2. Task Structure

**v2:**
Task structure was less formalized.

**v3:**
```javascript
{
  id: 1,              // Auto-generated
  name: 'My Task',    // Optional
  cmd: 'commandName', // Required
  payload: {},        // Optional
  date: Date,         // Required (or null for immediate)
  unBuffered: false,  // Default false
  repeat: {           // Optional
    type: 'day',
    interval: 1,
    limit: null,
    endDate: null,
    dstPolicy: 'once' // NEW in v3
  },
  count: 0           // Execution counter
}
```

### 3. DST Policy

**v2:**
DST behavior was implicit and sometimes unpredictable.

**v3:**
Explicit DST policy for fall-back scenarios:
```javascript
repeat: {
  type: 'hour',
  interval: 1,
  dstPolicy: 'once'  // or 'twice'
}
```

### 4. Event Names

**v2:**
Various event names.

**v3:**
Standardized events:
- `ready` - Scheduler started
- `task` - Task executed
- `update` - Task added/updated/removed
- `error` - Error occurred
- `debug` - Debug information

### 5. API Methods

#### Adding Tasks

**v2:**
```javascript
automator.addTask(taskObject);
```

**v3:**
```javascript
const id = automator.addTask(taskSpec);
// Returns the task ID
```

#### Getting Tasks

**v2:**
```javascript
const tasks = automator.getTasks();
```

**v3:**
```javascript
const tasks = automator.getTasks(); // Deep copy
const task = automator.getTaskByID(id);
const tasks = automator.getTasksByName('name');
```

#### Removing Tasks

**v2:**
```javascript
automator.removeTask(id);
```

**v3:**
```javascript
automator.removeTaskByID(id);
automator.removeTaskByName('name'); // Returns count removed
```

#### Updating Tasks

**v2:**
Limited update capability.

**v3:**
```javascript
automator.updateTaskByID(id, {
  name: 'New Name',
  repeat: { type: 'hour', interval: 2 }
});

automator.updateTaskByName('Old Name', {
  name: 'New Name'
});
```

---

## New Features in v4

### 1. Smart `catchUpWindow` Defaults

The new intelligent default system for `catchUpWindow` means that for most tasks, you no longer need to explicitly define this property to get predictable, sensible behavior. It automatically adapts based on whether your task is one-time or recurring.

### 2. Dedicated `warning` Event

A new `warning` event (`automator.on('warning', ...)`) provides a clearer channel for non-fatal feedback about defensive coercions. This allows developers to distinguish between critical runtime errors and minor data corrections.

### 3. Cleaner "Task" Terminology

The rename from "action" to "task" provides clearer, more intuitive naming throughout the API.

---

## New Features in v3

### 1. Simulation

Preview future schedules without running them:

```javascript
const events = automator.getTasksInRange(
  new Date('2025-05-01'),
  new Date('2025-05-07')
);

console.log(`${events.length} events will occur`);
```

### 2. Pluggable Storage

Choose or create storage backends:

```javascript
// Memory storage (no persistence)
const automator = new Automator({
  storage: Automator.storage.memory()
});

// File storage
const automator = new Automator({
  storage: Automator.storage.file('./tasks.json')
});

// Custom storage
const automator = new Automator({
  storage: {
    load: () => { /* load from DB */ },
    save: (state) => { /* save to DB */ }
  }
});
```

### 3. Task Description

Human-readable task summaries:

```javascript
console.log(automator.describeTask(1));
// Task #1 - Morning Lights
//   Command: turnLightOn
//   Next run: 5/1/2025, 7:00:00 AM
//   Executions: 15
//   Buffered: true
//   Recurrence: day
//   DST policy: once
```

### 4. Better Event Payloads

Task events include rich metadata:

```javascript
automator.on('task', (event) => {
  console.log(event);
  // {
  //   type: 'task',
  //   taskId: 1,
  //   name: 'My Task',
  //   cmd: 'myCmd',
  //   payload: {},
  //   scheduledTime: Date,
  //   actualTime: Date,
  //   count: 5
  // }
});
```

### 5. Auto-Save Control

Fine-tune persistence:

```javascript
const automator = new Automator({
  storage: Automator.storage.file('./tasks.json'),
  autoSave: true,
  saveInterval: 10000 // Save every 10 seconds
});
```

---

## Migration Steps (v3 to v4)

### Step 1: Understand Breaking Changes

Thoroughly review the "Breaking Changes from v3 to v4" section above. Identify which changes affect your application.

### Step 2: Update API Method Names

Replace all "action" method calls with "task" equivalents:
- `addAction()` → `addTask()`
- `updateActionByID()` → `updateTaskByID()`
- `updateActionByName()` → `updateTaskByName()`
- `removeActionByID()` → `removeTaskByID()`
- `removeActionByName()` → `removeTaskByName()`
- `getActions()` → `getTasks()`
- `getActionsByName()` → `getTasksByName()`
- `getActionByID()` → `getTaskByID()`
- `getActionsInRange()` → `getTasksInRange()`
- `describeAction()` → `describeTask()`

### Step 3: Update Event Listeners

Change event listeners from `'action'` to `'task'`:
```javascript
// v3
automator.on('action', (event) => { ... });

// v4
automator.on('task', (event) => { ... });
```

### Step 4: Update Event Property Access

Update code that accesses event properties:
```javascript
// v3
event.actionId
event.action

// v4
event.taskId
event.task
```

### Step 5: Migrate Stored State

If using file storage, update existing state files:
```javascript
// v3 format
{ "actions": [...] }

// v4 format
{ "tasks": [...] }
```

### Step 6: Review `catchUpWindow` Usage

If your v3 application relied on the implicit "unlimited" catch-up for tasks where `catchUpWindow` was not explicitly set, you will need to:

-   **Explicitly set `catchUpWindow: "unlimited"`** for those tasks if you wish to maintain the old behavior.
-   Otherwise, understand that these tasks will now use the new smart defaults (recurrence interval for recurring, `0` for one-time tasks).

### Step 7: Update Warning Event Listeners

If your application was listening for `automator.on('error', ...)` to catch notifications about defensive coercions (e.g., invalid `repeat.interval`), you must now update your code to listen for `automator.on('warning', ...)` to receive these non-fatal messages.

### Step 8: Correct Invalid `repeat.type` Definitions

If your application previously used tasks with invalid or missing `repeat.type` values that were silently corrected in v3, you must now explicitly fix these `repeat.type` values. Failure to do so will result in a hard `Error` when the task is added or updated in v4.

---

## Compatibility Notes

### What's the Same (v3 to v4)

-   **Core concepts**: Schedule tasks with recurrence
-   **Recurrence types**: `second`, `minute`, `hour`, `day`, `week`, `month`, `year`
-   **Local time**: Still operates in local time
-   **Function registration**: Still use `addFunction()`
-   **Legacy `unBuffered`**: Still supported as an alias, mapping to `catchUpWindow`.

### What's Different (v3 to v4)

-   **API terminology**: "action" → "task" throughout
-   **Event name**: `'action'` → `'task'`
-   **Event properties**: `actionId` → `taskId`, `action` → `task`
-   **State structure**: `actions` → `tasks`
-   **`catchUpWindow` Default Behavior**: Now smart and context-aware, instead of always `"unlimited"`.
-   **`repeat.type` Validation**: Invalid types now throw a fatal `Error`.
-   **Event Handling**: Coercions now emit `warning` events instead of `error` events.
-   **Defensive Defaults Philosophy**: More refined and explicit.

---

## Getting Help
