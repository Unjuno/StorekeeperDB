# Next work

This document keeps the next StorekeeperDB work explicit after the initial public alpha baseline.

## Completed public setup

### 1. Public alpha polish

Status: merged.

Delivered:

- Changelog.
- Transaction model.
- Browser storage boundary.
- Minimal example.
- README links to public docs.

### 2. Runtime hardening

Status: merged.

Delivered:

- Explicit stale proxy behavior after failed `batch()`.
- Nested rollback tests.
- Projection consistency after supported array mutators.
- Clearer debug output for magic projection changes.
- Runtime hardening notes.

## Open next work

### 3. React verification — #4

Scope:

- Add real React DOM or `react-test-renderer` tests in an environment with React dependencies.
- Validate `useSyncExternalStore` behavior.
- Keep the core runtime independent of React.

### 4. Browser boundary experiment — #5

Scope:

- Prototype async write-behind runtime separately from local SQLite.
- Expose `flush()` as the durability barrier.
- Do not claim browser semantics equal Node SQLite semantics.

### 5. Full magic lifecycle re-import — #6

Scope:

- Reintroduce v20-v22 derived lifecycle features gradually:
  - hot / cold derivation state
  - derived storage budget
  - automatic derived eviction
  - metadata compaction

### 6. Alpha release hygiene — #7

Scope:

- Confirm package exports match actual files.
- Add package dry-run or release checklist.
- Decide whether to advance from `0.1.0-alpha.0` after hardening.
- Keep publishing manual until the API boundary is intentionally accepted.

## Release posture

Keep `0.1.0-alpha.0` until:

- CI passes consistently.
- README matches actual public implementation.
- Browser and React gaps are clearly documented.
- The transaction model is either stable or explicitly scoped as alpha behavior.
