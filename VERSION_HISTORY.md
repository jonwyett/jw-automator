# jw-automator Version History

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
v3.0: Complete rewrite (current release)
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

**Version 3.0.0** is production-ready and fully tested.

- ✅ 43+ tests passing
- ✅ Complete documentation
- ✅ Working examples
- ✅ Zero runtime dependencies
- ✅ Node.js 12+ compatible
