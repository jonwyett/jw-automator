## Persistence Strategy

The automator maintains an in-memory scheduler state (tasks, next dates, counts, etc.) and periodically persists that state via the configured `storage` adapter. Persistence is designed to be **safe**, **simple**, and **gentle** on disk/flash media.

### Goals

* Avoid excessive writes (especially on SD cards / flash).
* Ensure that meaningful changes are eventually persisted.
* Keep semantics clear and independent of the storage backend.
* Work identically for memory and disk storage, while only *needing* debounce for disk.

### Core Concepts

* **State**: the full automator state object (all tasks, counts, dates, etc.).
* **Dirty flag**: a boolean indicating “state has changed since the last successful save”.
* **Minimum save interval**: a configurable debounce window (default: 60 seconds).

### When State Becomes Dirty

The automator marks its state as **dirty** whenever something happens that changes the scheduler’s behavior:

* Structural changes:

  * Adding a task
  * Updating a task
  * Removing a task
* Runtime progression:

  * Tasks advancing (dates/counts changing) due to execution/stepping

The exact triggers can be tuned over time, but the rule is simple:
**If the in-memory state differs in a way that would matter after a restart, mark it dirty.**

### Debounced Saving

The automator does **not** save immediately on every change. Instead, it uses a debounced strategy:

> **When the debounce period ends, check whether the state is dirty;
> if it is, save it.**

Concretely:

* A periodic timer (or scheduler loop) checks every so often.
* If `dirty === true` **and** at least `minSaveIntervalMs` has passed since the last save:

  * The automator calls `storage.save(state)`.
  * On success, `dirty` is set to `false`, and `lastSaveTime` is updated.

This ensures:

* We never write more frequently than the configured minimum interval.
* Any change that sets `dirty = true` will eventually be flushed, even if the system becomes idle afterward.



