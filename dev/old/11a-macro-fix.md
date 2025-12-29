# Proposed Solution: Consistent Cascading Catch-up Macros

This document outlines a plan to address inconsistencies and enhance the cascading behavior of `catchUpMode` macros within the `jw-automator` library.

## Current State Analysis

### Strengths
*   **Existing Cascading Logic:** A basic cascading system is present where a task's `catchUpMode` can override the `Automator` instance's `defaultCatchUpMode`.
*   **Pure Core Engine:** The `CoreEngine` correctly consumes only normalized `catchUpWindow` and `catchUpLimit` values, remaining isolated from macro interpretation.
*   **Normalization-then-Deletion:** The `catchUpMode` is processed into concrete `catchUpWindow`/`catchUpLimit` values and then deleted from the task object before persistence. This ensures that the persisted state reflects the "ground truth" and prevents unintended changes if macro definitions evolve.

### Weaknesses / Inconsistencies
*   **Inconsistent Update Behavior:** The `updateTaskByID` and `updateTaskByName` methods do not fully apply the cascading logic. They only process `catchUpMode` if it's explicitly provided in the `updates` object, failing to fall back to the `Automator`'s `defaultCatchUpMode` if the task being updated previously used the default. This can lead to tasks losing their intended catch-up behavior upon update.
*   **Limited Macro Support:** The current implementation only supports `'default'` and `'realtime'` `catchUpMode` values. The `'auto'` mode, which was discussed as calculating values based on recurrence intervals, is not yet implemented.

## Proposed Solution

The goal is to reinforce and consistently apply the existing "one-way normalization" philosophy across all task management operations (`addTask`, `updateTaskByID`, `updateTaskByName`), while also extending its capabilities.

### 1. Centralize Normalization Logic

*   **Action:** Create a new private helper method in `src/Automator.js`, e.g., `_normalizeCatchUpSettings(taskSpec, existingTask)`.
*   **Purpose:** This method will be responsible for resolving the final `catchUpWindow` and `catchUpLimit` values based on a clear cascading order:
    1.  **Explicit values on input:** `taskSpec.catchUpWindow` or `taskSpec.catchUpLimit` take highest precedence.
    2.  **Input `catchUpMode`:** If `taskSpec.catchUpMode` is present, it will be used to derive values.
    3.  **Existing task values:** If no `catchUpWindow`, `catchUpLimit`, or `catchUpMode` is provided in `taskSpec`, the values from `existingTask` (if provided for an update operation) will be retained.
    4.  **Automator `defaultCatchUpMode`:** If none of the above are present, the `this.options.defaultCatchUpMode` will be used to derive the values.
    5.  **Hardcoded System Default:** If all else fails, a sensible default (e.g., `realtime` equivalent) will be used.
*   **Macro Deletion:** This helper will ensure `taskSpec.catchUpMode` is always deleted after normalization.

### 2. Refactor `addTask`

*   **Action:** Modify `addTask` to call `_normalizeCatchUpSettings` to process the incoming `taskSpec` before assigning task properties.
*   **Benefit:** Simplifies `addTask` and ensures consistent application of the normalization rules.

### 3. Refactor `updateTaskByID` and `updateTaskByName`

*   **Action:**
    *   For both methods, first retrieve the `existingTask` before applying any updates.
    *   Pass the `updates` object (which acts as the `taskSpec` for normalization) and the `existingTask` to `_normalizeCatchUpSettings`.
    *   Apply the resulting `catchUpWindow` and `catchUpLimit` to the task being updated.
*   **Benefit:** Resolves the current inconsistency. Tasks will now correctly retain their existing `catchUp` settings during an update if no new `catchUpMode` or explicit values are provided, or correctly apply the `Automator`'s `defaultCatchUpMode` if applicable.

### 4. Implement `'auto'` Macro (Recommended Enhancement)

*   **Action:** Integrate the logic for an `'auto'` `catchUpMode` within the `_normalizeCatchUpSettings` helper.
*   **Logic:** When `catchUpMode` is `'auto'`, calculate `catchUpWindow` and `catchUpLimit` dynamically, potentially based on the task's `repeat.interval` (e.g., `catchUpWindow = 25% of interval`, `catchUpLimit = 1`).
*   **Benefit:** Aligns the implementation with the ideas in `dev/11-catchup_macros.md`, providing a more intelligent default based on task recurrence.

## Summary of Benefits

This plan will:
*   Ensure **consistent and predictable** catch-up behavior across all task creation and modification operations.
*   Maintain the project's philosophy of **pure core engine** and **persisted ground truth**.
*   Improve **developer ergonomics** by centralizing complex logic.
*   Provide a clear path for **future macro enhancements** like the `'auto'` mode.
