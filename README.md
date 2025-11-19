# 📚 **jw-automator v4**

### A resilient, local-time, 1-second precision automation scheduler for Node.js

**Human-friendly recurrence rules. Offline catch-up. DST-safe. Predictable. Extensible.**

---

## ⭐️ Overview

**jw-automator** is a robust automation engine designed for small devices, home automation hubs, personal servers, and Node.js environments where **correctness, resilience, and local-time behavior** matter more than millisecond precision. Version 4 introduces enhanced defensive defaults and clearer error handling, making it even more predictable and robust.

Where traditional cron falls short — missed executions, poor DST handling, limited recurrence, lack of catch-up semantics — **jw-automator** provides a predictable, human-centric scheduling model:

* **1-second granularity** with zero drift
* **Local calendar semantics** (weekday/weekend, monthly, yearly)
* **Configurable DST policies** (fall-back once/twice)
* **Offline resiliency & catch-up logic**
* **Buffered/unBuffered execution policies**
* **Rich introspection and event lifecycle**
* **Meta-actions** that can dynamically create/update other actions
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

## 🚀 Quick Start

### Installation

```bash
npm install jw-automator
```

### Basic Usage

```js
const Automator = require('jw-automator');

// Create an automator with file-based persistence
const automator = new Automator({
  storage: Automator.storage.file('./actions.json')
});

// Register a command function
automator.addFunction('turnLightOn', function(payload) {
  console.log('Turning light on');
});

// Seed initial actions (runs only on first use)
automator.seed((auto) => {
  auto.addAction({
    name: 'Morning Lights',
    cmd: 'turnLightOn',
    date: new Date('2025-05-01T07:00:00'),
    payload: null,
    catchUpWindow: 60000, // Tolerate 1 minute of lag
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

## 🔥 Features

### 1. **True 1-Second Precision**

* Scheduler tick interval is fixed at **1 second**.
* Execution times are aligned to the nearest whole second.
* No promise of sub-second timing (by design).
* Ideal for low-power hardware prone to event-loop delays.

> **Why?**
> A scheduler that *promises less* is dramatically more reliable.

---

### 2. **Human-Friendly Recurrence Rules**

Each action can specify a recurrence like:

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

### 4. **Resilient Offline Catch-Up with Smart Defaults**

When the device is offline or delayed, you can control exactly how far back to catch up using the `catchUpWindow` property. Automator v4 introduces **smart defaults** that infer the desired behavior based on your action's type, making the system more robust and predictable out-of-the-box.

**`catchUpWindow` Behavior:**

*   **Explicitly Set (milliseconds or `"unlimited"`):** Your explicit `catchUpWindow` value always takes precedence.
    *   `catchUpWindow: "unlimited"`: Catch up ALL missed executions.
    *   `catchUpWindow: 0`: Skip ALL missed executions (real-time only).
    *   `catchUpWindow: 5000`: Catch up if missed by ≤5 seconds, skip if older.
*   **Smart Default (Recurring Actions):** If not specified, `catchUpWindow` defaults to the **duration of the action's recurrence interval**.
    *   Example: A `repeat: { type: 'hour', interval: 1 }` action will default to a 1-hour `catchUpWindow`. If missed by less than an hour, it runs. If missed by more, it fast-forwards to the next scheduled interval.
*   **Smart Default (One-Time Actions):** If not specified and the action has no `repeat` property, `catchUpWindow` defaults to **`0`**.
    *   Example: A one-time task scheduled for 2:00 AM that's missed due to downtime will not run when the server comes back online later.

**How it works:**

*   If an action is missed by less than its effective `catchUpWindow`, it executes (recovers from brief glitches or short offline periods).
*   If missed by more, it's skipped and fast-forwarded to its next future scheduled time (prevents "thundering herds" after extended outages).
*   The fast-forward optimization uses mathematical projection to instantly advance high-frequency tasks.

**Events for Coercion & Validation:**

*   **`warning` event:** Emitted when `catchUpWindow` or `repeat` properties are syntactically invalid and have been defensively coerced to a sensible default (e.g., negative interval becomes `1`).
*   **`Error` (thrown):** For fundamental issues like an invalid `repeat.type` (e.g., typo like `'horu'`). This is a fatal error, as the user's intent cannot be reliably determined.

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
* Meta-scheduling (actions that schedule other actions)

Because `step` is deterministic, you can:

* Test schedules without time passing
* Generate "what would happen tomorrow"
* Debug recurrence rules
* Build custom visual schedulers

---

### 6. **Meta-Actions (Actions that Create Actions)**

jw-automator treats actions as **data**, enabling higher-order patterns:

* A daily 7:00 AM action can spawn a sequence of 60 one-per-second actions.
* A monthly billing action can create daily reminder actions.
* A multi-step animation (e.g., dimming a light) can create timed sub-actions.

Actions have a `repeat.count` that can be pre-set or manipulated intentionally.

This makes jw-automator more like a *mini automation runtime* than just a cron clone.

---

## 📐 API Reference

### Constructor

```js
new Automator(options)
```

Options:
* `storage` - Storage adapter (default: memory)
* `autoSave` - Auto-save state (default: true)
* `saveInterval` - Save interval in ms (default: 5000)

### Methods

#### `seed(callback)`
Seed the automator with initial actions. Runs only when the database is empty (first use).

**Returns:** `boolean` - `true` if seeding ran, `false` if skipped

```js
automator.seed((auto) => {
  auto.addAction({
    name: 'Daily Report',
    cmd: 'generateReport',
    date: new Date('2025-01-01T09:00:00'),
    catchUpWindow: "unlimited",
    repeat: { type: 'day', interval: 1 }
  });
});
```

**Why use seed()?**

* Solves the bootstrapping problem: safely initialize actions without resetting the schedule on every restart
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

#### `addAction(actionSpec)`
Add a new action. Returns the action ID.

```js
const id = automator.addAction({
  name: 'My Action',
  cmd: 'myCommand',
  date: new Date('2025-05-01T10:00:00'),
  payload: { data: 'value' },
  unBuffered: false,
  repeat: {
    type: 'hour',
    interval: 2,
    limit: 10,
    dstPolicy: 'once'
  }
});
```

#### `updateActionByID(id, updates)`
Update an existing action.

```js
automator.updateActionByID(1, {
  name: 'Updated Name',
  repeat: { type: 'day', interval: 1 }
});
```

#### `updateActionByName(name, updates)`
Update all actions with the given name. Returns the number of actions updated.

```js
automator.updateActionByName('My Action', {
  payload: { newData: 'newValue' }
});
```

#### `removeActionByID(id)`
Remove an action by ID.

#### `removeActionByName(name)`
Remove all actions with the given name.

#### `getActions()`
Get all actions (deep copy).

#### `getActionsByName(name)`
Get actions by name.

#### `getActionByID(id)`
Get a specific action by ID.

#### `getActionsInRange(startDate, endDate, callback)`
Simulate actions in a time range.

```js
const events = automator.getActionsInRange(
  new Date('2025-05-01'),
  new Date('2025-05-07')
);

