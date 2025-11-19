# jw-automator Version History

## Version 4.0.0 (Current - 2025-11-19)

**Refined Defensive Defaults and Predictable Behavior**

Version 4.0.0 focuses on making the Automator's behavior even more predictable and robust, especially regarding default values and error handling for action specifications.

### Key Changes from v3.2.0:
- **Smart `catchUpWindow` Defaults**: Introduces intelligent default values for `catchUpWindow` based on whether an action is one-time (defaults to `0`) or recurring (defaults to its recurrence interval). This prevents unexpected "thundering herd" scenarios.
- **Fatal Error for Invalid `repeat.type`**: An invalid `repeat.type` (e.g., a typo) now results in an immediate, hard `Error` to ensure user intent is explicit and unambiguous.
- **`warning` Event for Coercions**: Defensive coercions (e.g., invalid intervals, limits) now emit a `warning` event instead of an `error` event, providing clearer feedback without implying fatal issues.
- **Refined Defensive Validation Strategy**: A more nuanced approach to validation, distinguishing between fatal configuration errors (throwing `Error`) and non-fatal data corrections (emitting `warning`).

### Impact:
- Enhances out-of-the-box predictability.
- Reduces silent misinterpretations of user input.
- Provides clearer error reporting for developers.

---

## Version 3.0.0 (Current - 2025-11-17)

**Complete clean-room rewrite**

This is a ground-up reimplementation of jw-automator, representing a major architectural overhaul while preserving the core philosophy and use cases of the original library.

### Key Changes from v2:
- Complete codebase rewrite from scratch
- Enhanced architecture with:
  - Deterministic core engine with pure `step()` function
  - Explicit DST handling with configurable policies
  - Pluggable storage adapters (file, memory, custom)
  - Comprehensive test coverage (43+ tests)
  - Full documentation suite
  - Simulation API for schedule preview
- Improved API consistency and ergonomics
- Better error handling and safety guards
- Production-ready stability

### Architecture Highlights:
- Pure functional core (`CoreEngine` + `RecurrenceEngine`)
- Deterministic step function for testability
- 1-second precision scheduling with zero drift
- Local-time semantics with DST awareness
- Buffered/unbuffered execution policies

---

## Version 2.x (Legacy Production Version)

**Stable production release - widely used**

Version 2 was the production version of jw-automator that was released and actively used in the wild. It established jw-automator as a reliable automation scheduler for Node.js, particularly popular for:
- Home automation systems
- Raspberry Pi projects
- IoT applications
- Personal servers

v2 is now superseded by v3 but remains available in git history for legacy projects.

---

## Timeline

```
v2.x: Production version (legacy, widely deployed)
v3.0: Complete rewrite
v4.0: Refined Defensive Defaults (current release)
```

---

## Migration Path

**From v2 → v3:** See [docs/MIGRATION.md](docs/MIGRATION.md)

v3 introduces breaking changes in the API, but the core concepts remain familiar. Key migration areas:
- Constructor pattern (`new Automator()` vs old init pattern)
- Explicit DST policies required
- Updated method names (`removeActionByID`, `removeActionByName`, etc.)
- Pluggable storage configuration

---

## Current Status

**Version 4.0.0** is production-ready and fully tested.

- ✅ 43+ tests passing
- ✅ Complete documentation
- ✅ Working examples
- ✅ Zero runtime dependencies
- ✅ Node.js 12+ compatible
