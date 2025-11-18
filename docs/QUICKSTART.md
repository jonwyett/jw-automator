# Quick Start Guide

Get up and running with jw-automator v3 in 5 minutes.

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
  storage: Automator.storage.file('./my-actions.json')
});

// Register a function
automator.addFunction('sayHello', function(payload) {
  console.log(`Hello, ${payload.name}!`);
});

// Add a repeating action
automator.addAction({
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
automator.on('action', (event) => {
  console.log(`Action executed: ${event.name}`);
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
automator.addAction({
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
automator.addAction({
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
automator.addAction({
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
automator.addAction({
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
automator.addAction({
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

## Buffered vs UnBuffered

### Buffered (Default) - Catch Up Missed Events

```javascript
automator.addAction({
  name: 'Critical Task',
  cmd: 'criticalTask',
  date: new Date('2025-05-01T10:00:00'),
  unBuffered: false, // Execute even if delayed
  repeat: { type: 'hour', interval: 1 }
});
```

If the system is offline from 10:00 to 13:00, it will execute the 10:00, 11:00, and 12:00 occurrences when it comes back online.

### UnBuffered - Skip Missed Events

```javascript
automator.addAction({
  name: 'Animation Frame',
  cmd: 'updateAnimation',
  date: new Date(),
  unBuffered: true, // Only run if on time
  repeat: { type: 'second', interval: 1 }
});
```

If the system is delayed, it won't execute missed animation frames.

---

## Simulation

Preview what will happen in the future:

```javascript
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);

const events = automator.getActionsInRange(new Date(), tomorrow);

console.log(`${events.length} events scheduled in next 24 hours`);

events.slice(0, 5).forEach(event => {
  console.log(`${event.name} at ${event.scheduledTime.toLocaleString()}`);
});
```

---

## Storage Options

### File Storage

```javascript
const automator = new Automator({
  storage: Automator.storage.file('./actions.json')
});
```

### Memory Storage (No Persistence)

```javascript
const automator = new Automator({
  storage: Automator.storage.memory()
});
```

### Custom Storage

```javascript
const automator = new Automator({
  storage: {
    load: function() {
      // Load from database, cloud, etc.
      return { actions: [...] };
    },
    save: function(state) {
      // Save to database, cloud, etc.
    }
  }
});
```

---

## Event Handling

```javascript
// Scheduler ready
automator.on('ready', () => {
  console.log('Scheduler started');
});

// Action executed
automator.on('action', (event) => {
  console.log('Action:', event.name);
  console.log('Scheduled:', event.scheduledTime);
  console.log('Actual:', event.actualTime);
  console.log('Count:', event.count);
});

// Action added/updated/removed
automator.on('update', (event) => {
  console.log('Update:', event.operation, event.actionId);
});

// Errors
automator.on('error', (event) => {
  console.error('Error:', event.message);
});
```

---

## Managing Actions

### Add

```javascript
const id = automator.addAction({
  name: 'My Task',
  cmd: 'myCommand',
  date: new Date(),
  repeat: { type: 'hour', interval: 1 }
});
```

### Update

```javascript
// By ID
automator.updateActionByID(id, {
  name: 'Updated Task',
  repeat: { type: 'hour', interval: 2 }
});

// By name
automator.updateActionByName('My Task', {
  payload: { updated: true }
});
```

### Remove

```javascript
// By ID
automator.removeActionByID(id);

// By name
automator.removeActionByName('My Task');
```

### Query

```javascript
// All actions
const all = automator.getActions();

// By name
const tasks = automator.getActionsByName('My Task');

// By ID
const task = automator.getActionByID(id);

// Description
const desc = automator.describeAction(id);
console.log(desc);
```

---

## DST Handling

For actions that run during daylight saving time transitions:

### Fall Back (Repeated Hour)

```javascript
automator.addAction({
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
- See [Migration Guide](./MIGRATION.md) if upgrading from v1

---

Happy Automating!
