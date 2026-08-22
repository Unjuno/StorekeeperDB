# Changelog

All notable changes to StorekeeperDB will be tracked here.

## 0.1.0-alpha.0 - unreleased

Initial public alpha baseline plus first hardening passes.

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
- Public alpha docs: transaction model, browser boundary, audit notes, next-work plan, and todo example.
- Runtime hardening notes in `docs/RUNTIME_HARDENING.md`.
- Release checklist in `docs/RELEASE.md`.
- GitHub Actions CI.

### Hardened

- Failed outer `batch()` calls now invalidate item and nested proxies captured before rollback.
- Projection cells are removed when a scalar path disappears.
- Supported array mutators are covered by projection and reopen tests.
- Nested object/array mutation persistence is covered by reopen tests.
- Signal subscribers receive one notification after an outer batch commit.
- Magic log actions now use clearer names: `project_create`, `project_touch`, `project_evict`, and `project_rebuild`.
- CI now runs `npm run release:check`, including export artifact checks and `npm pack --dry-run`.

### Boundaries

- This is an alpha baseline, not the full pre-repo v22 experiment.
- Browser adapter is not implemented.
- Real React DOM render tests are not implemented.
- API is not frozen.
- Existing item and nested proxies captured before a failed batch are intentionally stale after rollback; re-read from the state list.
- npm publishing remains manual and intentionally gated by the release checklist.
