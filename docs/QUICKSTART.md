# Quick Start Guide

Get up and running with jw-automator v4 in 5 minutes.

---

## Installation

```bash
npm install jw-automator
```

---

## Basic Example

Create a file `app.js`:

```javascript
const Automator = require('jw-automator');

// Create automator with file-based storage
const automator = new Automator({
  storage: Automator.storage.file('./my-tasks.json')
});

// Register a function
automator.addFunction('sayHello', function(payload) {
  console.log(`Hello, ${payload.name}!`);
});

// Add a repeating task
automator.addTask({
  name: 'Greeting',
  cmd: 'sayHello',
  date: new Date(Date.now() + 2000), // Start in 2 seconds
  payload: { name: 'World' },
  repeat: {
    type: 'second',
    interval: 5,
    limit: 3 // Run 3 times then stop
  }
});

// Listen to events
automator.on('task', (event) => {
  console.log(`Task executed: ${event.name}`);
});

// Start the scheduler
automator.start();

console.log('Automator started! Greeting will run 3 times.');
```

Run it:

```bash
node app.js
```

---

## Common Patterns

### Daily Task at Specific Time

```javascript
automator.addTask({
  name: 'Daily Backup',
  cmd: 'runBackup',
  date: new Date('2025-05-01T02:00:00'), // 2:00 AM
  repeat: {
    type: 'day',
    interval: 1
  }
});
```

### Weekday Task

```javascript
automator.addTask({
  name: 'Weekday Reminder',
  cmd: 'sendReminder',
  date: new Date('2025-05-01T09:00:00'), // 9:00 AM
  repeat: {
    type: 'weekday',
    interval: 1 // Every weekday
  }
});
```

### Every N Minutes

```javascript
automator.addTask({
  name: 'Health Check',
  cmd: 'checkHealth',
  date: new Date(),
  repeat: {
    type: 'minute',
    interval: 15 // Every 15 minutes
  }
});
```

### Limited Run Count

```javascript
automator.addTask({
  name: 'Startup Sequence',
  cmd: 'initSystem',
  date: new Date(),
  repeat: {
    type: 'second',
    interval: 1,
    limit: 10 // Run exactly 10 times
  }
});
```

### End Date

```javascript
automator.addTask({
  name: 'Summer Sprinklers',
  cmd: 'waterLawn',
  date: new Date('2025-06-01T06:00:00'),
  repeat: {
    type: 'day',
    interval: 1,
    endDate: new Date('2025-09-01T00:00:00') // Stop after summer
  }
});
```

---

## Offline Catch-Up with `catchUpWindow`

Automator v4 manages offline catch-up using the `catchUpWindow` property, which has smart defaults for predictable behavior.

### Smart Defaults for `catchUpWindow`

-   **Recurring Tasks:** If `catchUpWindow` is not specified, it defaults to the **duration of the task's recurrence interval**. This ensures short delays are recovered, but long outages don't cause a "thundering herd."
-   **One-Time Tasks:** If `catchUpWindow` is not specified and the task has no `repeat` property, it defaults to **`0`** (skip if missed).

### Explicit Control

You can explicitly set `catchUpWindow`:

-   `catchUpWindow: "unlimited"`: Catch up ALL missed executions.
-   `catchUpWindow: 0`: Skip ALL missed executions (real-time only).
-   `catchUpWindow: 5000`: Catch up if missed by ≤5 seconds, skip if older.

#### Example: Critical Task (unlimited catch-up)

```javascript
automator.addTask({
  name: 'Critical Task',
  cmd: 'criticalTask',
  date: new Date('2025-05-01T10:00:00'),
  catchUpWindow: "unlimited", // Execute all missed, even if offline for long
  repeat: { type: 'hour', interval: 1 }
});
```

If the system is offline from 10:00 to 13:00, it will execute the 10:00, 11:00, and 12:00 occurrences when it comes back online.

#### Example: Animation Frame (skip missed)

```javascript
automator.addTask({
  name: 'Animation Frame',
  cmd: 'updateAnimation',
  date: new Date(),
  catchUpWindow: 0, // Only run if on time
  repeat: { type: 'second', interval: 1 }
});
```

