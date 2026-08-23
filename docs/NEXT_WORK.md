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

### 7. Full magic lifecycle re-import — #6

Status: completed for public alpha.

Delivered across multiple PRs:

- Manual derived projection lifecycle.
- `debug().markCold()`.
- `debug().collectGarbage()`.
- Source rows remain after projection GC.
- Budget-based projection eviction and rebuild.
- Opt-in `decay` option.
- Lookup-count-triggered derived GC.
- Automatic `maxDerivations` enforcement.
- Current lookup path protection during the same GC pass.
- `debug().compactMetadata()` for magic logs and path observations.
- Path observation count decay.
- Low-value non-projection observation deletion.
- Source rows, projection cells, and projection-backed observations preserved by metadata compaction.

See [Magic re-import status](./MAGIC_REIMPORT_STATUS.md).

### 8. Manual and benchmark layer

Status: merged.

Delivered:

- Public alpha manual.
- Executable benchmark script.
- Benchmark documentation.
- Benchmark timings scoped as observational, not a hard release gate.

### 9. Alpha release decision

Status: merged.

Delivered:

- Public alpha candidate decision record.
- Draft release notes.
- Manual publish boundary: alpha dist-tag only.
- Release check validates decision and release notes documents exist.

## Active work

### 10. Final prepublish inspection

Status: in progress.

Scope:

- Make release checks verify key public alpha wording, not only file existence.
- Ensure `release:check` rejects accidental removal of alpha disclaimers.
- Keep benchmark timing outside the release gate.
- Keep npm publishing manual.

## Open next work

### 11. Time-based lifecycle decay — #16

Scope:

- Add optional time-based cold marking.
- Add optional periodic derived GC independent of lookup count.
- Keep background behavior explicit; do not introduce hidden async work.

### 12. Metadata scoring policy — #17

Scope:

- Reintroduce fuller v22 metadata scoring policy only after the compactMetadata boundary is stable.
- Keep source state and required projection state outside metadata scoring deletion.

### 13. Post-alpha publication follow-up

Scope:

- Verify published package install behavior from a clean consumer project.
- Confirm GitHub release notes match the published tarball.
- Track early user-facing friction in issues.
- Decide when to move from alpha candidate to broader alpha use.

## Release posture

`0.1.0-alpha.0` can be treated as a public alpha candidate only when:

- CI passes consistently.
- README matches actual public implementation.
- Browser gaps are clearly documented.
- The transaction model is either stable or explicitly scoped as alpha behavior.
- `npm run release:check` passes on a clean checkout.
- Alpha release decision notes are accepted by a maintainer.
