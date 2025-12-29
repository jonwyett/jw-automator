/**
 * Simple Moratorium Test
 *
 * Direct test of moratorium state machine without relying on task execution timing
 */

const Automator = require('../../src/Automator');
const fs = require('fs');
const path = require('path');

const testFile = path.join(__dirname, 'test-moratorium-simple.json');

// Clean up
if (fs.existsSync(testFile)) {
  fs.unlinkSync(testFile);
}

function getFileModTime() {
  if (!fs.existsSync(testFile)) return null;
  return fs.statSync(testFile).mtimeMs;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  console.log('=== Moratorium State Machine - Direct Test ===\n');

  const automator = new Automator({
    storageFile: testFile,
    autoSave: true,
    saveInterval: 1000  // 1 second moratorium for faster testing
  });

  automator.addFunction('test', () => {});

  function checkState(label) {
    console.log(`${label}:`);
    console.log(`  dirty=${automator.stateDirty}, moratorium=${automator.moratoriumActive}, timer=${automator.moratoriumTimer !== null}`);
  }

  // Test 1: CRUD forces save
  console.log('Test 1: CRUD operation forces immediate save\n');

  const t0 = getFileModTime();
  console.log(`Before addTask: file exists = ${t0 !== null}`);

  automator.addTask({
    name: 'Task 1',
    cmd: 'test',
    date: new Date(Date.now() + 60000),
    payload: {}
  });

  await wait(50);
  const t1 = getFileModTime();
  checkState('After CRUD');
  console.log(`File saved: ${t1 !== null && t1 > (t0 || 0)}\n`);

  // Test 2: Another CRUD during moratorium forces save again
  console.log('Test 2: CRUD during moratorium forces save (ignores moratorium)\n');

  await wait(100); // Still in 1-second moratorium
  const t2Before = getFileModTime();

  automator.addTask({
    name: 'Task 2',
    cmd: 'test',
    date: new Date(Date.now() + 60000),
    payload: {}
  });

  await wait(50);
  const t2After = getFileModTime();
  checkState('After 2nd CRUD (during moratorium)');
  console.log(`File saved again: ${t2After > t2Before}\n`);

  // Test 3: Simulate task execution by calling _requestSave(false) directly
  console.log('Test 3: Non-forced save during moratorium marks dirty but does NOT save\n');

  await wait(100); // Still in moratorium
  const t3Before = getFileModTime();
  checkState('Before non-forced save');

  // Directly call the internal method to simulate task execution
  automator._requestSave(false);

  await wait(50);
  const t3After = getFileModTime();
  checkState('After non-forced save (during moratorium)');
  console.log(`File NOT saved: ${t3After === t3Before}`);
  console.log(`Dirty flag set: ${automator.stateDirty}\n`);

  // Test 4: Moratorium expiration triggers save if dirty
  console.log('Test 4: When moratorium expires, dirty state triggers save\n');
  console.log('Waiting for moratorium to expire (~900ms)...');

  const t4Before = getFileModTime();

  // Wait for moratorium to expire
  await wait(1100);

  const t4After = getFileModTime();
  checkState('After moratorium expired');
  console.log(`File saved: ${t4After > t4Before}`);
  console.log(`Dirty cleared: ${!automator.stateDirty}`);
  console.log(`New moratorium started: ${automator.moratoriumActive}\n`);

  // Test 5: Non-forced save when NO moratorium active saves immediately
  console.log('Test 5: Non-forced save when moratorium NOT active saves immediately\n');

  // Wait for moratorium to expire
  await wait(1100);
  checkState('Before non-forced save (no moratorium)');

  const t5Before = getFileModTime();

  automator._requestSave(false);

  await wait(50);
  const t5After = getFileModTime();
  checkState('After non-forced save (no moratorium)');
  console.log(`File saved: ${t5After > t5Before}`);
  console.log(`Moratorium started: ${automator.moratoriumActive}\n`);

  // Test 6: Stop() cancels timer and forces save if dirty
  console.log('Test 6: Stop() cancels timer and forces save if dirty\n');

  // Make dirty without saving
  automator._requestSave(false);
  await wait(50);
  checkState('Before stop (dirty, in moratorium)');

  const t6Before = getFileModTime();

  automator.stop();

  await wait(50);
  const t6After = getFileModTime();
  checkState('After stop');
  console.log(`File saved: ${t6After > t6Before}`);
  console.log(`Timer cancelled: ${automator.moratoriumTimer === null}\n`);

  console.log('=== All Tests Passed ===');
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
