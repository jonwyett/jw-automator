# Architecture Overview (v4)

## jw-automator v4 Architecture

This document describes the internal architecture of jw-automator v3.

---

## Design Principles

1. **Correctness over Precision**: Reliable 1-second scheduling beats unreliable sub-second timing
2. **Local Time First**: Human-centric time semantics, not UTC-based
3. **Deterministic Core**: Pure step function enables testing and simulation
4. **Resilience**: Survive offline gaps, DST transitions, and event loop stalls
5. **Separation of Concerns**: Spec vs. state, core vs. host, persistence strategy

---

## Component Architecture

```
┌─────────────────────────────────────────┐
│           Automator (API)               │
│  - User-facing API                      │
│  - Event management                     │
│  - Task CRUD operations                 │
│  - Moratorium-based persistence         │
└──────────────┬──────────────────────────┘
               │
               │
               │
        ┌──────▼──────┐
        │SchedulerHost│
        │             │
        │ - 1-sec tick│
        │ - Event emit│
        │ - Functions │
        └──────┬──────┘
               │
┌──────────────▼──────────────────────┐
│         CoreEngine                  │
│                                     │
│  step(state, lastTick, now)         │
│    → { newState, events }           │
│                                     │
│  - Deterministic                    │
│  - Pure function                    │
│  - Testable                         │
└──────────────┬──────────────────────┘
               │
        ┌──────▼────────┐
        │RecurrenceEngine│
        │                │
        │ - Next occurrence calc │
        │ - DST handling         │
        │ - Local-time logic     │
        └────────────────┘
```

---

## Core Components

### 1. CoreEngine (`src/core/CoreEngine.js`)

**Purpose**: Pure scheduling logic

**Responsibilities**:
- Process scheduling steps
- Manage catch-up logic
- Emit task events
- Enforce safety invariants (max iterations, monotonic time)

**Key Method**: `step(state, lastTick, now)`
- Input: Current state, previous tick time, current time
- Output: New state and array of events
- Guarantees: Pure, deterministic, no side effects

**Key Method**: `simulate(state, startDate, endDate)`
- Simulates scheduling without mutating state
- Used for preview/introspection

---

### 2. RecurrenceEngine (`src/core/RecurrenceEngine.js`)

**Purpose**: Calculate next occurrence times

**Responsibilities**:
- Implement recurrence types (second, minute, hour, day, weekday, weekend, week, month, year)
- Handle DST transitions
- Enforce monotonic time progression
- Check stop conditions (limit, endDate)

**Key Method**: `getNextOccurrence(currentTime, repeat, dstPolicy)`
- Input: Current scheduled time, repeat config, DST policy
- Output: Next scheduled time (always > current in UTC milliseconds)
- Guarantees: Monotonic progression, DST-aware

**Critical Invariant**: `nextTime.getTime() > currentTime.getTime()`

---

### 3. SchedulerHost (`src/host/SchedulerHost.js`)

**Purpose**: Real-time scheduling host

**Responsibilities**:
- Manage 1-second aligned ticking
- Drive CoreEngine with wall-clock time
- Execute command functions
- Emit events to listeners

**Tick Alignment**:
```javascript
const wait = 1000 - now.getMilliseconds();
setTimeout(() => tick(), wait);
```

**Why?**
- Prevents cumulative drift
- Ensures all tasks check against stable boundaries
- Enables deterministic simulation

---

### 4. Persistence (v5+)

**Purpose**: State persistence with minimal disk wear

**Implementation**: Integrated directly into Automator class

**Strategy**: Moratorium-based state machine
- CRUD operations (add/update/remove) save immediately and start moratorium period
- Task execution marks state dirty and saves if moratorium has expired
- If moratorium is active, dirty state waits until moratorium ends, then saves automatically
- Single entry point: `_requestSave(force)` with "tell vs ask" semantics
- `saveInterval` defines the moratorium period (minimum cooling time, default: 15 seconds)
- `stop()` forces save if dirty, ignoring any active moratorium
- No periodic polling - one-shot timer only fires when state is dirty

**State Machine**:
- `stateDirty`: Boolean flag indicating unsaved changes
- `moratoriumActive`: Boolean flag indicating cooling period is active
- `moratoriumTimer`: One-shot setTimeout handle (not setInterval)

**Files**:
- File-based: `storageFile` option specifies JSON file path
- Memory-only: No `storageFile` option

**Custom Persistence**: Use `getTasks()` and event listeners for database/cloud storage

---

### 5. Automator (`src/Automator.js`)

**Purpose**: Main API class

**Responsibilities**:
- Coordinate all components
- Provide user-facing API
- Manage task lifecycle
- Handle auto-save
- Event emission

**Key APIs**:
- Task management: `addTask`, `updateTaskByID`, `updateTaskByName`, `removeTaskByID`, etc.
- Function registration: `addFunction`, `removeFunction`
- Introspection: `getTasks`, `describeTask`, `getTasksInRange`
- Lifecycle: `start`, `stop`

