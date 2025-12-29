/**
 * Test Script: Moratorium-Based State Machine
 *
 * This script verifies the moratorium-based persistence system:
 * 1. CRUD operations force immediate save and start moratorium
 * 2. Task execution during moratorium marks dirty but doesn't save
 * 3. Moratorium expiration triggers save if dirty
 * 4. Multiple CRUDs restart moratorium each time
 * 5. Stop() while dirty forces save
 */

const Automator = require('../../src/Automator');
const fs = require('fs');
const path = require('path');

const testFile = path.join(__dirname, 'test-moratorium.json');

// Clean up test file
if (fs.existsSync(testFile)) {
  fs.unlinkSync(testFile);
}

// Helper to read file modification time
function getFileModTime() {
  if (!fs.existsSync(testFile)) return null;
  return fs.statSync(testFile).mtimeMs;
}

// Helper to wait
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test counter
let testNum = 0;
function log(msg) {
  console.log(`[Test ${++testNum}] ${msg}`);
}

async function runTests() {
  console.log('=== Moratorium State Machine Tests ===\n');

  // Create automator with 2 second moratorium
  const automator = new Automator({
    storageFile: testFile,
    autoSave: true,
    saveInterval: 2000  // 2 second moratorium
  });

  // Register test function
  automator.addFunction('testCmd', function(payload) {
    console.log(`  [Task executed: ${payload.msg}]`);
  });

  // Expose internal state for testing
  function getState() {
    return {
      dirty: automator.stateDirty,
      moratorium: automator.moratoriumActive,
      timerActive: automator.moratoriumTimer !== null
    };
  }

  try {
    // TEST 1: CRUD saves immediately
    log('CRUD operation should save immediately and start moratorium');
    const beforeAdd = getFileModTime();
    await wait(100);

    automator.addTask({
      name: 'Test Task 1',
      cmd: 'testCmd',
      date: new Date(Date.now() + 60000),
      payload: { msg: 'Task 1' }
    });

    await wait(100);
    const afterAdd = getFileModTime();
    const state1 = getState();

    console.log(`  File saved: ${afterAdd > beforeAdd ? 'YES ✓' : 'NO ✗'}`);
    console.log(`  Dirty: ${state1.dirty ? 'YES ✗' : 'NO ✓'}`);
    console.log(`  Moratorium active: ${state1.moratorium ? 'YES ✓' : 'NO ✗'}`);
    console.log(`  Timer running: ${state1.timerActive ? 'YES ✓' : 'NO ✗'}\n`);

    // TEST 2: Task execution during moratorium marks dirty but doesn't save
    log('Task execution during moratorium should mark dirty but NOT save');

    // Add a task that executes immediately
    automator.addTask({
      name: 'Immediate Task',
      cmd: 'testCmd',
      date: new Date(Date.now() + 100),
      payload: { msg: 'Immediate execution' }
    });

    automator.start();
    await wait(500); // Let task execute

    const beforeTaskExec = getFileModTime();
    await wait(100);
    const afterTaskExec = getFileModTime();
    const state2 = getState();

    console.log(`  File saved: ${afterTaskExec > beforeTaskExec ? 'YES ✗' : 'NO ✓'}`);
    console.log(`  Dirty: ${state2.dirty ? 'YES ✓' : 'NO ✗'}`);
    console.log(`  Moratorium still active: ${state2.moratorium ? 'YES ✓' : 'NO ✗'}\n`);

    // TEST 3: Moratorium expiration triggers save if dirty
    log('After moratorium expires, dirty state should trigger save');
    console.log('  Waiting for moratorium to expire (2 seconds)...');

    const beforeExpire = getFileModTime();
    await wait(2500); // Wait for moratorium to expire and callback to fire
    const afterExpire = getFileModTime();
    const state3 = getState();

    console.log(`  File saved: ${afterExpire > beforeExpire ? 'YES ✓' : 'NO ✗'}`);
    console.log(`  Dirty: ${state3.dirty ? 'YES ✗' : 'NO ✓'}`);
    console.log(`  Moratorium active: ${state3.moratorium ? 'YES ✓' : 'NO ✓'} (new moratorium started)`);
    console.log(`  Timer running: ${state3.timerActive ? 'YES ✓' : 'NO ✗'}\n`);

    // TEST 4: Multiple CRUDs restart moratorium each time
    log('Multiple CRUD operations should restart moratorium each time');

    // First CRUD
    automator.addTask({
      name: 'CRUD Test 1',
      cmd: 'testCmd',
      date: new Date(Date.now() + 60000),
      payload: { msg: 'CRUD 1' }
    });
    await wait(100);
    const time1 = getFileModTime();

    // Wait 1 second (moratorium is 2 seconds)
    await wait(1000);

    // Second CRUD - should save immediately and restart moratorium
    automator.addTask({
      name: 'CRUD Test 2',
      cmd: 'testCmd',
      date: new Date(Date.now() + 60000),
      payload: { msg: 'CRUD 2' }
    });
    await wait(100);
    const time2 = getFileModTime();

    // Wait another 1 second (still within new 2-second moratorium)
    await wait(1000);

    // Third CRUD - should save immediately and restart moratorium again
    automator.addTask({
      name: 'CRUD Test 3',
      cmd: 'testCmd',
      date: new Date(Date.now() + 60000),
      payload: { msg: 'CRUD 3' }
    });
    await wait(100);
    const time3 = getFileModTime();
    const state4 = getState();

    console.log(`  CRUD 1 saved: ${time1 !== null ? 'YES ✓' : 'NO ✗'}`);
    console.log(`  CRUD 2 saved: ${time2 > time1 ? 'YES ✓' : 'NO ✗'}`);
    console.log(`  CRUD 3 saved: ${time3 > time2 ? 'YES ✓' : 'NO ✗'}`);
    console.log(`  Moratorium restarted: ${state4.moratorium ? 'YES ✓' : 'NO ✗'}\n`);

    // TEST 5: Stop() while dirty forces save
    log('Stop() while dirty should force immediate save');

    // Let moratorium expire first
    await wait(2500);

    // Trigger a task execution to make dirty
    automator.addTask({
      name: 'Final Task',
      cmd: 'testCmd',
      date: new Date(Date.now() + 100),
      payload: { msg: 'Final execution' }
    });
    await wait(500); // Let task execute and mark dirty

    const beforeStop = getFileModTime();
    await wait(100);

    automator.stop();

    await wait(100);
    const afterStop = getFileModTime();
    const state5 = getState();

    console.log(`  File saved on stop: ${afterStop > beforeStop ? 'YES ✓' : 'NO ✗'}`);
    console.log(`  Dirty after stop: ${state5.dirty ? 'YES ✗' : 'NO ✓'}`);
    console.log(`  Moratorium cancelled: ${!state5.moratorium && !state5.timerActive ? 'YES ✓' : 'NO ✗'}\n`);

    console.log('=== All Tests Complete ===\n');

  } catch (error) {
    console.error('Test failed:', error);
    automator.stop();
  }
}

runTests().catch(console.error);
