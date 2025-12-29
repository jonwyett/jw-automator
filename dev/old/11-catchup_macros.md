# ⭐ Your “macro” system is a **one-way normalization**, not a runtime feature

Meaning:

* A user provides:

  ```json
  { "catchUpMode": "auto" }
  ```
* The **Automator.addTask / updateTask** pipeline recognizes this as a macro directive.
* The library immediately expands it into the **real, explicit values**:

  ```json
  {
    "catchUpWindow": 9000,
    "catchUpLimit": 1
  }
  ```
* And then **the macro field is deleted**:

  ```json
  {
    "name": "...",
    "cmd": "...",
    "repeat": {...},
    "catchUpWindow": 9000,
    "catchUpLimit": 1
  }
  ```

After normalization:

* **Only explicit, concrete values remain**.
* The task is treated as if the user wrote those values themselves.
* The macro does *not* appear in persisted state.
* At runtime, the engine knows nothing about “modes.”

This is exactly what you want.

---

# ⭐ Why This Model Is Superior

### ✔ Keeps the engine pure

The scheduler never needs to know about macros, modes, presets, heuristics, or “interpretation.”

### ✔ Predictable, testable behavior

Once a task is added, all fields are explicit.
No hidden logic.

### ✔ Perfectly compatible with GUI workflows

The GUI can send simple macros like:

* `"mode": "intervalDefault"`
* `"mode": "realTime"`
* `"mode": "batch"`

And your automator expands them immediately.

### ✔ No surprises on reload

When tasks are loaded from disk, they already contain full `catchUpWindow` and `catchUpLimit`.
No macros. No inference. No re-computation.

### ✔ Allows future schema evolution

You can change how `"auto"` or `"interval"` expands without breaking backward compatibility, because tasks normalized today will survive unchanged later.

---

# ⭐ How the pipeline should work (step-by-step)

### 1. **User input**

Either from API, JSON file, or GUI:

```json
{
  "name": "lights",
  "repeat": { "type": "interval", "interval": "1m" },
  "catchUpMode": "auto"
}
```

### 2. **Normalization layer (in addTask / updateTask)**

Pseudo-logic:

```js
if (task.catchUpMode === 'auto') {
    const intervalMs = normalizeInterval(task.repeat.interval);
    task.catchUpWindow = Math.floor(intervalMs * 0.25); // example
    task.catchUpLimit = 1;
    delete task.catchUpMode;
}
```

### 3. **Validation**

Now that the task has fully explicit numeric window/limit fields, pass through existing validation.

### 4. **Persistence**

State saved with only:

```json
{
  "catchUpWindow": 15000,
  "catchUpLimit": 1
}
```

### 5. **Runtime**

CoreEngine and RecurrenceEngine operate entirely on explicit fields.
Zero awareness of macros.