console.log(events); // Array of scheduled events
```

#### `describeAction(id)`
Get a human-readable description of an action.

### Events

Listen to events using `automator.on(event, callback)`:

* `ready` - Scheduler started
* `action` - Action executed
* `update` - Action added/updated/removed
* `error` - Error occurred
* `warning` - Non-fatal data coercion or correction occurred
* `debug` - Debug information

```js
automator.on('action', (event) => {
  console.log('Action executed:', event.name);
  console.log('Scheduled:', event.scheduledTime);
  console.log('Actual:', event.actualTime);
});
```

### Storage Adapters

#### File Storage

```js
const automator = new Automator({
  storage: Automator.storage.file('./actions.json')
});
```

#### Memory Storage

```js
const automator = new Automator({
  storage: Automator.storage.memory()
});
```

#### Custom Storage

```js
const automator = new Automator({
  storage: {
    load: function() {
      // Return { actions: [...] }
    },
    save: function(state) {
      // Save state
    }
  }
});
```

---

## 📊 Example: Sensor Reading Every Second

```js
automator.addAction({
  name: 'TempSensor',
  cmd: 'readTemp',
  date: null,            // run immediately
  payload: null,
  unBuffered: false,     // catch up if delayed
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

## 🕰 DST Behavior Examples

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

## 🧪 Testing

```bash
npm test
npm run test:coverage
```

---

## 📦 Action Specification

### Top-level action fields:

| Field           | Description                                                           |
| --------------- | --------------------------------------------------------------------- |
| `id`            | Unique internal identifier (auto-generated)                          |
| `name`          | User label (optional)                                                |
| `cmd`           | Name of registered function to execute                               |
| `payload`       | Data passed to the command                                           |
| `date`          | Next scheduled run time (local `Date`)                               |
| `catchUpWindow` | Time window for catching up missed executions (smart default based on action type, or milliseconds number) |

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

## 🎯 Project Goals (v4)

* Deterministic behavior
* Rock-solid DST handling
* Predictable local-time recurrence
* Resilience to offline and delays
* Developer-friendly ergonomics
* Suitable for small devices
* Approachable but powerful API
* Long-term maintainability

---

## 📝 License

MIT

---

## ❤️ Acknowledgments

jw-automator v4 is a ground-up rethinking of the original jw-automator library, preserving the spirit while strengthening the foundations.

If you're building automation logic and want predictable, human-friendly scheduling that survives the real world — **welcome.**
