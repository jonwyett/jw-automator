Below is a **clean, structured design document** you can paste directly into your repo (e.g., as `catchUp-spec-v5.md` or `CATCHUP-DESIGN.md`).
It captures both:

* The **low-level reality** (window + limit as the canonical persisted truth)
* The **macro layer** (modes as one-way authoring sugar)
* The normalization step (the core of the new design)

No DX fluff, no implementation details, just architecture.

---

# 📘 **jw-automator v5 — Catch-Up Semantics Design Document**

## **Purpose**

This document defines the revised catch-up execution semantics for jw-automator v5.
The goal is to:

* Simplify the internal model
* Make user intent explicit
* Provide safe defaults for normal automation scenarios
* Preserve full control for real-time or precision-critical tasks
* Remove "magic" behavior from persisted action data
* Allow one-way authoring macros that normalize into canonical, explicit state

---

# 1. **Canonical Catch-Up Model (Low-Level Reality)**

Regardless of how an action is authored, once it is **normalized and persisted**, its catch-up behavior is fully determined by two fields:

### **1. `catchUpWindow`**

A temporal boundary defining *how far into the past* the scheduler may consider an event “still valid”.

```
catchUpWindow: <milliseconds> | "unlimited"
```

### **2. `catchUpLimit`**

A quantitative boundary defining *how many missed executions* the scheduler may replay.

```
catchUpLimit: <number> | "all"
```

### These two fields are the **entire capability surface**.

Everything else (defaults, inference, modes, heuristics) must collapse down into explicit values of these two fields.

### These fields are:

* Fully serializable
* Stable across versions
* Simple to reason about
* Exposed directly to expert users
* Persisted exactly as the scheduler uses them

### These fields are the **only** persisted catch-up semantics.

No modes or macros are persisted.

---

# 2. **Persistence Contract**

After normalization:

* **Every action MUST contain explicit values** for:

  * `catchUpWindow`
  * `catchUpLimit`

* **No authoring macros are stored.**
  (`mode`, `preset`, `interval`, etc. never appear in saved JSON.)

* The persisted action object is the **source of truth** for all future scheduler behavior.

This ensures:

* Zero “magic” in runtime behavior
* Reproducibility
* Version stability
* Deterministic restore behavior
* Clarity in debugging

---

# 3. **Authoring Layer (Macros / User Convenience)**

Users may supply additional fields in their action JSON to simplify configuration.
These fields **do not survive normalization**.
They are interpreted **exactly once**, when the action is created or updated.

This layer is where “General” vs “Real-Time” semantics live.

## **3.1 `mode`**

Optional. User intent hint that influences normalization.

```
mode: "general" | "realtime"
```

### ✔ `mode: "general"`

Indicates the user wants **safe defaults** appropriate for typical automation workloads.

Scheduler will:

* Compute a “safe, conservative, jitter-tolerant” `catchUpWindow`
* Compute a reasonable default `catchUpLimit`
* Allow user overrides of individual fields
* Provide behavior that will not “fail by default” under normal jitter or brief outages

### ✔ `mode: "realtime"`

Indicates precision-critical intent where the scheduler must **not assume anything**.

Scheduler will:

* Require explicit user-provided values for both `catchUpWindow` and `catchUpLimit`
* Reject incomplete configurations
* Disable jitter-smoothing defaults
* Avoid any temporal assumptions

---

# 4. **Normalization**

All authoring-time action specs pass through:

```
normalizeActionSpec(userSpec) → canonicalSpec
```

### **Responsibilities of the normalizer:**

1. Interpret optional macros (`mode`, legacy flags, etc.)
2. Compute defaults where allowed
3. Validate correctness (especially in realtime mode)
4. Produce a **fully explicit**, serializable action object
5. Strip out all authoring-only fields
6. Persist only the canonical form

Normalization occurs at:

* `addAction(...)`
* `updateActionByID(...)`
* `updateActionByName(...)`
* `seed(...)`

Normalization never occurs at runtime execution.

---

# 5. **General Mode Defaults**

If user specifies:

```
mode: "general"
```

AND omits `catchUpWindow` or `catchUpLimit`:

### 5.1 Catch-Up Window Default

A heuristic based on recurrence interval (or another rule chosen by the library):