If the system is delayed, it won't execute missed animation frames.

**Legacy `unBuffered`**: The `unBuffered` property is still supported as a direct alias for `catchUpWindow` for backwards compatibility: `unBuffered: false` maps to `catchUpWindow: "unlimited"`, and `unBuffered: true` maps to `catchUpWindow: 0`.

---

## Simulation

Preview what will happen in the future:

```javascript
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);

const events = automator.getTasksInRange(new Date(), tomorrow);

console.log(`${events.length} events scheduled in next 24 hours`);

events.slice(0, 5).forEach(event => {
  console.log(`${event.name} at ${event.scheduledTime.toLocaleString()}`);
});
```

---

## Storage Options

### File-Based Persistence

```javascript
const automator = new Automator({
  storageFile: './tasks.json',
  autoSave: true,        // default: true
  saveInterval: 15000    // default: 15000ms (15 seconds)
});
```

**Moratorium-Based Persistence:**
- CRUD operations (add/update/remove) save immediately and start a moratorium period
- Task execution marks state as dirty and saves if moratorium has expired
- `saveInterval` sets the moratorium period (minimum cooling time between saves)
- Reduces disk wear from task execution while ensuring CRUD changes persist immediately
- `stop()` always saves immediately if dirty, ignoring any active moratorium

### Memory-Only Mode (No Persistence)

```javascript
const automator = new Automator({
  // No storageFile = memory-only mode
});
```

State is lost when the process ends.

### Custom Storage (Database, Cloud, etc.)

For custom persistence, use `getTasks()` and event listeners:

```javascript
const automator = new Automator(); // Memory-only

// Load from custom source
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

## Event Handling

```javascript
// Scheduler ready
automator.on('ready', () => {
  console.log('Scheduler started');
});

// Task executed
automator.on('task', (event) => {
  console.log('Task:', event.name);
  console.log('Scheduled:', event.scheduledTime);
  console.log('Actual:', event.actualTime);
  console.log('Count:', event.count);
});

// Task added/updated/removed
automator.on('update', (event) => {
  console.log('Update:', event.operation, event.taskId);
});

// Errors
automator.on('error', (event) => {
  console.error('Error:', event.message);
});

// Warnings (non-fatal coercions/corrections)
automator.on('warning', (event) => {
  console.warn('Warning:', event.message);
});
```

---

## Managing Tasks

### Add

```javascript
const id = automator.addTask({
  name: 'My Task',
  cmd: 'myCommand',
  date: new Date(),
  repeat: { type: 'hour', interval: 1 }
});
```

### Update

```javascript
// By ID
automator.updateTaskByID(id, {
  name: 'Updated Task',
  repeat: { type: 'hour', interval: 2 }
});

// By name
automator.updateTaskByName('My Task', {
  payload: { updated: true }
});
```

### Remove

```javascript
// By ID
automator.removeTaskByID(id);

// By name
automator.removeTaskByName('My Task');
```

### Query

```javascript
// All tasks
const all = automator.getTasks();

// By name
const tasks = automator.getTasksByName('My Task');

// By ID
const task = automator.getTaskByID(id);

// Description
const desc = automator.describeTask(id);
console.log(desc);
```

---

## DST Handling

For tasks that run during daylight saving time transitions:

### Fall Back (Repeated Hour)

```javascript
automator.addTask({
  name: 'DST Aware',
  cmd: 'task',
  date: new Date('2025-11-02T01:30:00'), // Falls in repeated hour
  repeat: {
    type: 'day',
    interval: 1,
    dstPolicy: 'once' // Only run the first 1:30 AM
    // or dstPolicy: 'twice' to run both
  }
});
```

---

## Graceful Shutdown

```javascript
process.on('SIGINT', () => {
  console.log('Shutting down...');
  automator.stop(); // Saves state
  process.exit(0);
});
```

---

## Next Steps

- Read the full [README](../README.md)
- Check out [examples](../examples/)
- Review [Architecture](./ARCHITECTURE.md)
- See [Migration Guide](./MIGRATION.md) if upgrading from v3

---

Happy Automating!
