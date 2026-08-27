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
- Metadata compaction for bounded magic logs and non-projection path observations.
- Persistent handling for common array mutators: `push`, `pop`, `shift`, `unshift`, `splice`, `sort`, and `reverse`.
- Nested object and array mutation persistence.
- Loaded-memory rollback for failed outer `batch()` calls.
- Prepared statement cache for repeated SQLite operations.
- Public alpha manual in `docs/MANUAL.md`.
- Documentation index in `docs/README.md`.
- Architecture model in `docs/ARCHITECTURE.md`, including local/session/durable/discoverable state boundaries.
- Alpha product refinement process in `docs/EVALUATION_LOOP.md`.
- Durable variable / cross-process bootstrap experiment in `docs/DURABLE_VARIABLE_EXPERIMENT.md` and `scripts/durable_session_experiment.ts`.
- `npm run experiment:durable-session` and deterministic durable-session check in `release:check`.
- Benchmark documentation in `docs/BENCHMARKS.md`.
- Executable benchmark through `npm run benchmark`.
- Consumer install smoke test through `npm run consumer:smoke`.
- Alpha release decision record in `docs/ALPHA_RELEASE_DECISION.md`.
- Draft release notes in `docs/RELEASE_NOTES_0.1.0-alpha.0.md`.
- Public alpha docs: manual, architecture, evaluation loop, durable-variable experiment, benchmarks, release decision, release notes, demo, React verification, magic lifecycle, automatic derived decay, metadata compaction, transaction model, browser boundary, audit notes, next-work plan, and todo example.
- Runtime hardening notes in `docs/RUNTIME_HARDENING.md`.
- Magic lifecycle notes in `docs/MAGIC_LIFECYCLE.md`.
- Automatic derived decay notes in `docs/DECAY.md`.
- Metadata compaction notes in `docs/METADATA_COMPACTION.md`.
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
- `debug().compactMetadata()` now trims magic logs, decays observation counters, and can delete low-value non-projection path observations.
- Metadata compaction preserves source rows, projection cells, and projection-backed path observations.
- Benchmark script now performs semantic pass/fail checks while keeping latency as observational output.
- Release checks now require alpha decision and release-note documentation to exist.
- Release checks now verify the documentation index, architecture document, alpha evaluation loop, and durable-variable experiment notes are included in the public package.
- Release checks now run the cross-process durable-session bootstrap experiment.
- Release checks now verify key prepublish alpha wording: alpha-only tag, not latest, non-stable API, missing browser adapter, experimental SQLite flag, observational benchmark posture, and durable-session architecture boundaries.
- Release checks now install the generated local tarball into a temporary consumer project and verify public subpath imports.
- Release-check fixtures for lifecycle, decay, gate, and demo paths are smaller while preserving projection creation, GC, eviction, rebuild, and source-retention semantics.
- Magic log actions now include `project_mark_cold` and `project_gc_evict` in addition to `project_create`, `project_touch`, `project_evict`, and `project_rebuild`.
- CI now runs `npm run release:check`, including runtime tests, executable scenarios, export checks, prepublish wording inspection, package dry-run, and consumer install smoke testing.
- README and next-work documentation now prioritize realistic alpha evaluation over promotion or speculative lifecycle feature growth.

### Boundaries

- This is an alpha baseline, not the full pre-repo v22 experiment.
- Root `state()` is currently an array-of-objects API, not arbitrary root values.
- `find()` returns cloned snapshots rather than persistent proxy handles.
- Durable source state can be evaluated across process boundaries, but `__workspace` is currently an experiment convention, not a reserved core API.
- The durable-variable experiment does not implement agent memory, checkpoint policy, trust, context selection, or multi-agent coordination.
- Full browser adapter is not implemented.
- Browser-style async storage is explicitly modeled as write-behind; mutation return means memory changed, while `flush()` is the durability barrier.
- Automatic derived decay is opt-in and currently lookup-count-based, not wall-clock-time-based.
- Benchmark timings are observational and not hard release thresholds.
- Benchmark execution is manual for now and intentionally outside `release:check`.
- Alpha publishing remains manual and should use the `alpha` npm dist-tag only.
- Consumer smoke verifies local tarball install behavior, not npm registry behavior.
- Full v22 metadata scoring policy is not re-imported yet.
- Time-based decay and richer metadata scoring are deferred research unless realistic product evaluation demonstrates they are blocking the core value proposition.
- API is not frozen.
- Existing item and nested proxies captured before a failed batch are intentionally stale after rollback; re-read from the state list.
- npm publishing remains manual and intentionally gated by the release checklist.
