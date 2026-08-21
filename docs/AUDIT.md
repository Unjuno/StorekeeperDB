# StorekeeperDB alpha audit

This audit was performed while preparing the public repository for a buildable alpha baseline.

## Main findings

1. **Single-file runtime was too dense.**
   The first public alpha had most behavior in `src/index.ts`. This made the code difficult to inspect and made public package boundaries fragile.

2. **Subpath exports were incomplete.**
   `package.json` exposed `./core`, `./node`, `./react`, and `./experimental`, but the minimal public import did not initially provide all matching source files.

3. **Some ordinary array operations could diverge from SQLite.**
   If a persistent array looks ordinary, common mutations must either persist correctly or fail loudly. Silent divergence is worse than missing functionality.

4. **Projection cells could become stale.**
   When a projected scalar value was deleted or changed to a non-scalar value, the derived lookup row needed to be removed.

5. **Failed batch rollback needed memory handling.**
   SQLite rollback alone is insufficient if loaded proxy state remains mutated.

6. **Read observation was too expensive for alpha.**
   Per-read SQLite metadata writes made `find()` far too slow. The alpha now keeps write observation and avoids durable read-count writes on hot paths.

## Changes made

- Split the runtime into small modules:
  - `src/runtime.ts`
  - `src/live.ts`
  - `src/types.ts`
  - `src/utils.ts`
  - entry shims: `core`, `node`, `react`, `experimental`
- Added prepared statement caching.
- Added durable handling for common array mutators.
- Added nested object/array mutation coverage.
- Added projection-cell cleanup when a scalar path disappears.
- Added memory rollback for loaded state on failed outer batch.
- Added tests for the above behavior.
- Updated README to reflect the alpha boundary and avoid overclaiming.

## Validation

Local container validation:

```text
npm run build
npm test
npm run gate
```

Result:

```text
9 tests passed
gate pass: true
```

## Remaining risks

- Existing references to item proxies from before a failed batch can still be stale. The loaded list state is restored, but external item object references should not be treated as durable handles across failed transactions.
- `live()` / `liveFind()` use JSON equality for alpha-level change detection. This is acceptable for prototype tests but not final performance architecture.
- Browser durability semantics remain unsolved; async storage must not pretend to have the same guarantees as sync local SQLite.
- Real React DOM render behavior is not yet tested.
