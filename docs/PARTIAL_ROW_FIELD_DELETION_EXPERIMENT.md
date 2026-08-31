# Partial-row field deletion experiment

Status: **MIXED in CI #252 — current-state correctness replicated; changed-item projection maintenance is item-local rather than cell-selective.**

Issue: #74

## H — hypothesis

Deleting a projected field from one durable row while the same path remains present on another row will preserve the surviving row and update only the deleted projection cell.

## T — test

Start with two durable rows:

```text
JOB-1 { id, queue, legacyTag: "legacy-one" }
JOB-2 { id, queue, legacyTag: "legacy-two" }
```

Activate projections for both `queue` and `legacyTag`, then delete only `JOB-1.legacyTag` through the normal durable handle.

The experiment also installs SQLite triggers over `__sk_projection` after fixture setup so projection DELETE/INSERT/UPDATE operations can be audited without changing application mutation/query behavior.

It verifies:

1. injected failure restores exact source/projection/derivation state;
2. successful deletion removes only JOB-1's source `legacyTag`;
3. JOB-2's `legacyTag` source value and projection remain queryable;
4. a `find()` result for JOB-2 remains a durable mutable handle;
5. item identity and order remain stable;
6. reopen preserves the mixed topology;
7. projection writes during JOB-1 deletion do not touch JOB-2;
8. the write audit distinguishes a deleted-cell-only update from a changed-item projection rebuild.

The latest result is guarded by `test/partial_row_field_deletion_result.test.ts`, which requires the exact decision and correctness booleans rather than treating any valid experiment exit as success.

## D — decision

CI #252 passed the full `npm run release:check` with this exact asserted decision:

```text
MIXED_PARTIAL_ROW_DELETE_REBUILDS_ITEM_PROJECTIONS_BUT_STAYS_CORRECT
```

Asserted checks:

```text
currentStateCorrect                 true
queriesAndDurableHandleCorrect      true
reopenMixedTopologyCoherent         true
itemLocalProjectionIsolation        true
itemLocalProjectionRebuildObserved  true
minimalDeletedCellOnly              false
```

The runtime maintenance path explains the audit result: for a changed item, StorekeeperDB iterates active derivations, deletes each corresponding projection cell, and reinserts the cell when the current value is still scalar.

For this topology the effective projection work is therefore:

```text
JOB-1 queue      DELETE + INSERT
JOB-1 legacyTag  DELETE
JOB-2            no projection writes during JOB-1 deletion
```

This is not a correctness failure. The durable source, query behavior, surviving-row projection, durable-handle semantics, rollback, and reopen state are coherent.

## C — competing explanation / failure mode

The observed item-local rebuild may be intentional and inexpensive for prototype-scale projected-path counts. A more selective cell-diff algorithm would add implementation complexity and could introduce its own stale-cell or rollback defects.

Therefore this result does **not** justify an optimization by itself. It only establishes a deterministic internal write-amplification mechanism.

A future optimization is justified only if a separate scaling experiment shows material cost as the number of active projected paths grows.

## U — uncertainty

This experiment uses two rows and two active projected paths. It establishes write topology, not practical latency impact.

The next measurement should vary active projected-path count `P` while mutating one item and record deterministic projection row writes `W(P)` plus observational wall time. Candidate points:

```text
P = 1, 4, 16, 64
```

If the current implementation dominates, expected write count is approximately linear in `P`. Timing should be reported with warmup and median/range and should not become a brittle release latency gate.

## Interpretation

Evidence now separates two concerns:

```text
field deletion correctness       -> replicated on mixed-row topology
projection maintenance granularity -> item-local rebuild
```

The smallest justified next step is measurement, not runtime optimization.
