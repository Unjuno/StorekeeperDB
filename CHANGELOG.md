# Changelog

All notable changes to StorekeeperDB will be tracked here.

## 0.1.0-alpha.0 - unreleased

Initial public alpha baseline.

### Added

- `StorekeeperDB` local synchronous SQLite runtime.
- Ordinary mutable array/object state persistence.
- Magic scalar-path lookup projection through `find()`.
- `signal()` and `liveFind()` for local realtime prototype flows.
- Debug surface: `status()`, `inspect()`, `explain()`, `debug().recentMagic()`, `debug().evict()`, and `debug().rebuild()`.
- Persistent handling for common array mutators: `push`, `pop`, `shift`, `unshift`, `splice`, `sort`, and `reverse`.
- Nested object and array mutation persistence.
- Loaded-memory rollback for failed outer `batch()` calls.
- Prepared statement cache for repeated SQLite operations.
- GitHub Actions CI.

### Boundaries

- This is an alpha baseline, not the full pre-repo v22 experiment.
- Browser adapter is not implemented.
- Real React DOM render tests are not implemented.
- API is not frozen.
- Existing item proxy references captured before a failed batch may be stale after rollback.
