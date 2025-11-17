# Migration Guide: v1 to v2

This guide helps you migrate from jw-automator v1 to v2.

---

## Overview

jw-automator v2 is a **complete rewrite** with improved semantics, better DST handling, and a cleaner API. While the core concepts remain the same, there are breaking changes.

---

## Breaking Changes

### 1. Constructor and Initialization

**v1:**
```javascript
const automator = require('jw-automator');
automator.init({ file: './actions.json' });
```

**v2:**
```javascript
const Automator = require('jw-automator');
const automator = new Automator({
  storage: Automator.storage.file('./actions.json')
});
```

### 2. Action Structure

**v1:**
Action structure was less formalized.

**v2:**
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
    dstPolicy: 'once' // NEW in v2
  },
  count: 0           // Execution counter
}
```

### 3. DST Policy

**v1:**
DST behavior was implicit and sometimes unpredictable.

**v2:**
Explicit DST policy for fall-back scenarios:
```javascript
repeat: {
  type: 'hour',
  interval: 1,
  dstPolicy: 'once'  // or 'twice'
}
```

### 4. Event Names

**v1:**
Various event names.

**v2:**
Standardized events:
- `ready` - Scheduler started
- `action` - Action executed
- `update` - Action added/updated/removed
- `error` - Error occurred
- `debug` - Debug information

### 5. API Methods

#### Adding Actions

**v1:**
```javascript
automator.addAction(actionObject);
```

**v2:**
```javascript
const id = automator.addAction(actionSpec);
// Returns the action ID
```

#### Getting Actions

**v1:**
```javascript
const actions = automator.getActions();
```

**v2:**
```javascript
const actions = automator.getActions(); // Deep copy
const action = automator.getActionByID(id);
const actions = automator.getActionsByName('name');
```

#### Removing Actions

**v1:**
```javascript
automator.removeAction(id);
```

**v2:**
```javascript
automator.removeActionByID(id);
automator.removeActionByName('name'); // Returns count removed
```

#### Updating Actions

**v1:**
Limited update capability.

**v2:**
```javascript
automator.updateActionByID(id, {
  name: 'New Name',
  repeat: { type: 'hour', interval: 2 }
});
```

---

## New Features in v2

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

## Migration Steps

### Step 1: Update Initialization

Replace your v1 initialization with v2 constructor:

```javascript
// Before
const automator = require('jw-automator');
automator.init({ file: './actions.json' });

// After
const Automator = require('jw-automator');
const automator = new Automator({
  storage: Automator.storage.file('./actions.json')
});
```

### Step 2: Update Action Definitions

Add `dstPolicy` to actions with repeat:

```javascript
// Before
automator.addAction({
  cmd: 'myCmd',
  date: new Date(),
  repeat: { type: 'day', interval: 1 }
});

// After
automator.addAction({
  cmd: 'myCmd',
  date: new Date(),
  repeat: {
    type: 'day',
    interval: 1,
    dstPolicy: 'once' // Explicitly choose DST behavior
  }
});
```

### Step 3: Update Event Listeners

Standardize event names:

```javascript
// Before
automator.on('actionExecuted', (data) => { ... });

// After
automator.on('action', (event) => { ... });
```

### Step 4: Update API Calls

Use new method names:

```javascript
// Before
automator.removeAction(id);

// After
automator.removeActionByID(id);
```

### Step 5: Test DST Behavior

Review actions that run during DST transitions and set appropriate `dstPolicy`:

- `'once'` - Run only the first occurrence during fall-back (recommended default)
- `'twice'` - Run both occurrences during fall-back

### Step 6: Leverage New Features

Consider using:
- `getActionsInRange()` for calendar previews
- `describeAction()` for debugging
- Custom storage adapters for database persistence
- Update events for logging changes

---

## Compatibility Notes

### What's the Same

- **Core concept**: Schedule actions with recurrence
- **Recurrence types**: second, minute, hour, day, week, month, year
- **Local time**: Still operates in local time
- **Buffered/unbuffered**: Still supported (as `unBuffered` flag)
- **Function registration**: Still use `addFunction()`

### What's Different

- **Constructor**: Now uses `new Automator()`
- **Storage**: Explicitly configured
- **DST**: Explicit policy required
- **Events**: Standardized names and payloads
- **API**: More consistent naming (`ByID`, `ByName`)
- **IDs**: Auto-generated, not user-provided
- **State**: Better separation of spec vs. state

---

## Example: Complete Migration

**v1 Code:**
```javascript
const automator = require('jw-automator');
automator.init({ file: './actions.json' });

automator.addFunction('turnLightOn', () => {
  console.log('Light on');
});

automator.addAction({
  cmd: 'turnLightOn',
  date: new Date('2025-05-01T07:00:00'),
  repeat: { type: 'day', interval: 1 }
});

automator.start();
```

**v2 Code:**
```javascript
const Automator = require('jw-automator');

const automator = new Automator({
  storage: Automator.storage.file('./actions.json')
});

automator.addFunction('turnLightOn', () => {
  console.log('Light on');
});

automator.addAction({
  name: 'Morning Lights',
  cmd: 'turnLightOn',
  date: new Date('2025-05-01T07:00:00'),
  unBuffered: false,
  repeat: {
    type: 'day',
    interval: 1,
    dstPolicy: 'once'
  }
});

automator.start();
```

---

## Getting Help

If you encounter issues during migration:

1. Check the [README](../README.md) for full API documentation
2. Review the [Architecture](./ARCHITECTURE.md) for design understanding
3. Run the examples in the `examples/` directory
4. File an issue on GitHub

---

## Why Rewrite?

v2 addresses several issues from v1:

- **Infinite loops**: Better safety guards
- **DST bugs**: Explicit, predictable handling
- **Catch-up logic**: More reliable offline behavior
- **Testability**: Deterministic core engine
- **Maintainability**: Cleaner architecture
- **Extensibility**: Pluggable storage, better API

The rewrite provides a solid foundation for long-term reliability.