---

## Data Flow

### Adding a Task

```
User calls addTask()
    ↓
Automator validates spec
    ↓
Creates task with ID and state
    ↓
Adds to SchedulerHost state
    ↓
Emits 'update' event
    ↓
Triggers auto-save (if enabled)
```

### Tick Execution

```
SchedulerHost timer fires
    ↓
Calls CoreEngine.step(state, lastTick, now)
    ↓
CoreEngine processes each task:
  - Is nextRun <= now?
  - Buffered/unbuffered logic
  - Execute or skip
  - Advance recurrence (RecurrenceEngine)
  - Check stop conditions
    ↓
Returns { newState, events }
    ↓
SchedulerHost updates state
    ↓
SchedulerHost executes task events:
  - Call registered function
  - Emit 'task' event
    ↓
Schedule next tick
```

### Simulation

```
User calls getTasksInRange(start, end)
    ↓
CoreEngine.simulate() clones state
    ↓
Steps through time second-by-second
    ↓
Collects all task events
    ↓
Returns event list (state unchanged)
```

---

## Key Design Decisions

### Why 1-Second Granularity?

- **Reliability**: Event loops can stall, file I/O can block
- **Stability**: No cumulative drift
- **Simplicity**: Easier to reason about
- **Target Environment**: Small devices, Raspberry Pi, etc.

### Why Local Time?

- **Human Semantics**: "7 AM" means local 7 AM
- **Weekday Logic**: Monday means local Monday
- **DST Handling**: Only makes sense in local context

### Why Step Function?

- **Deterministic**: Same inputs → same outputs
- **Testable**: No time dependency
- **Simulatable**: Preview future schedules
- **Catch-up**: Process offline gaps identically to real-time

### Why `catchUpWindow` (and Legacy Buffered/UnBuffered)?

The `catchUpWindow` property, supported by the CoreEngine, precisely defines the time window for recovering missed tasks.

- **Smart Defaults**: For recurring tasks, the `catchUpWindow` defaults to the task's interval (e.g., a 1-hour task has a 1-hour catch-up window). For one-time tasks, it defaults to `0` (no catch-up). This prevents "thundering herd" issues by ensuring that tasks too old are simply skipped.
- **Explicit Control**: Users can still set `catchUpWindow` to `0` (skip all missed), a specific millisecond value (tolerate N ms lag), or `"unlimited"` (catch up all, like old buffered behavior).
- **Legacy `unBuffered`**: The `unBuffered` flag (`true` or `false`) is now a legacy alias for `catchUpWindow: 0` and `catchUpWindow: "unlimited"` respectively. The system transparently maps it.

---

## Safety Mechanisms

### 1. Infinite Loop Prevention

- Maximum iteration limit per tick (default 10,000)
- Error event emitted if exceeded
- Monotonic time guarantee: `next.getTime() > current.getTime()`
- Forward correction if violation detected

### 2. DST Handling

**Spring Forward** (missing hour):
- Naturally handled by Date arithmetic
- Buffered: execute once after jump
- UnBuffered: skip silently

**Fall Back** (repeated hour):
- `dstPolicy: 'once'`: skip second occurrence
- `dstPolicy: 'twice'`: run both

### 3. State Integrity

- Tasks cloned before mutation
- Spec vs. state separation
- Deep copies returned from getters
- Auto-save with configurable intervals

---

## Performance Characteristics

- **Per-Tick Complexity**: O(n) where n = number of tasks
- **Recurrence Calculation**: O(1) per step
- **Memory**: O(n) for task storage
- **Disk I/O**: Dirty-flag with cooling period (default: 15s minimum between saves)

**Scalability**: Designed for 10-1000 tasks, not 100,000s

---

## Extension Points

### Custom Persistence

Use `getTasks()` and event listeners for database/cloud storage:

```javascript
const automator = new Automator(); // Memory-only

automator.seed(async (auto) => {
  const tasks = await loadFromDatabase();
  tasks.forEach(task => auto.addTask(task));
});

automator.on('update', async () => {
  const tasks = automator.getTasks();
  await saveToDatabase(tasks);
});
```

### Custom Recurrence Types

Extend `RecurrenceEngine` with new types (requires code modification)

### Meta-Tasks

Tasks can call `automator.addTask()` to create dynamic schedules

---

## Testing Strategy

1. **Unit Tests**: RecurrenceEngine, CoreEngine isolated
2. **Integration Tests**: Automator API end-to-end
3. **Deterministic Tests**: Use fixed dates, no real time passing
4. **Simulation Tests**: Verify step and simulate produce same results
5. **DST Tests**: Specific scenarios for spring/fall transitions

---

## Future Enhancements

Potential improvements for future versions:

- TypeScript definitions
- Timezone support (explicit tz parameter)
- Cron expression compatibility layer
- Web-based dashboard
- Task priorities
- Conditional execution (predicates)
- Task dependencies (chains)

---

For implementation details, see the inline code documentation.
