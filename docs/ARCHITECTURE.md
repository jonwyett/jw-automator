# Architecture Overview (v4)

## jw-automator v4 Architecture

This document describes the internal architecture of jw-automator v3.

---

## Design Principles

1. **Correctness over Precision**: Reliable 1-second scheduling beats unreliable sub-second timing
2. **Local Time First**: Human-centric time semantics, not UTC-based
3. **Deterministic Core**: Pure step function enables testing and simulation
4. **Resilience**: Survive offline gaps, DST transitions, and event loop stalls
5. **Separation of Concerns**: Spec vs. state, core vs. host, storage abstraction

---

## Component Architecture

```
┌─────────────────────────────────────────┐
│           Automator (API)               │
│  - User-facing API                      │
│  - Event management                     │
│  - Action CRUD operations               │
│  - Persistence coordination             │
└──────────────┬──────────────────────────┘
               │
        ┌──────┴──────┐
        │             │
┌───────▼──────┐  ┌──▼──────────────┐
│ SchedulerHost│  │ Storage Adapter │
│              │  │                 │
│ - 1-sec tick │  │ - load()        │
│ - Event emit │  │ - save()        │
│ - Functions  │  └─────────────────┘
└───────┬──────┘
        │
┌───────▼──────────────────────────┐
│         CoreEngine               │
│                                  │
│  step(state, lastTick, now)      │
│    → { newState, events }        │
│                                  │
│  - Deterministic                 │
│  - Pure function                 │
│  - Testable                      │
└──────────┬───────────────────────┘
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
- Emit action events
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
- Ensures all actions check against stable boundaries
- Enables deterministic simulation

---

### 4. Storage Adapters

**Purpose**: Pluggable persistence

**Interface**:
```javascript
{
  load: () => state,
  save: (state) => void
}
```

**Built-in Adapters**:
- `FileStorage`: JSON file persistence
- `MemoryStorage`: In-memory (no persistence)

**Custom Adapters**: Users can provide their own (database, cloud, etc.)

---

### 5. Automator (`src/Automator.js`)

**Purpose**: Main API class

**Responsibilities**:
- Coordinate all components
- Provide user-facing API
- Manage action lifecycle
- Handle auto-save
- Event emission

**Key APIs**:
- Action management: `addAction`, `updateActionByID`, `updateActionByName`, `removeActionByID`, etc.
- Function registration: `addFunction`, `removeFunction`
- Introspection: `getActions`, `describeAction`, `getActionsInRange`
- Lifecycle: `start`, `stop`

---

## Data Flow

### Adding an Action

```
User calls addAction()
    ↓
Automator validates spec
    ↓
Creates action with ID and state
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
CoreEngine processes each action:
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
SchedulerHost executes action events:
  - Call registered function
  - Emit 'action' event
    ↓
Schedule next tick
```

### Simulation

```
User calls getActionsInRange(start, end)
    ↓
CoreEngine.simulate() clones state
    ↓
Steps through time second-by-second
    ↓
Collects all action events
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

The `catchUpWindow` property, supported by the CoreEngine, precisely defines the time window for recovering missed actions.

- **Smart Defaults**: For recurring actions, the `catchUpWindow` defaults to the action's interval (e.g., a 1-hour action has a 1-hour catch-up window). For one-time actions, it defaults to `0` (no catch-up). This prevents "thundering herd" issues by ensuring that actions too old are simply skipped.
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

- Actions cloned before mutation
- Spec vs. state separation
- Deep copies returned from getters
- Auto-save with configurable intervals

---

## Performance Characteristics

- **Per-Tick Complexity**: O(n) where n = number of actions
- **Recurrence Calculation**: O(1) per step
- **Memory**: O(n) for action storage
- **Disk I/O**: Configurable auto-save interval (default 5s)

**Scalability**: Designed for 10-1000 actions, not 100,000s

---

## Extension Points

### Custom Storage

```javascript
new Automator({
  storage: {
    load: () => loadFromDatabase(),
    save: (state) => saveToDatabase(state)
  }
});
```

### Custom Recurrence Types

Extend `RecurrenceEngine` with new types (requires code modification)

### Meta-Actions

Actions can call `automator.addAction()` to create dynamic schedules

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
- Action priorities
- Conditional execution (predicates)
- Action dependencies (chains)

---

For implementation details, see the inline code documentation.
