Below is the **“Details & Lessons Learned”** document.
This is written as if it were internal engineering guidance for an LLM or human developer performing a *clean-room rewrite* of jw-automator v2.

It avoids constraining architecture choices *too tightly*, but ensures that nothing subtle or critical is lost and that all underlying pitfalls, invariants, and important behaviors are understood.

This document is not a README — it is a **technical context brief** for the implementer.

---

# 🧩 **jw-automator v2 — Internal Design Notes & Lessons Learned**

### *Engineering considerations, pitfalls, invariants, and conceptual constraints for implementers*

---

# ❗️ Purpose of this Document

This document explains **why jw-automator behaves the way it does**, and what subtle requirements the implementation must preserve. It is meant for an **LLM coder or human developer** who is performing a clean-room rewrite based on the public README, ensuring they don’t fall into common traps or inadvertently remove critical behaviors.

This is **not** an architecture specification and **not** a code scaffold — it is a **mental map of the problem space**, including:

* Timekeeping semantics
* Recurrence logic
* DST transitions
* Offline behavior
* Correctness invariants
* Simulation requirements
* Performance constraints
* Anti-patterns that must be avoided

An implementer should read this **before** writing code.

---

# 🧭 1. High-Level Philosophy

## “Correctness > Precision, Predictability > Cleverness.”

jw-automator is designed for small devices and home automation systems where the **real world is messy**:

* The event loop may freeze or stall.
* A machine may be offline for minutes or hours.
* File reads may block for 200ms on a Raspberry Pi.
* DST changes break naïve time computations.
* Users expect 24 readings per day, not 23 or 25.

The scheduler’s job is **not** to be hyper-precise in real time — it is to provide **logical continuity**.

Thus:

* **1-second granularity** is intentional and stabilizes behavior.
* **Drift correction** is intentional.
* **Catch-up simulation** is intentional.
* **Local-time-first** semantics are intentional.
* **Actions as data** is intentional.

The implementation must reflect this philosophy.

---

# ⏱ 2. Core Timing Model

## The scheduler tick is always **exactly 1 second**, aligned to real clock seconds.

* No floating schedule.
* No long sleeps.
* No per-action timers.

The host should:

* Compute: `wait = 1000 - now.getMilliseconds()`
* Sleep for that.
* Tick on whole-second boundaries.

This ensures:

* No cumulative drift.
* All actions check against stable second boundaries.
* Deterministic simulation is possible.

Alternative designs (priority queue / sleep-to-next-run) are allowed **only if they preserve 1-second alignment**.

---

# 🕰 3. Local Time is Fundamental

## The recurrence model uses **local wall-clock time**, not UTC.

This enables rules like:

* “Every day at 7:00 am”
* “Every weekday at 9:15”
* “Every weekend at 10:00”
* “The first of every month”

Explicitly **do not** convert recurrence rules to UTC-based timestamps.
Local time **must** remain the “source of truth.”

Why:

* Users expect behavior tied to human timekeeping.
* DST transitions only make sense in local time.
* Weekday/weekend logic depends on local date.

Even if the engine stores some internal UTC values for safety, **all recurrence must occur in local-time space**.

---

# ⏳ 4. Recurrence Logic Must Be Step-Driven

## The core algorithm for advancing an action must be:

```
while action.nextRun < now:
    optionally execute
    action.nextRun = next recurrence after previous nextRun
```

This is **not optional**.

Why this matters:

* Allows offline catch-up.
* Ensures logical continuity (60 readings per hour).
* Permits count-based patterns.
* Enables simulation of future schedules.
* Avoids loss of recurrence information.

Implementers **must not** switch to “rule matches now” cron logic.

---

# 🌀 5. Avoiding Infinite Loops

This was the single largest bug in the original implementation.

Implementers **must guarantee**:

> Every call to `getNextActionTime(oldTime)` returns a `Date` strictly greater than `oldTime` *in UTC milliseconds*.

A safe invariant:

```
nextRun.getTime() > oldRun.getTime()
```

If a recurrence rule or DST adjustment would cause this not to be true:

* Apply a forward correction (add 1 second or offset delta).
* Never move time backwards.

Additionally, inside the “while dateOld” loop, implement:

* A max-iteration safety counter.
* Error event or warning if exceeded.

---

# 🍁 6. DST Handling

DST is the scheduler’s trickiest domain.

## Spring Forward (missing hour)

Example: 2:00 → 3:00 skips.

Implementer must:

* Simulate past occurrences based on recurrence.
* Buffered: execute once.
* UnBuffered: do not execute, but still advance recurrence.

## Fall Back (repeated hour)

Example: 2:00 → 1:00 repeats.

Two identical local times exist:

* 01:30 (DST)
* 01:30 (Standard)

Implementer must support:

```
dstPolicy: 'once'  => run only the first instance
dstPolicy: 'twice' => run both
```

Important:

* Recurrence must detect repeated local times.
* Never confuse “old nextRun” with “new nextRun” across offset boundaries.
* Never treat the repeated hour as an infinite loop.

Correct behavior requires careful accounting:

* Compare local time fields (year, month, day, hour, minute).
* Use offset changes only to detect DST boundaries, not as absolute truth.

---

# 🔧 7. Buffered vs. UnBuffered

This behavior is subtle and essential:

### Buffered (`unBuffered: false`)

If an action is scheduled at time T, and the system wakes at T+d:

* The action must execute **once**, as if the system were offline.

### UnBuffered (`unBuffered: true`)

Missed events are:

* **Not** executed,
* But their occurrence is still **advanced** in the recurrence chain.

This ensures:

* No “burst storms” of offline executions.
* Rate-limiting chains (e.g. animations) behave predictably.

