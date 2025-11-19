# Changelog

All notable changes to jw-automator will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2025-11-19

### Breaking Changes

-   **Smart Default `catchUpWindow` Behavior**: The default behavior for `catchUpWindow` has fundamentally changed. Instead of defaulting to `"unlimited"`, it now defaults based on action type:
    -   For recurring actions, it defaults to the recurrence interval duration.
    -   For one-time actions, it defaults to `0` (no catch-up).
    -   **Impact:** Users relying on the previous `"unlimited"` default for actions where `catchUpWindow` was not explicitly set will experience different behavior.
-   **Invalid `repeat.type` is now a Fatal Error**: Providing a missing or invalid `repeat.type` (e.g., a typo) will now throw a hard `Error` immediately when the action is added or updated.
    -   **Impact:** Previously, this would be defensively coerced to `'day'` with an `error` event. Code relying on this coercion will now crash.
-   **Coercion Events changed from `error` to `warning`**: All defensive coercions (e.g., invalid `repeat.interval`, negative `catchUpWindow`, invalid `repeat.limit`) now emit a `warning` event instead of an `error` event.
    -   **Impact:** Users listening for `automator.on('error', ...)` to catch these specific coercion notifications will need to update their code to listen for `automator.on('warning', ...)` instead.

### Added

-   **`warning` Event Type**: A new event type, `warning`, has been introduced for non-fatal data coercions and corrections during action validation.
-   **Smart `catchUpWindow` Defaults**: Actions now automatically infer a sensible `catchUpWindow` default based on whether they are one-time (default `0`) or recurring (default to recurrence interval duration).

### Changed

-   The "Defensive Validation" strategy has been refined to distinguish between fatal configuration errors and non-fatal coercions, using `Error` throws for the former and `warning` events for the latter.

## [3.2.0] - 2025-11-18

### Added

- **`seed()` Method**: New bootstrapping method that runs initialization logic only when the database is empty
  - Solves the "Bootstrapping Problem" by safely initializing actions without resetting schedules on restart
  - Returns `true` if seeding ran, `false` if skipped
  - Automatically saves state after seeding
  - Perfect for system tasks that should be added once but preserved forever

- **`catchUpWindow` Property**: Time-based validity window for missed executions (replaces binary buffered/unBuffered)
  - `catchUpWindow: "unlimited"` - Catch up ALL missed executions (like old `unBuffered: false`)
  - `catchUpWindow: 0` - Skip ALL missed executions (like old `unBuffered: true`)
  - `catchUpWindow: 5000` - Hybrid: tolerate 5s lag, skip if offline for hours
  - Solves the "Thundering Herd Problem" by preventing thousands of queued executions after long downtime
  - Fast-forward optimization uses mathematical projection to instantly advance high-frequency tasks
  - Uses `"unlimited"` string literal instead of `Infinity` for clean JSON serialization

- **Defensive Validation (Initial Implementation)**: Implemented "Fail loudly, run defensively" philosophy with various coercions and `error` events for invalid inputs. This initial strategy was further refined in v4.0.0, which introduced a dedicated `warning` event and stricter validation for `repeat.type`.

### Changed

- **Backwards Compatibility**: `unBuffered` property is now a maintained alias that maps to `catchUpWindow`
  - `unBuffered: true` → `catchUpWindow: 0`
  - `unBuffered: false` → `catchUpWindow: "unlimited"`
  - `catchUpWindow: Infinity` → automatically coerced to `"unlimited"` with DEBUG event
  - Both properties supported indefinitely with zero breaking changes
  - `catchUpWindow` takes precedence if both are specified

### Improved

- Clean JSON serialization: `"unlimited"` is a string, no special JSON handling required
- Enhanced action validation with comprehensive error/debug event emissions
- All invalid values coerced to sensible defaults - system keeps running
- Updated action loading to normalize `catchUpWindow` for backwards compatibility
- Comprehensive test coverage for both new features and defensive validation
- Updated examples to demonstrate `seed()` and `catchUpWindow` usage
- Updated documentation with detailed usage patterns and migration guidance

## [3.0.0] - 2025-11-17

### Added (v3 Complete Rewrite)

- **Core Engine**: Pure deterministic `step()` function for scheduling
- **1-Second Precision**: Fixed 1-second tick interval with zero drift
- **Local-Time Semantics**: All recurrence rules operate in local wall-clock time
- **DST Handling**: Configurable DST policies (`once`/`twice`) for fall-back scenarios
- **Offline Catch-Up**: Buffered/unBuffered execution semantics for resilience
- **Recurrence Types**:
  - `second`, `minute`, `hour`
  - `day`, `weekday`, `weekend`, `week`
  - `month`, `year`
- **Simulation API**: `getActionsInRange()` for future schedule preview
- **Pluggable Storage**: File-based and memory-based storage adapters
- **Custom Storage Interface**: Support for custom persistence backends
- **Event System**:
  - `ready` - Scheduler started
  - `action` - Action executed
  - `update` - Actions added/updated/removed
  - `error` - Error events
  - `debug` - Debug information
- **Action Management**:
  - `addAction()` - Add new scheduled actions
  - `updateActionByID()` - Update existing actions
  - `removeActionByID()` - Remove by ID
  - `removeActionByName()` - Remove by name
  - `getActions()` - Get all actions
  - `getActionsByName()` - Query by name
  - `describeAction()` - Human-readable description
- **Meta-Actions**: Actions can create/modify other actions
- **Auto-Save**: Configurable auto-save with custom intervals
- **Safety Guards**:
  - Maximum iteration limits to prevent infinite loops
  - Monotonic time progression guarantees
  - Bounded per-tick execution
- **Comprehensive Tests**: Full test suite with Jest
- **Examples**: Basic and IoT sensor examples included

### Changed from v2

- Complete clean-room rewrite
- Improved DST handling with explicit policies
- Better separation of action spec vs. state
- Deterministic core suitable for testing and simulation
- More predictable catch-up behavior
- Enhanced error handling and reporting
- Improved API ergonomics

### Technical Improvements

- Pure functional core engine
- Environment-agnostic architecture
- Reduced edge-case bugs
- Better maintainability
- Comprehensive documentation
- Type-safe action specifications

---

## [2.x] - Legacy

**Production version - widely deployed**

Version 2.x was the stable, production release of jw-automator that was actively used in home automation, IoT projects, and personal servers. Available in git history.

---

For upgrade guidance from v2 to v3, see the migration guide in the documentation.
