/**
 * Basic Example - jw-automator v3
 *
 * This example demonstrates the core features of jw-automator.
 */

const Automator = require('../index');

// Create automator with file-based persistence
const automator = new Automator({
  storage: Automator.storage.file('./example-actions.json'),
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
  console.log('Current actions:', automator.getActions().length);
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

// Add actions

// 1. Every 10 seconds - demo message
automator.addAction({
  name: 'Demo Message',
  cmd: 'logMessage',
  date: new Date(Date.now() + 5000), // Start in 5 seconds
  payload: { message: 'This is a recurring message every 10 seconds' },
  unBuffered: false,
  repeat: {
    type: 'second',
    interval: 10,
    limit: 6, // Run 6 times then stop
    dstPolicy: 'once'
  }
});

// 2. Daily morning routine at 7:00 AM
automator.addAction({
  name: 'Morning Routine',
  cmd: 'morningRoutine',
  date: new Date(new Date().setHours(7, 0, 0, 0)),
  unBuffered: false,
  repeat: {
    type: 'day',
    interval: 1,
    dstPolicy: 'once'
  }
});

// 3. Weekly backup every Sunday at 2:00 AM
const nextSunday = new Date();
nextSunday.setDate(nextSunday.getDate() + (7 - nextSunday.getDay()) % 7);
nextSunday.setHours(2, 0, 0, 0);

automator.addAction({
  name: 'Weekly Backup',
  cmd: 'weeklyBackup',
  date: nextSunday,
  unBuffered: false,
  repeat: {
    type: 'week',
    interval: 1,
    dstPolicy: 'once'
  }
});

// Demonstrate simulation - what will happen in the next 24 hours?
console.log('\n=== Simulation: Next 24 hours ===');
const now = new Date();
const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

const futureEvents = automator.getActionsInRange(now, tomorrow);
console.log(`${futureEvents.length} events scheduled in the next 24 hours\n`);

futureEvents.slice(0, 10).forEach((event, i) => {
  console.log(`${i + 1}. ${event.name} at ${event.scheduledTime.toLocaleString()}`);
});

if (futureEvents.length > 10) {
  console.log(`... and ${futureEvents.length - 10} more events`);
}

console.log('\n=== Current Actions ===');
automator.getActions().forEach((action) => {
  console.log(automator.describeAction(action.id));
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
