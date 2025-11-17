/**
 * Hello World - jw-automator v3
 *
 * The simplest possible example.
 */

const Automator = require('../index');

// Create automator (in-memory, no persistence)
const automator = new Automator({
  storage: Automator.storage.memory()
});

// Register a function
automator.addFunction('sayHello', function() {
  console.log('Hello, World!');
});

// Add an action that runs every 3 seconds, 5 times
automator.addAction({
  cmd: 'sayHello',
  date: new Date(Date.now() + 1000), // Start in 1 second
  repeat: {
    type: 'second',
    interval: 3,
    limit: 5
  }
});

// Start the scheduler
automator.start();

console.log('Automator started! Will say hello 5 times, every 3 seconds.');

// Auto-stop after 20 seconds
setTimeout(() => {
  automator.stop();
  console.log('Goodbye!');
  process.exit(0);
}, 20000);
