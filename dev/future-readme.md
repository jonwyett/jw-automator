Absolutely — here is a **clean, comprehensive, “aspirational v2 README”** for jw-automator.

It is written **as if the rewrite has already happened**, describing a polished, fully realized library that implements everything we’ve discussed:

* 1-second engine tick
* Local-time calendar semantics
* Complex recurrence rules
* DST-aware behavior with user-selectable policies
* Offline catch-up
* Buffered/unBuffered semantics
* Meta-actions
* Pluggable persistence
* A clean, testable core step engine
* Strong ergonomics
* Action spec/state separation
* Full observability
* Node-friendly API, browser-friendly design
* No weird null/falsy confusion

And written in the tone of a professional open-source project aiming for clarity, completeness, and developer confidence.

---

# 📚 **jw-automator v2**

### A resilient, local-time, 1-second precision automation scheduler for Node.js

**Human-friendly recurrence rules. Offline catch-up. DST-safe. Predictable. Extensible.**

---

## ⭐️ Overview

**jw-automator** is a robust automation engine designed for small devices, home automation hubs, personal servers, and Node.js environments where **correctness, resilience, and local-time behavior** matter more than millisecond precision.

Where traditional cron falls short — missed executions, poor DST handling, limited recurrence, lack of catch-up semantics — **jw-automator** provides a predictable, human-centric scheduling model:

* **1-second granularity** with zero drift
* **Local calendar semantics** (weekday/weekend, monthly, yearly)
* **Configurable DST policies** (fall-back once/twice)
* **Offline resiliency & catch-up logic**
* **Buffered/unBuffered execution policies**
* **Rich introspection and event lifecycle**
* **Meta-actions** that can dynamically create/update other actions
* **Pluggable persistence** (file, memory, custom storage)
* **Deterministic step engine** suitable for simulation/testing

This makes jw-automator ideal for:

* Small Raspberry Pi home automation hubs
* IoT applications
* Sensor sampling / periodic readings
* Daily/weekly routines
* “Smart home” orchestrations
* Systems that must *survive restarts, reboots, offline gaps, and DST transitions*

jw-automator v2 is a **clean-room re-architecture** of the original library, keeping its best ideas while formalizing its semantics, improving correctness, and providing a crisp developer experience.

---

# 🚀 Features

## 1. **True 1-Second Precision**

* Scheduler tick interval is fixed at **1 second**.
* Execution times are aligned to the nearest whole second.
* No promise of sub-second timing (by design).
* Ideal for low-power hardware prone to event-loop delays.

> **Why?**
> A scheduler that *promises less* is dramatically more reliable.

---

## 2. **Human-Friendly Recurrence Rules**

Each action can specify a recurrence like:

```js
repeat: {
  type: 'weekday',      // or: second, minute, hour, day, week,
                        //      month, year, weekend
  interval: 1,          // every N occurrences
  limit: null,          // optional max count
  endDate: null,        // optional cutoff date
  dstPolicy: 'once',    // or 'twice'
}
```

Examples:

* Every day at 7:00 AM
* Every 15 minutes
* Every weekend at 10:00
* Every month on the 1st
* Every weekday at market open
* Once per second for 5 minutes (limit-based)

---

## 3. **Local-Time First, DST-Aware**

jw-automator’s recurrence rules operate in **local wall-clock time**, not UTC.

This means:

* “7:00 AM” always means **local** 7:00 AM.
* Weekdays/weekends follow the user’s locale.
* DST transitions are **explicit and predictable**:

  * **Spring forward:** missing hour handled via buffered/unBuffered rules
  * **Fall back:** user chooses `dstPolicy: 'once' | 'twice'`

This avoids cron’s silent-but-surprising behaviors.

---

## 4. **Resilient Offline Catch-Up**

If the device is offline or delayed (e.g., blocked by CPU load):

```js
unBuffered: false   // default: catch up missed executions
unBuffered: true    // skip missed executions
```

For example:

* A job scheduled at 09:00 will still run when the device restarts at 10:00 (if buffered).
* A sequence of per-second readings will “compress” naturally after a delay.

This feature is ideal for:

* Home automation logic (“turn heater off at 9 even if offline”)
* Sensor sampling
* Data collection pipelines

---

## 5. **Deterministic “Step Engine”**

The heart of jw-automator is a pure scheduling primitive:

```
step(state, lastTick, now) → { newState, events }
```

This powers:

* Real-time ticking
* Offline catch-up
* Future schedule simulation
* Testing
* Meta-scheduling (actions that schedule other actions)

Because `step` is deterministic, you can:

* Test schedules without time passing
* Generate “what would happen tomorrow”
* Debug recurrence rules
* Build custom visual schedulers

---

## 6. **Meta-Actions (Actions that Create Actions)**

jw-automator treats actions as **data**, enabling higher-order patterns:

* A daily 7:00 AM action can spawn a sequence of 60 one-per-second actions.
* A monthly billing action can create daily reminder actions.
* A multi-step animation (e.g., dimming a light) can create timed sub-actions.

Actions have a `repeat.count` that can be pre-set or manipulated intentionally.

This makes jw-automator more like a *mini automation runtime* than just a cron clone.

---

## 7. **Powerful Introspection & Simulation**

### Get scheduled action instances:

