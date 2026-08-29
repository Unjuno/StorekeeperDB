# Field deletion with active derived metadata experiment

Status: **RUNNING; experiment-only.**

Issue: #72

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

Expected: `legacyTag` remains in durable source JSON and its existing projection remains present. A TypeScript shape change must not be mistaken for value migration.

### B. Explicit durable property delete

Execute:

```ts
delete job.legacyTag;
```

inside one outer `batch()`.

First inject a failure after the delete and require an exact physical rollback of item/path/derivation/projection state. Then execute the deletion successfully and verify source JSON, projections, queries, and reopen behavior.

### C. Explicit derivation eviction control

After a successful field delete, call the existing debug lifecycle control:

```ts
sk.debug().evict("jobs", ["legacyTag"]);
```

Measure whether derivation/projection state disappears and whether path-observation history remains.

## D — candidate decisions

```text
BOUNDARY_CONFIRMED_FIELD_DELETE_CURRENT_STATE_COHERENT_METADATA_RETAINED
BOUNDARY_CONFIRMED_FIELD_DELETION_REQUIRES_EXPLICIT_VALUE_POLICY
MIXED_FIELD_DELETE_REQUIRES_METADATA_CLEANUP
MIXED_FIELD_DELETE_NOT_SUPPORTED_BY_DURABLE_HANDLE
INVALID_EXPERIMENT
```

A result that retains historical metadata while keeping source/query/projection state correct is deliberately distinct from a metadata correctness failure.

## C — competing explanations

### Property deletion may not be a supported durable mutation

Runtime inspection shows `deleteProperty` traps on both root item handles and nested durable values. The executable experiment still verifies actual persistence and rollback rather than relying on inspection alone.

### A retained derivation row means deletion failed

Not necessarily. A projection with zero cells can still be coherent for a path absent from all current rows. The experiment checks query behavior and source state before classifying retained derivation metadata.

### All metadata should disappear automatically

That is a lifecycle-policy claim, not a current-value correctness requirement. `__sk_paths` may intentionally retain observation history. The explicit eviction control separates derivation retirement from path-history retention.

## U — uncertainty

Still untested:

- deleting the field from only some rows;
- nested field deletion;
- field reintroduction after deletion;
- automatic decay/compaction of obsolete metadata;
- concurrent old/new writers;
- whether a public cleanup API is desirable;
- public migration API ergonomics.

## Critical question

> Does ordinary durable property deletion fully correct current source/query/projection state, while leaving only historical lifecycle metadata behind?
