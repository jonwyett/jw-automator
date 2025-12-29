# Automator Defensive Defaults Strategy

The Automator's design philosophy for handling task specifications is **"Fail loudly, run defensively."**

The goal is to maximize system robustness. Rather than rejecting a task with minor errors or missing properties, the Automator will make reasonable, "defensive" assumptions to coerce the task into a valid, runnable state.

However, these corrections are never silent. Whenever a default is applied or a value is coerced due to invalid input, the Automator emits either a `warning` or `debug` event. This ensures that the developer is always aware of any assumptions the system has made on their behalf.

---

### Property Default and Coercion Rules

The following rules are applied when a task is added via `addTask()` or updated via `updateTask...()`.

#### **`cmd`**
- **Rule:** A task without a command is not runnable.
- **Behavior:** Throws a hard `Error` if missing. This is the primary exception to the "run defensively" rule, as the task's intent cannot be determined.

#### **`date`** (Start Time)
- **Rule:** A task needs a starting time.
- **Default:** If `date` is not provided, it defaults to **5 seconds in the future** from the time it was added.
- **Event:** `debug`

#### **`catchUpWindow`** (Smart Default)
- **Philosophy:** The default catch-up behavior should match the user's likely intent for "server busy" vs. "server offline" scenarios. Explicit settings always take priority.
- **Priority Rules:**
  1.  **Explicit `catchUpWindow`:** If the property is present, it is used.
      - `Infinity` is coerced to `"unlimited"`.
      - Negative numbers are coerced to `0`.
      - Invalid strings or other types are coerced to `"unlimited"`.
      - A `warning` event is emitted for any coercion.
  2.  **Legacy `unBuffered`:** If `catchUpWindow` is absent but the legacy `unBuffered` property is present, it is mapped for backwards compatibility:
      - `unBuffered: true` maps to `catchUpWindow: 0` (no catch-up).
      - `unBuffered: false` maps to `catchUpWindow: "unlimited"`.
  3.  **Smart Default (Recurring):** If the task has a `repeat` property, `catchUpWindow` defaults to the **duration of the repeat interval** (e.g., an hourly task gets a 1-hour catch-up window).
  4.  **Smart Default (One-Time):** If the task does not have a `repeat` property, `catchUpWindow` defaults to **`0`** (no catch-up).

---

### Recurrence Rules (`repeat.*`)

#### **`repeat.type`**
- **Rule:** The recurrence `type` is fundamental to the task's behavior and must be a valid string (e.g., 'hour', 'day', 'week').
- **Behavior:** Throws a hard `Error` if missing or invalid. Unlike other properties, the ambiguity of an invalid type is considered a fatal error, as the user's intent cannot be safely determined.

#### **`repeat.interval`**
- **Rule:** The interval must be a positive integer.
- **Default:** If `undefined`, it is `1`. If defined but invalid (e.g., `0`, `-5`, `2.5`), it is coerced to a valid integer via `Math.max(1, Math.floor(value))`.
- **Event:** `warning` (if a value was changed).

#### **`repeat.limit`**
- **Rule:** The execution limit must be a number greater than or equal to 1.
- **Default:** If invalid (e.g., `0`, `-10`, `'foo'`), it is coerced to `null` (unlimited).
- **Event:** `warning`

#### **`repeat.endDate`**
- **Rule:** The end date must be a valid date representation.
-
- **Default:** If invalid, it is coerced to `null` (no end date).
- **Event:** `warning`

#### **`repeat.dstPolicy`**
- **Rule:** The DST "fall back" policy must be either `'once'` or `'twice'`.
- **Default:** If missing or invalid, it is coerced to `'once'`.
- **Event:** `warning` (if an invalid value was provided).