```js
automator.getActionsInRange(startDate, endDate, function(list) {
  console.log(list);
});
```

### Query state:

```js
automator.getActions();        // deep copy of internal state  
automator.describeAction(id);  // formatted, human-readable summary
```

### Event lifecycle:

* `ready`
* `action`
* `update`
* `error`
* `debug`

---

## 8. **Pluggable Persistence**

You may choose to store scheduler state:

* On the local filesystem (`actions.json`)
* In memory
* In a database
* In Redis
* In a cloud KV store

jw-automator v2 provides a persistence interface:

```js
new Automator({
  storage: Automator.storage.file('actions.json')
});
```

Or custom:

```js
new Automator({
  storage: {
    load: function() { ... },
    save: function(actions) { ... }
  }
});
```

---

## 9. **Simple, Predictable API**

### Create an automator

```js
const automator = new Automator({
  storage: Automator.storage.file('./actions.json')
});

automator.start();
```

### Register functions

```js
automator.addFunction('turnLightOn', function(payload) {
  console.log('Turning light on');
});
```

### Add actions

```js
automator.addAction({
  name: 'Morning Lights',
  cmd: 'turnLightOn',
  date: new Date('2025-05-01T07:00:00'),
  payload: null,
  unBuffered: false,
  repeat: {
    type: 'day',
    interval: 1,
    limit: null,
    endDate: null,
    dstPolicy: 'once'
  }
});
```

### Update or remove actions

```js
automator.updateActionByID(id, newSpec);
automator.removeActionByName('Morning Lights');
```

---

## 10. **Graceful Overload Behavior**

* Infinite-loop proof (guarded by strict invariants)
* Bounded per-tick execution steps
* Guaranteed monotonic `nextRun` timestamps

If a schedule would cause pathological behavior, jw-automator logs robust errors and continues safely.

---

## 11. **Environment-Agnostic Core**

The step engine is environment-independent:

* Works identically in Node, browsers, or embedded JS
* Only host layer handles timers + persistence
* Easy to wrap for UI tools, schedulers, dashboards, etc.

---

# 📐 Action Specification (Full Schema)

### Top-level action fields:

| Field        | Description                                       |
| ------------ | ------------------------------------------------- |
| `id`         | Unique internal identifier                        |
| `name`       | User label (optional)                             |
| `cmd`        | Name of registered function to execute            |
| `payload`    | Data passed to the command                        |
| `date`       | Next scheduled run time (local `Date`)            |
| `unBuffered` | Skip missed events (`true`) or catch up (`false`) |

### Repeat block:

| Field       | Description                       |
| ----------- | --------------------------------- |
| `type`      | Recurrence unit                   |
| `interval`  | Nth occurrence                    |
| `limit`     | Number of times to run, or `null` |
| `endDate`   | Max date, or `null`               |
| `count`     | Execution counter (advanced use)  |
| `dstPolicy` | `'once'` or `'twice'`             |

---

# 📊 Example: Sensor Reading Every Second

```js
automator.addAction({
  name: 'TempSensor',
  cmd: 'readTemp',
  date: null,            // run immediately
  payload: null,
  unBuffered: false,     // catch up if delayed
  repeat: {
    type: 'second',
    interval: 1
  }
});
```

If the system stalls:

* At 00:00:00 → reading #1
* Heavy load → no ticks for 5 seconds
* At 00:00:06 → automator triggers readings #2–#6, advancing schedule

Your “60 readings per minute” pattern is preserved logically.

---

# 🕰 DST Behavior Examples

### Fall Back (Repeated Hour)

07:30 happens twice:

```
1) 07:30 (EDT)
2) 07:30 (EST)
```

User chooses:

* `dstPolicy: 'twice'` → run both
* `dstPolicy: 'once'` → run only the first instance

### Spring Forward (Missing Hour)

02:30 does not exist.

* Buffered → run as soon as possible after the jump
* Unbuffered → skip silently

---

# 🧪 Simulation

```js
automator.simulateRange('2025-05-01', '2025-05-07');
```

Gives an ordered list of events that *would occur* in the range.

Ideal for:

* UI calendars
* Debugging
* Previews
* Testing

---

# 🧱 Architecture Summary

* **Core Engine:** Pure state machine (`step()`).
* **Host Layer:** Manages real timers and event emission.
* **Storage Layer:** Pluggable, environment-specific.
* **Actions:** Declarative data structures.
* **Commands:** User-registered function map.

---

# 📦 Installation

```bash
npm install jw-automator
```

---

# 🎯 Project Goals (v2)

* Deterministic behavior
* Rock-solid DST handling
* Predictable local-time recurrence
* Resilience to offline and delays
* Developer-friendly ergonomics
* Suitable for small devices
* Approachable but powerful API
* Long-term maintainability

---

# ❤️ Acknowledgments

jw-automator v2 is a ground-up rethinking of the original jw-automator library, preserving the spirit while strengthening the foundations.

If you're building automation logic and want predictable, human-friendly scheduling that survives the real world — **welcome.**

---

If you'd like, I can now produce **Document #2: the internal “Design Details & Lessons Learned for LLM implementers”** — the one meant to guide the coder *without* constraining creativity, but ensuring no subtle requirements (especially DST and simulation) get lost.
