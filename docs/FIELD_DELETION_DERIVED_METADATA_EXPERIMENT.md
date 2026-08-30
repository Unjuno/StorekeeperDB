# Field deletion with active derived metadata experiment

Status: **BOUNDARY CONFIRMED in CI #241; experiment-only.**

Issue: #72

Decision:

```text
BOUNDARY_CONFIRMED_FIELD_DELETE_CURRENT_STATE_COHERENT_METADATA_RETAINED
```

## Goal

Determine whether deleting a persisted field through ordinary StorekeeperDB durable handles fully retires current value-specific derived state, and separately measure which historical observation/derivation metadata remains.

No public migration API or automatic metadata-cleanup policy is added by this experiment.

## H — falsifiable hypothesis

For a persisted scalar field with an active projection, ordinary durable property deletion should be sufficient for current-state correctness:

1. source JSON loses the field;
2. the deleted field's projection cell disappears;
3. unrelated projections remain coherent;
4. an injected failure rolls back source and derived state exactly;
5. close/reopen preserves field absence;
6. a query for the removed value returns zero results.

Retention of `__sk_paths` or `__sk_derivations` rows is measured separately. Historical metadata retention is not classified as current-state corruption unless it produces incorrect query/source behavior.

## T — controlled scenario

```text
V1 jobs
{ id, queue, legacyTag }

  ->

V2 jobs
{ id, queue }
```

Before migration, both `queue` and `legacyTag` are projected through normal `find()` usage.

The experiment runs three cases.

### A. Declaration-only negative control

Reopen the V1 database through a V2 TypeScript declaration without mutating the row.

Observed in CI #241:

```text
legacyTagStillPersisted      true
sameItemIdentity             true
legacyProjectionStillPresent true
```

A TypeScript shape change therefore does not erase the persisted field or its active derived state.

### B. Explicit durable property delete

Execute:

```ts
delete job.legacyTag;
```

inside one outer `batch()`.

First inject a failure after the delete and require an exact physical rollback of item/path/derivation/projection state. Then execute the deletion successfully and verify source JSON, projections, queries, and reopen behavior.

Observed in CI #241:

```text
injectedFailureRejected        true
deleteTrapReached              true
exactPhysicalRollback          true
loadedMemoryRollback           true
successRejected                false
sourceFieldAbsent              true
legacyProjectionCellRemoved    true
legacyDerivationRetained       true
legacyPathMetadataRetained     true
queueProjectionPreserved       true
legacyQueryCount               0
queueQueryCount                1
queryStateCoherent             true
reopenPreservesAbsence         true
reopenKeepsLegacyProjectionEmpty true
reopenKeepsLegacyDerivation    true
```

The key result is that current source/query/projection state becomes correct without an explicit metadata-cleanup step. The projection cell for the deleted field disappears automatically when the item is saved, while the derivation catalog row remains.

### C. Explicit derivation eviction control

After a successful field delete, call the existing debug lifecycle control:

```ts
sk.debug().evict("jobs", ["legacyTag"]);
```

Observed in CI #241:

```text
derivationPresentBeforeEvict   true
projectionCellsBeforeEvict     0
pathMetadataPresentBeforeEvict true
derivationRemovedByEvict       true
projectionCellsAfterEvict      0
pathMetadataRetainedAfterEvict true
```

This separates two metadata classes:

```text
projection cell
  -> current-value materialization
  -> automatically disappears when the field disappears from the row

derivation row
  -> projection lifecycle/catalog state
  -> retained until explicit eviction/lifecycle cleanup

path row
  -> observation history
  -> retained even after derivation eviction
```

## D — result

```text
BOUNDARY_CONFIRMED_FIELD_DELETE_CURRENT_STATE_COHERENT_METADATA_RETAINED
```

Checks reported by CI #241:

```text
declarationShapeDoesNotDeletePersistedField            true
rollbackAndDurableDeleteWork                            true
currentDerivedStateCoherentWithoutCleanup               true
historicalMetadataRetained                              true
explicitDerivationEvictionWorksButPathHistoryRemains    true
durableHandleDeleteUnsupported                          false
```

Interpretation:

> Field deletion is an explicit semantic policy, but ordinary durable property deletion is mechanically sufficient for current source/query correctness in this single-row scenario. Source JSON loses the field, its projection cell disappears, unrelated projections stay coherent, rollback is exact, and reopen preserves absence. Historical derivation/path metadata remains and is a separate lifecycle-policy question rather than current-state corruption.

## C — competing explanations

### Property deletion may not be a supported durable mutation

Rejected for this scenario. Runtime inspection found `deleteProperty` traps on both root item handles and nested durable values, and CI #241 verified that the actual mutation persists and rolls back correctly.

### A retained derivation row means deletion failed

Rejected as a current-state correctness claim. The retained `legacyTag` derivation had zero projection cells, `find({ legacyTag: oldValue })` returned zero, and reopen preserved the deleted source field.

### All metadata should disappear automatically

Not established. The experiment shows that this is a lifecycle-policy question, not a prerequisite for current-value correctness. Explicit derivation eviction removes the derivation while `__sk_paths` still retains observation history.

### The single-row result proves mixed-row correctness

Not established. If only some rows lose a field, the same derivation must retain cells for surviving rows while dropping cells only for changed rows. That topology is the next replication target.

## U — uncertainty

Still untested:

- deleting the field from only some rows;
- nested field deletion;
- field reintroduction after deletion;
- automatic decay/compaction of obsolete metadata;
- concurrent old/new writers;
- whether a public cleanup API is desirable;
- public migration API ergonomics.

## Next falsification target

Use multiple durable rows where only one row loses `legacyTag` while another keeps it.

Required invariant:

```text
removed-row legacyTag cell  -> absent
surviving-row legacyTag cell -> present and queryable
queue cells                   -> unaffected
source rows                   -> preserve item identity
failure injection             -> exact rollback
reopen                        -> same selective topology
```

## Critical question

> Does the projection update remain item-selective when a field exists on only a subset of rows, or did the single-row experiment hide a whole-path rebuild or retirement bug?
