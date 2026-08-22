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
- Derived projection lifecycle debug APIs: `debug().markCold()` and `debug().collectGarbage()`.
- Opt-in automatic derived projection decay through `decay` options.
- Persistent handling for common array mutators: `push`, `pop`, `shift`, `unshift`, `splice`, `sort`, and `reverse`.
- Nested object and array mutation persistence.
- Loaded-memory rollback for failed outer `batch()` calls.
- Prepared statement cache for repeated SQLite operations.
- Public alpha docs: demo, React verification, magic lifecycle, automatic derived decay, transaction model, browser boundary, audit notes, next-work plan, and todo example.
- Runtime hardening notes in `docs/RUNTIME_HARDENING.md`.
- Magic lifecycle notes in `docs/MAGIC_LIFECYCLE.md`.
- Automatic derived decay notes in `docs/DECAY.md`.
- Release checklist in `docs/RELEASE.md`.
- Executable demo through `npm run demo`.
- Real React verification for `@storekeeper/db/react` using `useSyncExternalStore` and `react-test-renderer`.
- Experimental async write-behind boundary model through `@storekeeper/db/experimental`.
- GitHub Actions CI.

### Hardened

- Failed outer `batch()` calls now invalidate item and nested proxies captured before rollback.
- Projection cells are removed when a scalar path disappears.
- Supported array mutators are covered by projection and reopen tests.
- Nested object/array mutation persistence is covered by reopen tests.
- Signal subscribers receive one notification after an outer batch commit.
- `live()` and `liveFind()` cache snapshots so React `useSyncExternalStore` receives stable snapshot objects.
- Derived projections can be marked cold, garbage-collected, budget-limited, automatically budget-collected, and rebuilt from source rows.
- Automatic derived GC protects the path used by the current `find()` call from the same collection pass.
- Magic log actions now include `project_mark_cold` and `project_gc_evict` in addition to `project_create`, `project_touch`, `project_evict`, and `project_rebuild`.
- CI now runs `npm run release:check`, including export artifact checks, React verification, the executable demo, lifecycle/decay tests, and `npm pack --dry-run`.

### Boundaries

- This is an alpha baseline, not the full pre-repo v22 experiment.
- Full browser adapter is not implemented.
- Browser-style async storage is explicitly modeled as write-behind; mutation return means memory changed, while `flush()` is the durability barrier.
- Automatic derived decay is opt-in and currently lookup-count-based, not wall-clock-time-based.
- Full v22 metadata score compaction is not re-imported yet.
- API is not frozen.
- Existing item and nested proxies captured before a failed batch are intentionally stale after rollback; re-read from the state list.
- npm publishing remains manual and intentionally gated by the release checklist.
