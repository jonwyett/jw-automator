# Migration Guide: v3 to v4

This guide helps you migrate from jw-automator v3 to v4.

---

## Overview

jw-automator v4 is a significant refinement of v3's architecture, focusing on making the scheduler's behavior even more predictable and robust out-of-the-box. While v3 represented a complete rewrite, v4 introduces breaking changes by refining default behaviors and error handling for action specifications.

v3 was the widely-deployed production version. v4 builds upon that foundation with enhanced predictability.

---

## Breaking Changes from v3 to v4

### 1. Default `catchUpWindow` Behavior Changed

**v3:** If `catchUpWindow` was not specified, it defaulted to `"unlimited"` (catch up all missed executions).
**v4:** If `catchUpWindow` is not specified, it now uses a **smart default** based on the action type:
-   For **recurring actions**, it defaults to the **duration of the recurrence interval** (e.g., an hourly action gets a 1-hour `catchUpWindow`).
-   For **one-time actions**, it defaults to **`0`** (skip all missed executions).

**Impact:** User applications that relied on the implicit "unlimited" catch-up for all actions in v3 might now see actions being skipped or fast-forwarded more aggressively. If you desire the old "unlimited" catch-up, you must explicitly set `catchUpWindow: "unlimited"`.

### 2. Invalid `repeat.type` Throws a Fatal Error

**v3:** If `repeat.type` was missing or invalid (e.g., a typo like `'horu'`), Automator would defensively coerce it to `'day'` and emit an `error` event.
**v4:** An invalid or missing `repeat.type` now throws a hard `Error` immediately.

**Impact:** Code that previously succeeded by silently allowing `repeat.type` coercions will now fail fast, forcing explicit correction. This ensures that the action's intent is never misinterpreted.

### 3. Coercion Events Changed from `error` to `warning`

**v3:** Non-fatal defensive coercions (e.g., an invalid `repeat.interval` being set to `1`, a negative `catchUpWindow` becoming `0`) would emit an `error` event.
**v4:** These same non-fatal coercions now emit a `warning` event. The `error` event is reserved for more critical issues (e.g., storage failures).

**Impact:** If your application was listening for `automator.on('error', ...)` to catch these coercion notifications, you must now update your event listener to `automator.on('warning', ...)` to continue receiving them.

---

## Breaking Changes from v3 to v4

### 1. Constructor and Initialization

**v2:**
```javascript
const automator = require('jw-automator');
automator.init({ file: './actions.json' });
```

**v3:**
```javascript
const Automator = require('jw-automator');
const automator = new Automator({
  storage: Automator.storage.file('./actions.json')
});
```

### 2. Action Structure

**v2:**
Action structure was less formalized.

**v3:**
```javascript
{
  id: 1,              // Auto-generated
  name: 'My Action',  // Optional
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
- `action` - Action executed
- `update` - Action added/updated/removed
- `error` - Error occurred
- `debug` - Debug information

### 5. API Methods

#### Adding Actions

**v2:**
```javascript
automator.addAction(actionObject);
```

**v3:**
```javascript
const id = automator.addAction(actionSpec);
// Returns the action ID
```

#### Getting Actions

**v2:**
```javascript
const actions = automator.getActions();
```

**v3:**
```javascript
const actions = automator.getActions(); // Deep copy
const action = automator.getActionByID(id);
const actions = automator.getActionsByName('name');
```

#### Removing Actions

**v2:**
```javascript
automator.removeAction(id);
```

**v3:**
```javascript
automator.removeActionByID(id);
automator.removeActionByName('name'); // Returns count removed
```

#### Updating Actions

**v2:**
Limited update capability.

**v3:**
```javascript
automator.updateActionByID(id, {
  name: 'New Name',
  repeat: { type: 'hour', interval: 2 }
});

automator.updateActionByName('Old Name', {
  name: 'New Name'
});
```

---

## New Features in v3

## New Features in v4

### 1. Smart `catchUpWindow` Defaults

The new intelligent default system for `catchUpWindow` means that for most actions, you no longer need to explicitly define this property to get predictable, sensible behavior. It automatically adapts based on whether your action is one-time or recurring.

### 2. Dedicated `warning` Event

A new `warning` event (`automator.on('warning', ...)`) provides a clearer channel for non-fatal feedback about defensive coercions. This allows developers to distinguish between critical runtime errors and minor data corrections.

---

## New Features in v3

### 1. Simulation

Preview future schedules without running them:

```javascript
const events = automator.getActionsInRange(
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
  storage: Automator.storage.file('./actions.json')
});

// Custom storage
const automator = new Automator({
  storage: {
    load: () => { /* load from DB */ },
    save: (state) => { /* save to DB */ }
  }
});
```

### 3. Action Description

Human-readable action summaries:

```javascript
console.log(automator.describeAction(1));
// Action #1 - Morning Lights
//   Command: turnLightOn
//   Next run: 5/1/2025, 7:00:00 AM
//   Executions: 15
//   Buffered: true
//   Recurrence: day
//   DST policy: once
```

### 4. Better Event Payloads

Action events include rich metadata:

```javascript
automator.on('action', (event) => {
  console.log(event);
  // {
  //   type: 'action',
  //   actionId: 1,
  //   name: 'My Action',
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
  storage: Automator.storage.file('./actions.json'),
  autoSave: true,
  saveInterval: 10000 // Save every 10 seconds
});
```

---

## Migration Steps (v3 to v4)

### Step 1: Understand Breaking Changes

Thoroughly review the "Breaking Changes from v3 to v4" section above. Identify which changes affect your application.

### Step 2: Review `catchUpWindow` Usage

If your v3 application relied on the implicit "unlimited" catch-up for actions where `catchUpWindow` was not explicitly set, you will need to:

-   **Explicitly set `catchUpWindow: "unlimited"`** for those actions if you wish to maintain the old behavior.
-   Otherwise, understand that these actions will now use the new smart defaults (recurrence interval for recurring, `0` for one-time actions).

### Step 3: Update Event Listeners

If your application was listening for `automator.on('error', ...)` to catch notifications about defensive coercions (e.g., invalid `repeat.interval`), you must now update your code to listen for `automator.on('warning', ...)` to receive these non-fatal messages.

### Step 4: Correct Invalid `repeat.type` Definitions

If your application previously used actions with invalid or missing `repeat.type` values that were silently corrected in v3, you must now explicitly fix these `repeat.type` values. Failure to do so will result in a hard `Error` when the action is added or updated in v4.

---

## Compatibility Notes

### What's the Same (v3 to v4)

-   **Core concepts**: Schedule actions with recurrence
-   **Recurrence types**: `second`, `minute`, `hour`, `day`, `week`, `month`, `year`
-   **Local time**: Still operates in local time
-   **API methods**: Names and signatures of `addAction()`, `updateActionByID()`, etc., remain the same.
-   **Function registration**: Still use `addFunction()`
-   **Legacy `unBuffered`**: Still supported as an alias, mapping to `catchUpWindow`.

### What's Different (v3 to v4)

-   **`catchUpWindow` Default Behavior**: Now smart and context-aware, instead of always `"unlimited"`.
-   **`repeat.type` Validation**: Invalid types now throw a fatal `Error`.
-   **Event Handling**: Coercions now emit `warning` events instead of `error` events.
-   **Defensive Defaults Philosophy**: More refined and explicit.

---

## Getting Help
