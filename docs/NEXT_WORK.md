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

### 5. React verification — #4

Status: merged.

Delivered:

- Real React / `react-test-renderer` verification.
- `useSyncExternalStore` behavior checked against `liveFind()`.
- Core runtime remains independent of React.
- `live()` / `liveFind()` snapshot caching hardened.

### 6. Browser boundary experiment — #5

Status: merged.

Delivered:

- Experimental async write-behind runtime separated from local SQLite.
- `flush()` defined as the durability barrier.
- Dirty / clean / failed durability states covered by tests.

## Active work

### 7. Full magic lifecycle re-import — #6

Status: in progress.

Current pass:

- Reintroduce manual derived projection lifecycle first.
- Add `debug().markCold()`.
- Add `debug().collectGarbage()`.
- Verify source rows remain after projection GC.
- Verify budget-based projection eviction and rebuild.

## Open next work

### 8. Automatic lifecycle decay

Scope:

- Add optional time-based cold marking.
- Add optional periodic derived GC.
- Keep defaults conservative for alpha.

### 9. Metadata compaction re-import

Scope:

- Expand `compactMetadata()` beyond magic-log count trimming.
- Reintroduce observation metadata compaction in a bounded way.
- Avoid deleting source state or required projection state.

## Release posture

Keep `0.1.0-alpha.0` until:

- CI passes consistently.
- README matches actual public implementation.
- Browser gaps are clearly documented.
- The transaction model is either stable or explicitly scoped as alpha behavior.
- `npm run release:check` passes on a clean checkout.
