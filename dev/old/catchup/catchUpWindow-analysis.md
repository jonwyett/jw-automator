# catchUpWindow Design Analysis

This document captures the analysis and discussion around the `catchUpWindow` property, its "smart default" behavior, and potential future improvements.

---

## Problem Statement

The current `catchUpWindow` implementation has a "smart default" that sets the window to match the action's recurrence interval when not explicitly specified. While this solves a particular problem elegantly, it creates several issues:

1. **Explicitness Problem**: If the smart default is good behavior, users should be able to explicitly request it rather than being forced to omit the property to "trick" the system.

2. **Magic Behavior**: The behavior is non-obvious and requires reading documentation to understand.

3. **Questionable Universality**: The assumption that `interval = tolerance` may not be correct for all use cases.

---

## Failure Scenarios

Actions can be "missed" for several distinct reasons, each with different implications:

### 1. Event Loop Jitter (milliseconds to seconds)

**Cause**: CPU spike, GC pause, I/O blocking at the exact tick moment

**Characteristics**:
- Brief duration (typically < 5 seconds)
- Affects 1-2 scheduled ticks
- Common and expected in Node.js

**User Expectation**: Almost always want the action to run slightly late rather than be skipped entirely.

### 2. Server Overload (seconds to minutes)

**Cause**: Sustained high CPU/memory usage, blocking operations

**Characteristics**:
- Multiple ticks missed
- System eventually recovers
- May indicate need for optimization

**User Expectation**: Resume from current time, don't replay entire missed period.

### 3. Server Offline (minutes to days)

**Cause**: Crash, reboot, deployment, power outage

**Characteristics**:
- Extended gap in execution
- Complete loss of state (unless persisted)
- Obvious to the user

**User Expectation**: Usually resume fresh. User understands they need to handle the gap manually (e.g., run a manual backup).

---

## The "Blame" Frame

A useful way to think about missed executions is assigning "responsibility":

### Library Responsibility (Our Fault)
- Event loop jitter
- Timer inaccuracy
- Scheduler overhead

**Principle**: We should never be blamed for missed executions due to these factors.

### User Responsibility (Their Fault)
- Server offline
- Resource exhaustion
- Deployment/restart

**Principle**: User decides what to do about these situations.

### Implications

This framing suggests that jitter should always be tolerated... but this was ultimately rejected (see Jitter section below).

---

## Current Smart Default Analysis

### How It Works

When `catchUpWindow` is not specified:
- **Recurring actions**: Default to the duration of the recurrence interval
- **One-time actions**: Default to `0` (skip if missed)

### Example Behaviors

| Interval | Smart Default Window | Behavior |
|----------|---------------------|----------|
| 1 second | 1000ms | Tight tolerance, as expected for high-frequency |
| 1 hour | 3600000ms | Generous, hourly tasks are less timing-sensitive |
| 1 day | 86400000ms | Very generous for daily tasks |

### Pros

1. **Handles jitter**: Brief event loop delays don't cause skips
2. **Prevents thundering herd**: Extended downtime doesn't cause replay of all missed executions
3. **Scales with intent**: Users who choose high-frequency intervals get tight tolerances; low-frequency get generous tolerances

### Cons

1. **Magic behavior**: Non-obvious, requires documentation
2. **Can't be explicitly requested**: Must omit the property to get this behavior
3. **Arbitrary relationship**: Why should interval = tolerance? They're conceptually different.

---

## New Concepts Explored

### Jitter Tolerance

**Initial Idea**: Force a minimum jitter tolerance (e.g., 1500ms) that's always applied, regardless of `catchUpWindow` setting.

**Rationale**: Library should never be blamed for missing an execution due to brief event loop delays.

**Why It Was Rejected**:

Some use cases require truly real-time behavior:

```js
// Delta computation - late readings are worse than skipped readings
// If I expect readings at T=0, T=1000, T=2000...
// A reading at T=1200 would give me wrong delta calculations
// Better to skip and handle the gap explicitly
```

The library promises **1-second precision with zero drift**. This is a feature, not a limitation. Forcing tolerance undermines this core value.

**Conclusion**: Jitter tolerance cannot be forced. Users who need truly real-time behavior should be able to get it with `catchUpWindow: 0`.

---

### Catch-Up Limit

**New concept**: Separate from the window, this controls *how many* missed executions to run.

**The Problem It Solves**:

