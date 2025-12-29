/**
 * IoT Sensor Example - jw-automator v3
 *
 * Demonstrates using jw-automator for sensor reading and data collection
 * typical in IoT and home automation scenarios.
 */

const Automator = require('../index');

// Create automator
const automator = new Automator({
  // Memory-only mode (no persistence)
});

// Simulated sensor data
const sensorData = {
  temperature: 22.5,
  humidity: 45,
  pressure: 1013.25
};

// Simulate sensor reading
function readSensor() {
  sensorData.temperature += (Math.random() - 0.5) * 2;
  sensorData.humidity += (Math.random() - 0.5) * 5;
  sensorData.pressure += (Math.random() - 0.5) * 2;

  return {
    temperature: sensorData.temperature.toFixed(2),
    humidity: sensorData.humidity.toFixed(1),
    pressure: sensorData.pressure.toFixed(2),
    timestamp: new Date()
  };
}

// Register sensor functions
automator.addFunction('readTemperature', function() {
  const reading = readSensor();
  console.log(`[TEMP] ${reading.temperature}°C at ${reading.timestamp.toLocaleTimeString()}`);
});

automator.addFunction('readHumidity', function() {
  const reading = readSensor();
  console.log(`[HUMID] ${reading.humidity}% at ${reading.timestamp.toLocaleTimeString()}`);
});

automator.addFunction('fullSensorSweep', function() {
  const reading = readSensor();
  console.log('\n=== Full Sensor Sweep ===');
  console.log(`Time: ${reading.timestamp.toLocaleString()}`);
  console.log(`Temperature: ${reading.temperature}°C`);
  console.log(`Humidity: ${reading.humidity}%`);
  console.log(`Pressure: ${reading.pressure} hPa`);
  console.log('========================\n');
});

automator.addFunction('dailyReport', function() {
  console.log('\n*** DAILY SENSOR REPORT ***');
  console.log('Generated at:', new Date().toLocaleString());
  console.log('Current readings:', readSensor());
  console.log('Report complete.');
  console.log('***************************\n');
});

// Add sensor reading actions

// 1. Temperature reading every 5 seconds (for 1 minute demo)
automator.addTask({
  name: 'Temperature Reading',
  cmd: 'readTemperature',
  date: new Date(Date.now() + 2000),
  unBuffered: false, // Catch up if delayed
  repeat: {
    type: 'second',
    interval: 5,
    limit: 12 // Stop after 12 readings (1 minute)
  }
});

// 2. Humidity reading every 10 seconds
automator.addTask({
  name: 'Humidity Reading',
  cmd: 'readHumidity',
  date: new Date(Date.now() + 3000),
  unBuffered: false,
  repeat: {
    type: 'second',
    interval: 10,
    limit: 6 // Stop after 6 readings
  }
});

// 3. Full sensor sweep every 30 seconds
automator.addTask({
  name: 'Full Sensor Sweep',
  cmd: 'fullSensorSweep',
  date: new Date(Date.now() + 5000),
  unBuffered: false,
  repeat: {
    type: 'second',
    interval: 30,
    limit: 3 // Stop after 3 sweeps
  }
});

// 4. Daily report at 6:00 AM (won't run in this demo, but shows the pattern)
const tomorrow6AM = new Date();
tomorrow6AM.setDate(tomorrow6AM.getDate() + 1);
tomorrow6AM.setHours(6, 0, 0, 0);

automator.addTask({
  name: 'Daily Report',
  cmd: 'dailyReport',
  date: tomorrow6AM,
  unBuffered: false,
  repeat: {
    type: 'day',
    interval: 1
  }
});

// Events
automator.on('ready', () => {
  console.log('IoT Sensor Monitor Started');
  console.log('================================\n');
});

automator.on('action', (event) => {
  // Actions already log themselves
});

// Start
automator.start();

console.log('Sensor readings starting in 2 seconds...');
console.log('This demo will run for about 90 seconds.\n');

// Auto-stop after 90 seconds
setTimeout(() => {
  console.log('\n\nDemo complete. Stopping automator...');
  automator.stop();

  console.log('\nFinal action summary:');
  automator.getTasks().forEach(action => {
    console.log(`- ${action.name}: ${action.count} executions`);
  });

  process.exit(0);
}, 90000);
