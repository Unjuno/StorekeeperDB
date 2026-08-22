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

### 3. Alpha release hygiene — #7

Status: merged.

Delivered:

- Package export checks.
- Package dry-run.
- Release checklist.
- Manual publishing boundary.

### 4. Executable demo

Status: merged.

Delivered:

- `npm run demo`.
- `docs/DEMO.md`.
- Demo included in `release:check`.

## Active work

### 5. React verification — #4

Status: in progress.

Scope:

- Add real React / `react-test-renderer` verification.
- Validate `useSyncExternalStore` behavior.
- Keep the core runtime independent of React.

## Open next work

### 6. Browser boundary experiment — #5

Scope:

- Prototype async write-behind runtime separately from local SQLite.
- Expose `flush()` as the durability barrier.
- Do not claim browser semantics equal Node SQLite semantics.

### 7. Full magic lifecycle re-import — #6

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
- Browser gaps are clearly documented.
- The transaction model is either stable or explicitly scoped as alpha behavior.
- `npm run release:check` passes on a clean checkout.
