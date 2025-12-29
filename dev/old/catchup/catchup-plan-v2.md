# 📘 jw-automator v5 — Catch-Up Window + Catch-Up Limit (Core Behavior)

This document describes how to extend the current v4 engine (as implemented in `Automator.js` and `CoreEngine.js`) to support a **two-dimensional catch-up model**:

* **Temporal** control: `catchUpWindow`
* **Quantitative** control: `catchUpLimit`

It intentionally **ignores legacy helpers** like `unBuffered` and any “mode/macro” abstractions. Those can be reintroduced later as syntactic sugar over this core behavior.

The goal is to fully nail down the **functional semantics** so we can write precise tests.

---

## 1. Current Behavior (Baseline)

### 1.1 Action shape

Today, actions are created in `Automator.addAction` and stored with:

```js
const action = {
  id,
  name,
  cmd,
  payload,
  date,             // next run
  catchUpWindow,    // "unlimited" or ms
  repeat: { ... },  // optional
  count: 0
};
```



`count` is incremented in `_advanceAction` on **every recurrence slot**, executed or not. 
This already matches the “slot-based” semantics we just agreed on.

### 1.2 Catch-up loop

In `CoreEngine.step`:

* For each action, we compute `currentNextRun = action.date`.
* If `currentNextRun <= now`, we enter a **catch-up loop**.
* `catchUpWindow` is fetched per action, defaulting to `"unlimited"` if missing. 
* If the lag is large and window finite, `_fastForwardAction` may jump ahead. 
* Inside the `while (currentNextRun <= now && iterationCount < maxIterations)` loop:

  * We compute `lag = now - currentNextRun`.
  * We compute `isWithinWindow` based on `catchUpWindow`.
  * If `shouldExecute` (currently just `isWithinWindow`), we call `_executeAction` and push an event. 
  * We call `_advanceAction(action)` which:

    * increments `count`
    * computes the next `date` via `RecurrenceEngine.getNextOccurrence`. 
  * If `RecurrenceEngine.shouldStop(action)` is true, we remove the action.

There is **no quantitative limit** on how many missed occurrences we may execute in one catch-up loop; if `catchUpWindow` is `"unlimited"` we will execute all missed.

---

## 2. Problem Statement

The current model has only **one dimension** of control:

* **How old is too old?** → `catchUpWindow`.

This is insufficient for several real-world cases:

1. Long downtime with high-frequency tasks can produce a **thundering herd** of catch-up executions.
2. Some tasks want “**only the latest missed event**” even if many were missed.
3. Others want “**all recent misses within the last X**” but never older than X.
4. We need a way to **bound replay count** separately from replay age.

We also want to:

* Keep the existing **slot-based recurrence model** intact (count = slots, not executions).
* Avoid turning the scheduler into a “re-scheduling engine” that extends schedules to “make up for lost runs”.

---

## 3. Core Design: Two-Dimensional Catch-Up

We add one new field to the canonical action state:

### 3.1 `catchUpWindow` (temporal dimension)

Already exists and stays conceptually the same:

```js
action.catchUpWindow // "unlimited" or non-negative ms
```

**Meaning:**

> For this action, a missed occurrence is **eligible** to run only if
> `scheduledTime >= now - catchUpWindow`
> (or `catchUpWindow === "unlimited"`, which means no temporal cutoff).

A `catchUpWindow` of `0` means **“real-time only”**: execute only if we’re on time within the current tick, never replay past slots.

### 3.2 `catchUpLimit` (quantitative dimension)

New field:

```js
action.catchUpLimit // "all" or non-negative integer
```

**Meaning:**

> For this action, during a single catch-up pass (between `lastTick` and `now`), execute **at most this many** eligible missed occurrences, starting from the **most recent**.

If `catchUpLimit === "all"`, there is no quantitative cap; all eligible missed occurrences may execute.

### 3.3 Slot semantics stay unchanged

* `action.count` still increments **once per slot**, whether the slot executes or not.
* `repeat.limit` still defines the **total number of slots** before the action stops.
* We **never** extend the schedule to “make up” for skipped slots:

  * If the user sets a finite `catchUpWindow` and/or `catchUpLimit`, they are saying:
    “I accept that some slots may never fire; don’t reschedule them later.”

This preserves determinism and the “timeless state” model.

---

## 4. Conceptual Algorithm (What the Engine Must Do)

We want to be able to test CoreEngine.step against this conceptual behavior, regardless of how we optimize under the hood.

