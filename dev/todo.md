1. DSL for recurrence rules

Human-friendly rules like 'every weekday at 7:00'.

2. Better month-based recurrence anchoring

See the “March 31 → April 30 → May 30” behavior.

3. Time-zone awareness beyond system local zone

Supporting “run at 7am in America/New_York even if the server is elsewhere.”

4. Explainable simulation

A version that lists why an action runs (e.g., “weekday recurrence matched”)

5. Action groups

Grouping related actions so they can be suspended/resumed together.

6. Real-time drift monitoring

Detecting if ticks consistently fall behind.

7. [RESOLVED] action->task

8. re-visit errors for bad tasks (when a user specifies them wrong)

9. MISSING

10. [RESOLVED] minSaveIntervalMs vs saveInterval: we want a 'debounce' for saving tasks that happen quickly and also only to update the store when something actually happens, not 'every N seconds' for no reason. this is for file-storage only, not in-memory, so we may need to decouple this logic. There is "first boot sim" = save when done, changes to the task list (CRUD) = immediate. and then a debounce so that tasks that run every second only save to disk every minute or something like that.

11. [RESOLVED] catchup macros.

12. [RESOLVED] Boot mode: 
On the very first scheduler tick after program start, the automator enters a “boot” state.
During boot, the scheduler performs its normal slot advancement to bring all tasks up to the present time, but suppresses all task execution.
After the boot sweep reaches “now”, the automator exits boot mode and runs normally.
This ensures large offline gaps never cause “catch-up storms” or accidental replay of stale events, while still preserving deterministic state advancement for all tasks.

13. [RESOLVED] remove storage adapter

14. boot mode logging (catchup logging really)
