# Automator State Management & Saving Architecture Report

This report details the internal state management and data flow of the `jw-automator` system, addressing the specific query about the relationship between in-memory state and the storage mechanism.

## Core Components & Data Flow

The system is divided into several distinct components, each with a clear responsibility:

1.  **`Automator.js` (The Public API & Orchestrator)**
    *   This is the main class you interact with.
    *   It does **not** hold the live task state itself.
    *   Its primary roles are to provide the public API (`addTask`, `getTasks`, etc.), manage the `storage` adapter, and orchestrate the `SchedulerHost`.
    *   It is responsible for triggering state saves.

2.  **`SchedulerHost.js` (The Heartbeat & Live State Manager)**
    *   This component contains the **single source of truth for the live, operational state** of all tasks. The tasks array lives in `this.state` within the `SchedulerHost` instance.
    *   It runs a high-precision timer (`_tick`) that executes every second.
    *   On each tick, it passes its current state to the `CoreEngine`.
    *   Crucially, after the `CoreEngine` processes the state, the `SchedulerHost` **replaces its entire state object** with the new state returned by the engine. This is how recurring tasks get their `count` and next `date` updated.

3.  **`CoreEngine.js` (The Deterministic State Calculator)**
    *   This is a **pure and stateless** engine. It does not hold any state itself.
    *   Its main job is the `step()` function, which takes a state object and time information as input.
    *   It calculates which tasks should have run, advances their properties (`date`, `count`), removes completed tasks, and returns a **brand new, updated `newState` object**. It never modifies the state object it receives.

4.  **`*Storage.js` (The Persistence Layer)**
    *   `FileStorage` and `MemoryStorage` are adapters for persisting the task state.
    *   They are "dumb" adapters; they simply save the state object they are given and load it when asked.
    *   They are completely decoupled from the live scheduling loop.

## The Saving Process Explained

Your hunch was correct. There is a clear separation between the live state and the saved state, even when using `MemoryStorage`.

Here is the exact flow:

1.  **Live State Update:** The `SchedulerHost` runs its tick every second. It calls `CoreEngine.step()`, gets back a `newState` object reflecting advanced tasks (e.g., `count` incremented, next `date` calculated), and updates its internal state (`this.state = newState`). **This happens continuously in memory.**

2.  **Save Trigger:** A save is triggered in one of two ways in the `Automator` class:
    *   **Immediately:** After you call a method like `addTask()`, `updateTask()`, or `removeTask()`, the `_saveState()` method is called right away (if `autoSave: true`).
    *   **Periodically:** The `saveInterval` timer calls `_saveState()` at a regular interval (e.g., every 5 seconds).

3.  **Snapshotting:** When `_saveState()` is executed, it first gets the *current live state* from the `SchedulerHost` by calling `this.host.getState()`. It then passes this state object to the storage adapter (`this.options.storage.save(state)`).

## Why `saveInterval` is Critical

The `saveInterval` is not redundant; it's essential for capturing the **internal state mutations** that happen inside the `SchedulerHost`.

*   When you call `addTask()`, the immediate save persists that new task.
*   However, when a recurring task runs, its `count` is incremented and its `date` is advanced by the `CoreEngine` -> `SchedulerHost` loop. The `Automator` class is not aware of this internal event.
*   The `saveInterval` ensures that these internal changes are periodically snapshotted to the storage layer. Without it, if the application were to stop between manual operations, the progress of all recurring tasks would be lost.

## Conclusion on `MemoryStorage`

You are correct that `MemoryStorage` creates a "duplicate copy". It does not share a memory reference with the live `SchedulerHost` state.

*   The **live state** is always in memory inside `SchedulerHost`.
*   The **saved state** inside `MemoryStorage` is a **snapshot** of that live state, updated only when `_saveState()` is called.

This design ensures a consistent architecture regardless of the storage backend. The "save" operation always means "take a snapshot of the live state and persist it". For `MemoryStorage`, "persisting" simply means updating its internal backup copy. This guarantees that loading from any storage provider (including `MemoryStorage`) provides a consistent, previously-saved state to start from.