Implementers must preserve this logic exactly.

---

# 📦 8. Action Structure: Spec vs. State

In v2, an action has:

### Spec (User-defined)

* `name`
* `cmd`
* `payload`
* `unBuffered`
* `repeat` block (type, interval, limit, endDate, dstPolicy)

### State (Engine-managed)

* `nextRun`
* `count`
* `id`

The implementation must cleanly separate:

* **Stable parts** (spec)
* **Mutable progress** (state)

Why:

* Allows introspection.
* Allows meta-actions to manipulate count safely.
* Improves persistence clarity.
* Reduces bugs when updating actions.

---

# 🧠 9. Meta-Actions & Dynamic Scheduling

A unique feature of jw-automator:

> Actions can safely create, modify, or cancel other actions.

This is a supported pattern and must be preserved.

This means:

* The API must allow updating an action’s `repeat.count` intentionally.
* Action mutation during event handling must not corrupt scheduler state.
* The engine must operate deterministically even when actions modify themselves or others.

---

# 🔍 10. Simulation Requirements

The simulation API (`getActionsInRange`) must produce:

* A list of all scheduled occurrences between two dates.
* In chronological order.
* Based on the **exact same** step logic as the real engine.
* Without mutating real scheduler state.

Simulation must:

* Use a cloned state.
* Drive the cloned state through a virtual time loop.
* Apply all DST rules.
* Apply all recurrence logic.
* Apply count/limit/endDate.

Simulation **must not** rely on cron-like matching.

---

# 📉 11. Performance & Safety Constraints

Even on low-power devices:

* Per-tick work must be bounded.
* Inner recurrence loops must have safety guards.
* No tick may consume unbounded CPU.
* Recurrence computations must be O(1) per step.
* No re-parsing or re-analysis of recurrence rules every tick.

Additionally:

* Ticks must not drift: `nextTick = 1000 - now.ms`.
* Drift correction should be explicit and stable.

---

# 🗄 12. Persistence Layer Must Be Pluggable

The engine must not directly perform:

* File I/O
* Database I/O
* External writes

Instead:

Implementers should define a **storage interface**:

```
storage.load()  -> initial state
storage.save(state) -> persists state
```

The host may use:

* JSON file
* Memory
* IndexedDB
* A cloud service

The core engine must remain pure and environment-agnostic.

---

# 📡 13. Observability

jw-automator must emit:

* `ready`
* `action` (with id, name, scheduled time, actual time, count)
* `debug`
* `error`
* `update` (action added/updated/removed)

Events are key to:

* Debugging
* Logging
* User UIs
* Third-party integrations

Implementers must provide:

* Rich structured payloads
* Consistent field naming
* Human-readable formatting for debugging

---

# 🧪 14. Determinism and Testability

The step function must be:

* Deterministic
* Pure with respect to inputs
* Easily testable

Tests should be able to:

* Pass in `state`, `lastTick`, and fictitious timestamps.
* Assert on returned `events` and new state.
* Drive edge cases like DST transitions, offline gaps, large limit counters.

---

# 🚫 15. Anti-Goals (What Must *Not* Be Done)

1. **Do not** use cron-like matching (“does rule match now?”).
   → Breaks catch-up, simulation, count-based logic, DST semantics.

2. **Do not** rely solely on UTC for recurrence.
   → Loses local-time anchors and weekday logic.

3. **Do not** collapse missed intervals into “run now only.”
   → Breaks “60 readings/hour” continuity.

4. **Do not** allow `nextRun <= old nextRun` return values.
   → Causes hangs.

5. **Do not** mix spec and state fields.
   → Harder to inspect, mutate safely, or persist.

6. **Do not** assume the event loop is reliable.
   → Must tolerate multi-second stalls.

7. **Do not** enforce millisecond precision.
   → Design choice is 1-second granularity.

---

# 📘 16. Suggested Internal Architecture (High-Level)

Not a blueprint, just recommended structure:

```
Automator
 ├─ CoreEngine     (pure: step())
 ├─ SchedulerHost  (1-second timer, aligned ticks)
 ├─ ActionStore    (in-memory list + persistence adapter)
 ├─ EventEmitter   (Node-style)
 ├─ Simulation     (uses CoreEngine on cloned state)
 └─ API Layer      (add/update/remove, introspection)
```

The developer is free to choose naming and organization as long as core invariants are preserved.

---

# 🧬 17. Summary of “Must-Preserve” Behaviors

To avoid unintentional regression, the implementer must ensure:

* **Local-time recurrence** always respected
* **DST fall-back** supports `once` and `twice`
* **Spring-forward** behaves with buffered/unBuffered semantics
* **Offline catch-up** works identically to real-time execution
* **Step-based simulation** preserved
* **1-second tick alignment** preserved
* **Guaranteed monotonic `nextRun`**
* **State/spec separation**
* **Meta-actions work**
* **Pluggable storage**
* **Structured event payloads**
* **Deterministic step**

These are critical for jw-automator’s identity and reliability.

---

# ⚙️ 18. Implementation Notes to the Developer

You do *not* have to implement:

* The same variable names
* The same function layout
* Identical architecture

You *must* implement:

* The semantic contract the README and this document describe
* The invariants here
* All edge-case handling
* Equivalent user-visible behavior

As long as these invariants hold, implementation freedom is encouraged.

---

# 🎉 Final Thought

jw-automator has a subtly powerful model: it behaves like a small automation *runtime* rather than a cron-like trigger checker. The original version solved real-world problems with a surprisingly elegant pattern (step-based simulation).
The purpose of v2 is not to reinvent the library — it is to **clarify its behaviors**, remove sharp edges, and implement it cleanly and robustly so future contributors (LLM or human) can reason about the system with confidence.