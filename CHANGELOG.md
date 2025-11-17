# Changelog

All notable changes to jw-automator will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-05-01

### Added (v2 Complete Rewrite)

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

### Changed from v1

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

## [1.x] - Legacy Version

Previous version available in backup. See git history for details.

---

For upgrade guidance from v1 to v2, see the migration guide in the documentation.
