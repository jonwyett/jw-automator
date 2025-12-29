/**
 * Test Script v2: Moratorium-Based State Machine
 *
 * More carefully designed tests to verify moratorium behavior
 */

const Automator = require('../../src/Automator');
const fs = require('fs');
const path = require('path');

const testFile = path.join(__dirname, 'test-moratorium-v2.json');

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
  console.log(`\n[Test ${++testNum}] ${msg}`);
}

async function runTests() {
  console.log('=== Moratorium State Machine Tests v2 ===\n');

  // Create automator with 2 second moratorium
  const automator = new Automator({
    storageFile: testFile,
    autoSave: true,
    saveInterval: 2000  // 2 second moratorium
  });

  let taskExecutions = 0;

  // Register test function
  automator.addFunction('testCmd', function(payload) {
    taskExecutions++;
    console.log(`  → Task executed: "${payload.msg}" (execution #${taskExecutions})`);
  });

  // Expose internal state for testing
  function showState(label) {
    const state = {
      dirty: automator.stateDirty,
      moratorium: automator.moratoriumActive,
      timerActive: automator.moratoriumTimer !== null
    };
    console.log(`  ${label}:`);
    console.log(`    Dirty: ${state.dirty}`);
    console.log(`    Moratorium: ${state.moratorium}`);
    console.log(`    Timer: ${state.timerActive ? 'running' : 'stopped'}`);
    return state;
  }

  try {
    // TEST 1: CRUD saves immediately
    log('CRUD operation should save immediately and start moratorium');
    const beforeAdd = getFileModTime();

    automator.addTask({
      name: 'Test Task 1',
      cmd: 'testCmd',
      date: new Date(Date.now() + 60000),
      payload: { msg: 'Task 1 (future)' }
    });

    await wait(50);
    const afterAdd = getFileModTime();
    const state1 = showState('After CRUD');

    console.log(`  ✓ File exists: ${afterAdd !== null}`);
    console.log(`  ✓ File was written: ${afterAdd > (beforeAdd || 0)}`);
    console.log(`  ✓ State is clean: ${!state1.dirty}`);
    console.log(`  ✓ Moratorium started: ${state1.moratorium}`);

    // TEST 2: Task execution during moratorium
    log('Task execution DURING moratorium should mark dirty but NOT save immediately');

    // Start automator
    automator.start();

    // Add a task that executes soon (while moratorium is still active)
    automator.addTask({
      name: 'Quick Task',
      cmd: 'testCmd',
      date: new Date(Date.now() + 500),
      payload: { msg: 'Quick execution' }
    });

    await wait(50);
    showState('After adding quick task (still in moratorium from previous CRUD)');

    // Capture file time before task executes
    const beforeTaskExec = getFileModTime();

    // Wait for task to execute
    await wait(600);

    // Check state immediately after execution
    const afterTaskExec = getFileModTime();
    const state2 = showState('After task execution (still in moratorium)');

    console.log(`  ✓ Task executed: ${taskExecutions === 1}`);
    console.log(`  ✓ File NOT modified by task execution: ${afterTaskExec === beforeTaskExec}`);
    console.log(`  ✓ State marked dirty: ${state2.dirty}`);
    console.log(`  ✓ Still in moratorium: ${state2.moratorium}`);

    // TEST 3: Moratorium expiration triggers save
    log('After moratorium expires, dirty state should trigger automatic save');
    console.log('  Waiting for moratorium to expire (~1.5 more seconds)...');

    const beforeExpire = getFileModTime();

    // Wait for moratorium to expire (2s total from last CRUD, ~1.5s remaining)
    await wait(1700);

    const afterExpire = getFileModTime();
    const state3 = showState('After moratorium expired');

    console.log(`  ✓ File was saved: ${afterExpire > beforeExpire}`);
    console.log(`  ✓ State is clean: ${!state3.dirty}`);
    console.log(`  ✓ New moratorium started: ${state3.moratorium}`);

    // TEST 4: Multiple rapid CRUDs
    log('Multiple rapid CRUD operations should each save and restart moratorium');

    // Wait for current moratorium to expire first
    await wait(2200);
    showState('Before rapid CRUDs (no moratorium)');

    const times = [];

    for (let i = 1; i <= 3; i++) {
      automator.addTask({
        name: `Rapid Task ${i}`,
        cmd: 'testCmd',
        date: new Date(Date.now() + 60000),
        payload: { msg: `Rapid ${i}` }
      });
      await wait(50);
      times.push(getFileModTime());
      console.log(`  → CRUD ${i}: file time = ${times[i-1]}`);
      await wait(500); // Wait 0.5s between CRUDs (less than 2s moratorium)
    }

    showState('After rapid CRUDs');

    console.log(`  ✓ Each CRUD saved: ${times[1] > times[0] && times[2] > times[1]}`);
    console.log(`  ✓ Moratorium active after last CRUD: ${automator.moratoriumActive}`);

    // TEST 5: Stop while dirty
    log('Stop() while dirty should force immediate save');

    // Wait for moratorium to expire
    await wait(2200);

    // Execute a task to make state dirty
    automator.addTask({
      name: 'Final Task',
      cmd: 'testCmd',
      date: new Date(Date.now() + 200),
      payload: { msg: 'Final execution' }
    });

    await wait(50);
    showState('After adding final task');

    // Wait for task to execute during moratorium
    await wait(250);

    const beforeStop = getFileModTime();
    showState('Before stop (should be dirty from task execution)');

    // Stop automator
    automator.stop();

    await wait(50);
    const afterStop = getFileModTime();
    const state5 = showState('After stop');

    console.log(`  ✓ State was dirty before stop: ${taskExecutions >= 2}`);
    console.log(`  ✓ File saved on stop: ${afterStop > beforeStop}`);
    console.log(`  ✓ State clean after stop: ${!state5.dirty}`);
    console.log(`  ✓ Timer cancelled: ${!state5.timerActive}`);

    console.log('\n=== All Tests Complete ===');
    console.log(`Total task executions: ${taskExecutions}\n`);

  } catch (error) {
    console.error('\n✗ Test failed:', error);
    console.error(error.stack);
    automator.stop();
  }
}

runTests().catch(console.error);