Consider a task running every 1 second, with server offline for 5 minutes:
- 300 executions missed
- `catchUpWindow: "unlimited"` would run all 300

Do you want 300 rapid-fire executions? Almost certainly not.

**Proposed Dimension**:

```js
{
  catchUpWindow: "unlimited",  // Look back as far as needed
  catchUpLimit: 1              // But only run the most recent missed
}
```

**Possible Values**:
- `1` - Only the most recent missed execution (likely the common case)
- `N` - Up to N missed executions
- `"all"` - All missed executions (for transactional tasks)

**Use Cases**:

| Task | Window | Limit | Behavior |
|------|--------|-------|----------|
| Temperature sensor | 0 | N/A | Real-time only |
| Daily backup | 86400000 | 1 | Run one backup, not three |
| Billing notifications | "unlimited" | "all" | Run all missed notifications |
| Light toggle | "interval" | 1 | Only toggle once |

**Open Question**: Is this worth the added complexity, or does "most recent only" (limit=1) cover 95% of cases as the default?

---

### Fractional Intervals

**Idea**: Instead of `catchUpWindow = interval`, use `catchUpWindow = interval / 2` or `interval / 3`.

**Rationale**: If a task runs every hour and it's 45 minutes late, it's clearly "missed" - you wouldn't want it running that close to the next scheduled time.

**Example**:
- Hourly task scheduled for 10:00
- Server comes back at 10:45
- With full interval window (60 min): Runs at 10:45, then again at 11:00
- With half interval window (30 min): Skips the 10:00 execution, runs at 11:00

**Status**: Tabled for now. Creates additional "magic behavior" that's harder to reason about.

---

## Potential Solutions

### 1. Add `"interval"` as Explicit Value

Allow users to explicitly request the smart default behavior:

```js
catchUpWindow: "interval"  // Explicit: use my recurrence interval as the window
```

This solves the explicitness problem without changing any existing behavior.

**Current valid values**:
- `0` - Real-time only
- `<milliseconds>` - Fixed window
- `"unlimited"` - Run all missed

**Proposed addition**:
- `"interval"` - Match recurrence interval (explicit smart default)

### 2. Add `catchUpLimit` Property

New property to control how many missed executions to run:

```js
{
  catchUpWindow: "unlimited",
  catchUpLimit: 1  // Only run the most recent
}
```

**Default**: `"all"` (backwards compatible with current behavior)

### 3. Documentation Improvements

Better explain the rationale for the smart default:
- Why interval = window makes sense
- When to override it
- Examples of different use cases

---

## Summary of Proposed Values

### `catchUpWindow`

| Value | Meaning |
|-------|---------|
| `0` | Real-time only, skip all missed |
| `<ms>` | Run if missed by less than this duration |
| `"interval"` | Use the action's recurrence interval |
| `"unlimited"` | Run all missed executions |
| *undefined* | Smart default (currently = interval for recurring, 0 for one-time) |

### `catchUpLimit` (Proposed)

| Value | Meaning |
|-------|---------|
| `1` | Only run the most recent missed |
| `N` | Run up to N missed |
| `"all"` | Run all missed within window |

---

## Open Questions for Future Consideration

1. **Is full interval the right default?** Should it be 1/2 or 1/3 of the interval instead?

2. **One-time action defaults**: Is `0` (skip if missed) correct for one-shots, or should they have a small tolerance?

3. **catchUpLimit complexity**: Is this worth adding, or is the current behavior (effectively limit=all within window, then fast-forward) sufficient?

4. **Multiplier syntax**: Would `"1x"`, `"2x"`, `"0.5x"` be useful for expressing fractions of interval?

5. **Jitter floor revisited**: Are there cases where a guaranteed minimum tolerance (overridable) would be valuable?

---

## Backwards Compatibility

Any changes must maintain backwards compatibility with:

```js
// Legacy unBuffered mapping
unBuffered: false  // → catchUpWindow: "unlimited"
unBuffered: true   // → catchUpWindow: 0
```

The `"interval"` value would be purely additive - new capability, no breaking changes.

---

## Conclusion

The current smart default is actually sound in concept (tolerate jitter, don't replay history after downtime), but has ergonomic issues around explicitness and magic behavior.

**Minimum viable improvement**: Add `catchUpWindow: "interval"` as an explicit option.

**Future consideration**: Add `catchUpLimit` for finer control over replay behavior.