For a single action during one tick `[lastTick, now]`:

1. **Initialize**

   * Let `t` = action.date (the next scheduled slot).
   * If `t > now`, do nothing for this action in this tick.

2. **Generate theoretical slots**

   * Starting from `t`, advance through recurrence slots up to and including any slot `<= now`, using the same recurrence rules as `_advanceAction` / `RecurrenceEngine.getNextOccurrence`.
   * For each slot:

     * Treat it as a **slot** (advance `date`, increment `count`, obey `repeat.limit`, etc.).
   * This is what the existing loop + `_advanceAction` already does today. 

3. **Determine eligible slots (window)**

   * Among slots whose scheduled time falls in `(lastTick, now]`, a slot is **eligible** if:

     * `catchUpWindow === "unlimited"`, or
     * `scheduledTime >= now - catchUpWindow`.
   * Slots older than `now - catchUpWindow` are **never executed**, but still advanced through as part of the schedule.

4. **Apply quantitative limit**

   * Let `eligible` be the list of eligible slots sorted by scheduledTime ascending.
   * If `catchUpLimit === "all"` or `eligible.length <= catchUpLimit`:

     * Execute all `eligible` slots (in scheduledTime order).
   * If `eligible.length > catchUpLimit`:

     * Execute only the **most recent** `catchUpLimit` slots:

       * i.e., the last N elements of `eligible`.

5. **Advance to next future slot**

   * After processing up to `now` (including both executed and skipped slots), the action’s `date` MUST be the **first slot strictly after `now`**, or `null` if the recurrence has ended.
   * This is already how `_advanceAction` + `shouldStop` work; we’re just clarifying that the presence or absence of executions doesn’t change this.

6. **Count semantics**

   * `action.count` increments once per slot in step 2, regardless of execution in steps 3–4.
   * `repeat.limit` is enforced purely on this slot count, as it is today.

The concrete implementation will (and should) use optimizations (like `_fastForwardAction`), but any optimization must yield the same externally observable behavior:

* Same set of execution events (same `scheduledTime` values).
* Same final `date`.
* Same `count`.
* Same `repeat.limit` stopping behavior.

---

## 5. API / Data Model Changes

### 5.1 Action structure (canonical)

Canonical persisted actions should have:

```js
{
  id,
  name,
  cmd,
  payload,
  date,              // next slot
  catchUpWindow,     // "unlimited" or ms
  catchUpLimit,      // "all" or integer >= 0
  repeat: {
    type,
    interval,
    limit,           // slot-based limit, as today
    endDate,
    dstPolicy,
    ...
  },
  count              // slot count
}
```

No `unBuffered` in the core model anymore.

### 5.2 Validation rules (Automator layer)

In `_validateAction` (or an equivalent pre-normalization step): 

* `catchUpWindow`:

  * Must be `"unlimited"` or a number ≥ 0.
  * Negative numbers coerced to 0 (with warning).
* `catchUpLimit`:

  * If provided:

    * Must be `"all"` or a finite integer ≥ 0.
    * Negative or non-numeric → coerce to `"all"` or emit warning + default.
  * If **not** provided:

    * For now (pre-macro), the simplest, least-surprising rule is:

      * `catchUpLimit` defaults to `"all"`
      * i.e., current behavior preserved: “temporal window only, no quantitative cap.”
    * When we introduce macros (“general” mode, etc.), we can change the *authoring* defaults to something like `1`, but at the core engine level `"all"` is a good neutral default.

---

## 6. Changes in CoreEngine (What Needs to Change)

### 6.1 Extend step() to use `catchUpLimit`

In `CoreEngine.step`, inside the per-action processing: 

Today:

* For each slot in the `while (currentNextRun <= now)` loop:

  * We compute `lag`.
  * We compute `isWithinWindow`.
  * If `isWithinWindow`, we execute the action.

With `catchUpLimit`:

* We need a per-action **execution budget** for this tick.
* Conceptually:

  * Track how many eligible occurrences we see.
  * Only execute up to `catchUpLimit` of the **most recent** eligible slots.

Implementation detail is flexible, but functionally:

* When `catchUpLimit === "all"`:

  * Behavior is identical to current code: all eligible slots execute.
* When `catchUpLimit` is finite:

  * Only the N latest eligible slots in the tick’s range `(lastTick, now]` will produce actual action events.

You can implement this either:

* By first counting eligible slots and then replaying the last N, or
* By maintaining a small buffer of up to `catchUpLimit` eligible slots while iterating and only executing when you know they are within the last N.

