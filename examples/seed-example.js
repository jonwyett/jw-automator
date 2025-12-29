/**
 * Seed Example - jw-automator v3
 *
 * Demonstrates the seed() method and catchUpWindow property.
 * This example shows how to bootstrap a persistent scheduler that:
 * - Initializes actions only on first run
 * - Preserves user-modified schedules on subsequent runs
 * - Uses catchUpWindow for smart catch-up behavior
 */

const Automator = require('../index');
const fs = require('fs');

// Storage file path
const STORAGE_FILE = './seed-example-actions.json';

// Clean up old storage file for demo purposes
if (fs.existsSync(STORAGE_FILE)) {
  console.log('Note: Removing existing storage file for clean demo');
  fs.unlinkSync(STORAGE_FILE);
}

// Create automator with file-based persistence
const automator = new Automator({
  storageFile: STORAGE_FILE,
  autoSave: true,
  saveInterval: 3000
});

// Register command functions
automator.addFunction('criticalTask', function(payload, event) {
  console.log(`[CRITICAL] ${payload.message}`);
  console.log(`  Scheduled: ${event.scheduledTime.toLocaleTimeString()}`);
  console.log(`  Executed: ${event.actualTime.toLocaleTimeString()}`);
  console.log(`  Execution #${event.count + 1}`);
});

automator.addFunction('realtimeAlert', function(payload, event) {
  console.log(`[REALTIME] ${payload.message}`);
  console.log(`  Only executes if "now" - skips if missed`);
});

automator.addFunction('flexibleTask', function(payload, event) {
  const lag = event.actualTime - event.scheduledTime;
  console.log(`[FLEXIBLE] ${payload.message}`);
  console.log(`  Lag: ${lag}ms (tolerates up to 5 seconds)`);
});

// Listen to events
automator.on('ready', () => {
  console.log('\n=== Automator Ready ===');
  console.log(`Actions loaded: ${automator.getTasks().length}`);
});

// SEED: Initialize actions (runs only on first use)
const didSeed = automator.seed((auto) => {
  console.log('\n=== SEEDING: First Run Detected ===');
  console.log('Creating initial system tasks...\n');

  // Task 1: Critical billing task - NEVER miss an execution
  auto.addTask({
    name: 'Billing Task',
    cmd: 'criticalTask',
    date: new Date(Date.now() + 2000),
    payload: { message: 'Process billing (catchUpWindow: "unlimited")' },
    catchUpWindow: "unlimited", // Catch up ALL missed executions
    repeat: {
      type: 'second',
      interval: 10,
      limit: 3
    }
  });

  // Task 2: Real-time alert - only relevant "now"
  auto.addTask({
    name: 'Realtime Alert',
    cmd: 'realtimeAlert',
    date: new Date(Date.now() + 5000),
    payload: { message: 'Temperature spike detected!' },
    catchUpWindow: 0, // Skip ALL missed executions
    repeat: {
      type: 'second',
      interval: 15,
      limit: 3
    }
  });

  // Task 3: Flexible sensor reading - tolerate brief lag
  auto.addTask({
    name: 'Sensor Reading',
    cmd: 'flexibleTask',
    date: new Date(Date.now() + 8000),
    payload: { message: 'Read temperature sensor' },
    catchUpWindow: 5000, // Tolerate up to 5 seconds of lag
    repeat: {
      type: 'second',
      interval: 12,
      limit: 3
    }
  });

  console.log('✅ Initial tasks created!\n');
});

if (didSeed) {
  console.log('✨ Seeding completed - tasks initialized for the first time');
} else {
  console.log('⏭️  Seeding skipped - existing schedule preserved');
}

console.log('\n=== Current Schedule ===');
automator.getTasks().forEach((action) => {
  console.log(`\n${action.name}:`);
  console.log(`  catchUpWindow: ${action.catchUpWindow === "unlimited" ? '"unlimited"' : action.catchUpWindow + 'ms'}`);
  console.log(`  Next run: ${action.date.toLocaleTimeString()}`);
  console.log(`  Executions so far: ${action.count}`);
});

console.log('\n=== Starting Scheduler ===\n');
automator.start();

// Simulate a brief delay after 15 seconds to demonstrate catch-up behavior
setTimeout(() => {
  console.log('\n⏸️  Simulating 3-second system pause...\n');
  const start = Date.now();
  while (Date.now() - start < 3000) {
    // Block the event loop
  }
  console.log('▶️  Resumed! Watch how different catchUpWindow values behave:\n');
}, 15000);

// Auto-stop after 40 seconds
setTimeout(() => {
  console.log('\n=== Shutting Down ===');
  automator.stop();
  console.log('\n💡 Tip: Run this example again to see seeding skipped!');
  console.log(`Storage file: ${STORAGE_FILE}`);
  console.log('Goodbye!\n');
  process.exit(0);
}, 40000);

// Graceful shutdown on Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  automator.stop();
  process.exit(0);
});
