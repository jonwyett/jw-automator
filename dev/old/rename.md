###  Automator: `action` → `task`

everywhere this scheduled “thing” is called an `action`, rename it to `task`.

* Public API:

  * `addAction` → `addTask`
  * `updateActionById` → `updateTaskById`
  * `getActions` → `getTasks`
  * Any `actionId` parameters → `taskId`
* Internals:

  * Arrays/maps like `actions` → `tasks`
  * Types/interfaces: `Action` → `Task`
  * State machine / step engine variables: `currentAction` → `currentTask`, etc.

Conceptually:

* **Task** = a scheduled unit that knows *when* and *how often* to run, and points at a **command** (via `cmd` or equivalent).

---