The doc doesn’t need to prescribe the exact strategy, only the outcome.

### 6.2 Keep `_advanceAction` exactly as-is

`_advanceAction` should continue to: 

* Increment `action.count` once per slot.
* Advance `action.date` according to recurrence.
* Let `RecurrenceEngine.shouldStop` enforce `repeat.limit` based on `count` and/or `endDate`.

We **do not** tie `count` to executions.

### 6.3 Ensure `_fastForwardAction` is compatible

`_fastForwardAction` currently: 

* Skips ahead by computing how many steps to jump to get “near” the catch-up window.
* Adjusts `action.date` and `action.count` as if those steps had been iterated.

When we introduce `catchUpLimit`, this still works **as long as**:

* The “interesting” portion near `now` (where eligible slots exist) is **actually iterated** through the normal loop.
* Any skipped slots are effectively **outside** the window and thus non-eligible anyway.

In other words:

* `_fastForwardAction` can still skip through the deep past where `lag >> catchUpWindow`.
* Once you’re within a range where slots might fall into `catchUpWindow`, the normal loop must be allowed to see those slots so it can apply `catchUpLimit` correctly.

We don’t need to describe the exact math, just the invariant:

> **Fast-forward may only skip slots that would be outside `catchUpWindow` and therefore never executed, regardless of `catchUpLimit`.**

As long as that holds, `catchUpLimit` will only operate on the explicitly processed slots, and semantics remain correct.

---

## 7. Key Edge Cases & Expected Behavior

These are the scenarios we should write tests for, to confirm the implementation matches the spec.

### 7.1 Unlimited window, unlimited limit (current behavior)

* `catchUpWindow: "unlimited"`
* `catchUpLimit: "all"`

Behavior:

* All missed slots between `lastTick` and `now` execute (subject to `maxIterations` safety).
* This should be equivalent to current v4 behavior (minus `unBuffered`).

### 7.2 Finite window, unlimited limit

* `catchUpWindow: 1 hour`
* `catchUpLimit: "all"`

Behavior:

* Only slots with `scheduledTime >= now - 1h` are eligible.
* All eligible slots execute.
* Older slots (>1h) are skipped (slot count still increments; they just never fire).

### 7.3 Finite window, finite limit

* 10-minute interval task.
* Server down for 2 hours (12 slots).
* `catchUpWindow: 60 minutes`.
* `catchUpLimit: 3`.

Expected behavior:

* Slots scheduled in the last hour: 6 eligible slots.
* Only the **3 most recent** of those eligible slots execute.
* The action’s `date` is advanced to the first slot after `now`.
* `count` has advanced by 12 (all 12 slots have “elapsed”), but only 3 produced events.

### 7.4 Real-time only

* `catchUpWindow: 0`
* `catchUpLimit: "all"` or `1` (doesn’t matter much in this case)

Behavior:

* For each tick, execute only slots whose scheduled time falls exactly in the current tick (`(lastTick, now]`) with `lag <= 0`.
* Any slot missed by event-loop jitter or downtime is **never executed** later.

### 7.5 Stop conditions

* With `repeat.limit` set (slot-based):

  * Once `repeat.count >= repeat.limit`, the action is removed — even if some of those slots never executed due to catch-up rules.
* With `repeat.endDate`:

  * Once the next slot is after `endDate`, the action stops, again independent of how many executions actually happened.

This confirms we are **not** re-scheduling missed work into the future.

---

## 8. Summary

The plan is to:

1. **Extend the action model** with `catchUpLimit` (`"all"` or integer ≥ 0).
2. **Keep `catchUpWindow` semantics** unchanged (temporal filter).
3. **Preserve slot-based count/limit**:

   * `count` = number of slots elapsed
   * `limit` = max slots
   * Skipped slots are not rescheduled.
4. **Update CoreEngine.step** to:

   * Filter missed slots by `catchUpWindow`.
   * Execute **up to `catchUpLimit` of the most recent eligible slots**.
   * Always advance the schedule across all slots up to `now`.
5. **Keep `_advanceAction` and recurrence behavior intact**, only layering `catchUpLimit` on the decision of which slots actually fire.
6. **Constrain fast-forward** to skip only slots that are guaranteed to be outside the window, so it doesn’t interfere with `catchUpLimit` behavior.

Once this core behavior is implemented and tested, we’ll be in a solid position to layer **macros/modes** (e.g., “general”, “realtime”, “batch”) on top as authoring conveniences without touching the engine semantics again.
