# Scalar-to-object incompatible value evolution experiment

Status: **BOUNDARY CONFIRMED in CI #211; experiment-only.**

Issue: #64

## Goal

Locate the point where StorekeeperDB's compatible JSON evolution stops when durable state identity and the field name stay stable but the persisted value changes semantic shape.

This experiment deliberately isolates **value semantics** from durable-key identity.

```text
state key: jobs        unchanged
item identity: JOB-1   unchanged
field path: retryPolicy unchanged

V1 retryPolicy: number
        ↓
V2 retryPolicy: { delayMs: number; maxAttempts: number }
```

No public migration API is authorized by this result.

## H — hypothesis

Changing only the TypeScript declaration will not migrate an already-persisted scalar into a structured object. An explicit transform should be required because the new object contains both a changed representation and a newly required value.

The current `batch()`, durable-handle, and derived-metadata lifecycle primitives should nevertheless be sufficient to perform the migration atomically in this controlled scenario.

## T — test

V1 persisted:

```json
{
  "id": "JOB-1",
  "retryPolicy": 750
}
```

Before evolution, a `find()` on `retryPolicy = 750` establishes an active scalar projection.

Three core cases were tested.

### A. Declaration-only negative control

The database is reopened through a V2 TypeScript declaration:

```ts
type JobV2 = {
  id: string;
  retryPolicy: {
    delayMs: number;
    maxAttempts: number;
  };
};
```

No transform runs.

### B. Explicit scalar-to-object transform

Inside one outer `StorekeeperDB.batch()`:

```text
read old retryPolicy scalar
→ validate V1 representation
→ require explicit maxAttempts policy
→ replace scalar with { delayMs, maxAttempts }
→ retire obsolete retryPolicy scalar projection
```

Failure is injected after value and metadata mutations. The complete physical snapshot is compared before and after rollback:

- source item JSON;
- path rows including observed type and read/write counters;
- derivations;
- projection cells.

After retry succeeds, the experiment queries:

```text
retryPolicy.delayMs = 750
```

and mutates `maxAttempts` through the returned durable handle.

### C. Missing required-field policy

The same migration is attempted without a `maxAttempts` policy.

Expected behavior: reject atomically rather than inventing a default.

## D — result

CI #211 passed the full `npm run release:check`.

### Declaration-only behavior

```text
runtimeScalarPreserved             true
automaticObjectConversionAbsent    true
freshV2DefaultNotApplied           true
samePhysicalItemIdentity           true
oldScalarProjectionStillPresent    true
runtimeType                        number
```

The persisted value remained:

```json
{"id":"JOB-1","retryPolicy":750}
```

Therefore:

> **TypeScript declaration change alone does not migrate persisted semantic shape.**

Static typing can describe the V2 expectation, but it does not rewrite durable runtime JSON.

### Explicit migration and rollback

CI #211 reported:

```text
injectedFailureRejected       true
exactPhysicalRollback         true
loadedMemoryRollback          true
selectedDelayMs               750
obsoleteScalarProjectionRetired true
reopenedV2Object              true
```

Equivalent release wording:

```text
exactPhysicalRollback = true
```

The failure-injected attempt restored the source item, path observation counters/types, derivation, and scalar projection exactly.

The successful retry persisted:

```json
{
  "id": "JOB-1",
  "retryPolicy": {
    "delayMs": 750,
    "maxAttempts": 3
  }
}
```

### Required-field policy

Migration without an explicit policy rejected with:

```text
Scalar-to-object migration requires explicit maxAttempts policy.
```

The scalar value and physical metadata snapshot remained unchanged.

### Projection transition

After successful migration:

- the obsolete root scalar `retryPolicy` projection/derivation was absent;
- `find()` on `retryPolicy.delayMs = 750` matched the migrated item;
- a new projection/derivation was created for `retryPolicy.delayMs`;
- mutating `retryPolicy.maxAttempts` through the returned item remained durable;
- reopen preserved `maxAttempts = 4` after that durable-handle mutation.

This reuses the existing command/query contract rather than creating migration-specific handle semantics.

Machine decision:

```text
BOUNDARY_CONFIRMED_SCALAR_TO_OBJECT_REQUIRES_EXPLICIT_VALUE_MIGRATION
```

## C — competing explanation

A competing explanation was that JSON-backed storage plus the new TypeScript declaration could transparently reinterpret the scalar as the new object representation.

The declaration-only negative control falsified that explanation: the runtime value remained the number `750`, and the old scalar projection remained valid for the unchanged persisted representation.

Another competing explanation was that the transform required a new migration-specific runtime primitive. In this one-item scenario, the current primitives were sufficient:

```text
batch()
+ durable handle mutation
+ explicit validation/policy
+ debug lifecycle eviction
```

That does not prove those primitives are sufficient for every incompatible migration.

## U — uncertainty

Still untested:

- enum narrowing;
- general required-field introduction independent of a shape transform;
- field deletion;
- collection-level value transforms;
- migration idempotency / crash-retry markers;
- concurrent old/new application versions;
- whether repeated migration ceremony eventually justifies a dedicated migration context.

The experiment also does not add runtime schema validation. A TypeScript type remains a compile-time declaration, not a durable-data validator.

## Architectural implication

The observed boundary is narrower than “any schema change requires migration.”

```text
compatible additive JSON evolution
  -> can remain automatic in tested scenarios

persisted semantic-shape change
  -> explicit value interpretation
  -> explicit policy for newly required information
  -> atomic transform
  -> derived metadata reconciliation
```

The durable state identity can remain completely stable while migration becomes necessary. That separates **identity evolution** from **value-semantic evolution**.

No public migration API is authorized by this result.