```
catchUpWindow = computeGeneralWindow(repeat)
```

This computation is internal-only.
Typical formulations include:

* `window = repeat.intervalInMs`
* or capped window: `window = min(repeat.intervalInMs, MAX_GENERAL_WINDOW)`
* or fraction of interval: `window = interval / k`

This client-facing macro ensures the library **absorbs jitter** and handles “normal” downtime gracefully.

### 5.2 Catch-Up Limit Default

```
catchUpLimit = 1
```

Rationale:

* Avoid thundering herd effects
* Avoid double-running daily tasks after downtime
* Avoid overwhelming the device
* Only run the most recent valid execution

### 5.3 Explicit Overrides

User may override *either* field:

```json
{
  "mode": "general",
  "catchUpWindow": 60000
}
```

or:

```json
{
  "mode": "general",
  "catchUpLimit": "all"
}
```

Overrides take priority over defaults.

### 5.4 Persistence Output Example

User input:

```json
{
  "mode": "general",
  "repeat": { "type": "hour", "interval": 1 }
}
```

Persisted:

```json
{
  "repeat": { "type": "hour", "interval": 1 },
  "catchUpWindow": 3600000,
  "catchUpLimit": 1
}
```

---

# 6. **Real-Time Mode Requirements**

If user specifies:

```
mode: "realtime"
```

Then *no inference occurs*.

### The user must explicitly supply:

* `catchUpWindow`
* `catchUpLimit`

### The library must reject:

* Missing fields
* Ambiguous configurations
* Contradictory settings
* Implicit jitter smoothing

### Example - VALID realtime configuration

User input:

```json
{
  "mode": "realtime",
  "catchUpWindow": 0,
  "catchUpLimit": 1,
  "repeat": { "type": "second", "interval": 1 }
}
```

Persisted:

```json
{
  "repeat": { "type": "second", "interval": 1 },
  "catchUpWindow": 0,
  "catchUpLimit": 1
}
```

### Example - INVALID realtime configuration

```json
{
  "mode": "realtime",
  "repeat": { "type": "second", "interval": 1 }
}
```

→ Reject with an error (or return error string in your Node style)
Because user did not specify window/limit.

---

# 7. **Legacy Compatibility**

Existing v4 fields must be mapped during normalization:

### Legacy Field → Canonical Mapping

| Legacy Field        | Interpretation                   |
| ------------------- | -------------------------------- |
| `unBuffered: false` | `catchUpWindow = "unlimited"`    |
| `unBuffered: true`  | `catchUpWindow = 0`              |
| `catchUpWindow`     | Directly becomes canonical value |

These remain supported as authoring input, but do not persist as-is.

---

# 8. **Why This Model Works**

### ✔ Authoring layer remains ergonomic

Users can specify only what they care about.

### ✔ Persistence layer is explicit and future-proof

No magic; behavior is transparent.

### ✔ Modes express intent, not behavior

“General" → apply defaults
“Realtime" → enforce explicitness

### ✔ You avoid the “smart default trap”

Defaults apply only in General mode.
Never hidden behind strings like `"interval"`.

### ✔ Canonical fields remain small and stable

The entire catch-up model reduces to exactly two values.

### ✔ You avoid breaking the JSON-only constraint

Macros never survive normalization.

### ✔ Easy to extend

Future modes (e.g., “batch”, “transactional”) can compile down to the same two fields.

---

# 9. **Appendix — Example Normalization Flow**

User input:

```json
{
  "name": "TempReading",
  "cmd": "readSensor",
  "mode": "general",
  "repeat": { "type": "minute", "interval": 5 }
}
```

Steps:

1. See `mode = "general"`
2. User did not supply window → compute default
3. User did not supply limit → use default = 1
4. Construct canonical
5. Remove `mode`

Persisted object:

```json
{
  "name": "TempReading",
  "cmd": "readSensor",
  "repeat": { "type": "minute", "interval": 5 },
  "catchUpWindow": 300000,
  "catchUpLimit": 1
}
```

---

# ✔ End of Document

If you want, I can now produce:

* An accompanying **normalization pseudocode**
* A matching **README section**
* A full **JSON schema**
* Or merge this into your existing documentation with consistent formatting.
