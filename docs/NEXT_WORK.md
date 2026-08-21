# Next work

This document keeps the next StorekeeperDB work explicit after the initial public alpha baseline.

## Immediate next PRs

### 1. Public alpha polish

Status: this document set.

Scope:

- Changelog.
- Transaction model.
- Browser storage boundary.
- Minimal example.
- README links to public docs.

### 2. Runtime hardening

Scope:

- Explicit stale proxy behavior after failed `batch()`.
- More nested rollback tests.
- Projection consistency after every supported array mutator.
- Better debug output for magic projection changes.

### 3. React verification

Scope:

- Add real React DOM or `react-test-renderer` tests in an environment with React dependencies.
- Validate `useSyncExternalStore` behavior.
- Keep the core runtime independent of React.

### 4. Browser boundary experiment

Scope:

- Prototype async write-behind runtime separately from local SQLite.
- Expose `flush()` as the durability barrier.
- Do not claim browser semantics equal Node SQLite semantics.

### 5. Full magic lifecycle re-import

Scope:

- Reintroduce v20-v22 derived lifecycle features gradually:
  - hot / cold derivation state
  - derived storage budget
  - automatic derived eviction
  - metadata compaction

## Release posture

Keep `0.1.0-alpha.0` until:

- CI passes consistently.
- README matches actual public implementation.
- Browser and React gaps are clearly documented.
- The transaction model is either stable or explicitly scoped as alpha behavior.
