Here is the design summary for the two core features we identified to solve the "Bootstrapping" and "Thundering Herd" problems.

---

# 📝 v3 Design Plan: Bootstrapping & Resilience

## 1. Bootstrapping: The `seed()` Method

### The Problem
In a persistent system, there is a conflict between **Code** (the initial definition) and **Disk** (the evolving state).
*   If we blindly add actions on startup, we overwrite the current schedule (resetting the calendar).
*   If we rely solely on imperative logic (`if (!exists)...`), we force the user to write complex state management code.

### The Solution
We introduce a dedicated **provisioning method** that treats the `actions.json` file as the Source of Truth, running initialization logic *only* when the database is empty.

### API Signature
```javascript
automator.seed(callback)
```

### Behavior
1.  **Check State:** The method checks if the `actions` array in storage has `length > 0`.
2.  **If Populated:** It returns `false` immediately. The user's existing schedule (even if manually modified) is preserved perfectly.
3.  **If Empty (First Run):**
    *   It executes the `callback`, passing the automator instance.
    *   The user adds their "System Tasks" inside the callback.
    *   It immediately triggers a `save()` to persist the new state.

### Example
```javascript
// This block runs ONCE in the lifecycle of the application.
// On all subsequent restarts, it is skipped entirely.
automator.seed((auto) => {
  auto.addAction({
    name: 'Daily Report',
    cmd: 'generateReport',
    date: new Date('2025-01-01T09:00:00'), // Sets the initial Anchor
    repeat: { type: 'day', interval: 1 }
  });
});
```

---

## 2. Resilience: The `catchUpWindow` Property

### The Problem
The current binary choice (`unBuffered` vs `buffered`) forces a compromise between two extremes:
1.  **Buffered:** Run *everything* missed. After a week offline, this causes a "Thundering Herd" (thousands of executions), blocking the CPU and flooding networks.
2.  **Unbuffered:** Run *nothing* missed. A 2-second CPU lag causes data gaps (missed sensor readings).

### The Solution
We replace the binary toggle with a **Time-Based Validity Window**. This defines exactly "How late is too late?" for a specific action.

### API Property
```javascript
{
  // ... action definition ...
  catchUpWindow: 60000 // Time in milliseconds (e.g., 1 minute)
}
```

### Behavior logic
When the simulated clock ticks for a missed event:
1.  **Calculate Lag:** `Delta = Now - ScheduledTime`
2.  **Check Validity:**
    *   **If `Delta <= catchUpWindow`:** The event is valid. **Execute it.** (Recover data from short glitches/reboots).
    *   **If `Delta > catchUpWindow`:** The event is stale. **Fast-Forward.** (Advance the schedule cursor without executing).

### The "Fast-Forward" Optimization
To prevent the simulation from taking too long when a high-frequency task is very old (e.g., a 1-second task offline for a year):
*   The `CoreEngine` will detect when the cursor is deep in the "Dead Zone" (outside the window).
*   It will use **Mathematical Projection** (or tight loops without object creation) to instantly advance the `date` cursor to the edge of the window.
*   **Result:** A task that is 1 year behind catches up in milliseconds, runs the few events that fit in the window, and resumes normal operation.

### Configuration Presets
*   `catchUpWindow: Infinity` → Behaves like old `buffered: true` (Billing, critical logs).
*   `catchUpWindow: 0` → Behaves like old `unBuffered: true` (Real-time alerts).
*   `catchUpWindow: 5000` → **The Hybrid.** Tolerates 5s of lag, but skips if offline for hours.

---

## 3. Backwards Compatibility: `unBuffered` Property

### The Requirement
The `unBuffered` property is widely used across examples, tests, and documentation. To avoid breaking existing user code, we will maintain indefinite support as a legacy alias.

### The Strategy
Rather than deprecating `unBuffered`, we treat it as a **maintained alias** that maps to specific `catchUpWindow` values. This provides a smooth migration path without console noise or breaking changes.

### Implementation Approach

**Property Normalization:**
When an action is created or updated, the system normalizes the catch-up behavior using this priority order:

1. **`catchUpWindow` specified:** Use it directly (new property takes precedence)
2. **`unBuffered` specified:** Convert to equivalent `catchUpWindow` value:
   - `unBuffered: true` → `catchUpWindow: 0` (skip all missed executions)
   - `unBuffered: false` → `catchUpWindow: Infinity` (execute all missed executions)
3. **Neither specified:** Default to `catchUpWindow: Infinity` (backwards compatible with current buffered behavior)

**Edge Case Handling:**
- If both `unBuffered` AND `catchUpWindow` are specified, `catchUpWindow` takes precedence
- Storage format supports both properties (no migration needed for existing `actions.json` files)
- No deprecation warnings in console (silent support)

### Example Normalization Code
```javascript
// Internal method in Automator.js
_normalizeCatchUpWindow(spec) {
  // New property takes precedence
  if (spec.catchUpWindow !== undefined) {
    return spec.catchUpWindow;
  }

  // Backwards compatibility mapping
  if (spec.unBuffered !== undefined) {
    return spec.unBuffered ? 0 : Infinity;
  }

  // Default: catch up everything (current buffered behavior)
  return Infinity;
}
```

### Documentation Strategy
- **Primary documentation:** Use `catchUpWindow` in all new examples and guides
- **Legacy support:** Mention `unBuffered` as a supported alias in migration guide
- **No breaking changes:** Both properties work indefinitely
- **Migration path:** Users can switch when ready; no forced timeline

### Code Impact
**Minimal cruft (~10 lines across entire codebase):**
- Automator.js: Property normalization helper (~8 lines)
- CoreEngine.js: Use normalized value (no change to core logic)
- Validation: Allow both properties in update whitelists
- Storage: Support both in serialization/deserialization (already works)

### Benefits
✅ Zero breaking changes
✅ Smooth migration path
✅ Minimal code maintenance burden
✅ Existing user code continues to work
✅ New users get more intuitive API