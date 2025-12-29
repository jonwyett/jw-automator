/**
 * Basic Example - jw-automator v3
 *
 * This example demonstrates the core features of jw-automator.
 */

const Automator = require('../index');

// Create automator with file-based persistence
const automator = new Automator({
  storageFile: './example-actions.json',
  autoSave: true,
  saveInterval: 5000
});

// Register command functions
automator.addFunction('logMessage', function(payload, event) {
  console.log(`[${new Date().toLocaleTimeString()}] ${payload.message}`);
  console.log(`  Scheduled: ${event.scheduledTime.toLocaleTimeString()}`);
  console.log(`  Execution count: ${event.count + 1}`);
});

automator.addFunction('morningRoutine', function(payload) {
  console.log('Good morning! Starting daily routine...');
  console.log('- Check weather');
  console.log('- Turn on coffee maker');
  console.log('- Adjust thermostat');
});

automator.addFunction('weeklyBackup', function(payload) {
  console.log('Running weekly backup...');
  // Simulate backup process
  console.log('Backup complete!');
});

// Listen to events
automator.on('ready', () => {
  console.log('Automator started!');
  console.log('Current actions:', automator.getTasks().length);
});

automator.on('action', (event) => {
  console.log(`\n=== Action Executed ===`);
  console.log(`Name: ${event.name || 'Unnamed'}`);
  console.log(`Command: ${event.cmd}`);
  console.log(`======================\n`);
});

automator.on('error', (event) => {
  console.error('Error:', event.message);
});

// Seed initial actions (runs only on first use)
const seedResult = automator.seed((auto) => {
  console.log('Seeding initial actions...\n');

  // 1. Every 10 seconds - demo message
  const result1 = auto.addTask({
    name: 'Demo Message',
    cmd: 'logMessage',
    date: new Date(Date.now() + 5000), // Start in 5 seconds
    payload: { message: 'This is a recurring message every 10 seconds' },
    catchUpWindow: 30000, // Tolerate 30 seconds of lag
    repeat: {
      type: 'second',
      interval: 10,
      limit: 6, // Run 6 times then stop
      dstPolicy: 'once'
    }
  });
  if (!result1.success) {
    console.error('Failed to add demo task:', result1.error);
  }

  // 2. Daily morning routine at 7:00 AM
  const result2 = auto.addTask({
    name: 'Morning Routine',
    cmd: 'morningRoutine',
    date: new Date(new Date().setHours(7, 0, 0, 0)),
    catchUpWindow: "unlimited", // Never miss a morning routine
    repeat: {
      type: 'day',
      interval: 1,
      dstPolicy: 'once'
    }
  });
  if (!result2.success) {
    console.error('Failed to add morning routine:', result2.error);
  }

  // 3. Weekly backup every Sunday at 2:00 AM
  const nextSunday = new Date();
  nextSunday.setDate(nextSunday.getDate() + (7 - nextSunday.getDay()) % 7);
  nextSunday.setHours(2, 0, 0, 0);

  const result3 = auto.addTask({
    name: 'Weekly Backup',
    cmd: 'weeklyBackup',
    date: nextSunday,
    catchUpWindow: "unlimited", // Always run backups, even if delayed
    repeat: {
      type: 'week',
      interval: 1,
      dstPolicy: 'once'
    }
  });
  if (!result3.success) {
    console.error('Failed to add weekly backup:', result3.error);
  }
});

if (seedResult.seeded) {
  console.log('✅ Database seeded successfully\n');
} else {
  console.log('ℹ️  Database already populated - seeding skipped\n');
}

// Demonstrate simulation - what will happen in the next 24 hours?
console.log('\n=== Simulation: Next 24 hours ===');
const now = new Date();
const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

const futureEvents = automator.getTasksInRange(now, tomorrow);
console.log(`${futureEvents.length} events scheduled in the next 24 hours\n`);

futureEvents.slice(0, 10).forEach((event, i) => {
  console.log(`${i + 1}. ${event.name} at ${event.scheduledTime.toLocaleString()}`);
});

if (futureEvents.length > 10) {
  console.log(`... and ${futureEvents.length - 10} more events`);
}

console.log('\n=== Current Actions ===');
automator.getTasks().forEach((action) => {
  console.log(automator.describeTask(action.id));
  console.log('---');
});

// Start the automator
console.log('\n=== Starting Automator ===\n');
automator.start();

// Graceful shutdown on Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\nShutting down automator...');
  automator.stop();
  console.log('Goodbye!');
  process.exit(0);
});

// Keep the process running
console.log('Press Ctrl+C to stop\n');
