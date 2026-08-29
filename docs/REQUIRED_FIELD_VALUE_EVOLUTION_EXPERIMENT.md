# Required-field value evolution experiment

Status: **BOUNDARY CONFIRMED in CI #224; experiment-only.**

Issue: #68

## Goal

Isolate required-field introduction from representation change. The durable state key, item identity, and existing field meanings remain stable while V2 requires a property that persisted V1 rows do not contain.

This experiment does not add a schema/validation DSL or public migration API.

## H — falsifiable hypothesis

Adding a required TypeScript property does not backfill already-persisted objects. Existing V1 rows should reopen with the field absent at runtime, so a V2 invariant requires an explicit application backfill policy. Existing `batch()` plus durable mutation should be sufficient to apply that policy atomically without disturbing unrelated active projections.

## T — controlled scenario

Stable durable identity:

```text
state key      jobs
item identity  JOB-1
existing path  queue
```

Shape transition:

```text
V1 { id: string; queue: "fast" | "bulk" }
  ->
V2 { id: string; queue: "fast" | "bulk"; maxRetries: number }
```

V1 persists:

```json
{"id":"JOB-1","queue":"bulk"}
```

and establishes an active scalar projection on `queue` before close.

The V2 initializer deliberately contains `maxRetries: 99` so accidental initializer merging is observable.

The explicit experiment backfill policy is:

```text
missing maxRetries -> 3
```

## D — result

CI #224 passed full `npm run release:check` and selected:

```text
BOUNDARY_CONFIRMED_REQUIRED_FIELD_REQUIRES_EXPLICIT_BACKFILL_POLICY
```

### A. Declaration-only negative control

Reopening the V1 database through the V2 TypeScript declaration produced:

```text
openRejected                         false
maxRetriesAbsentAtRuntime            true
freshV2DefaultNotMerged              true
freshV2DefaultApplied                false
samePhysicalItemIdentity             true
queueProjectionStillMatchesStorage   true
runtimeQueue                         bulk
```

The persisted item JSON remained:

```json
{"id":"JOB-1","queue":"bulk"}
```

Reading the absent property recorded an observation for `maxRetries` with `observed_type = undefined`, but did not mutate the durable item or merge the V2 initializer value `99`.

Therefore:

> A required TypeScript property and a fresh V2 initializer are not a migration mechanism for a preexisting durable row.

### B. Explicit backfill with failure injection

One outer `batch()` performs:

```text
read current maxRetries
-> validate existing value if present
-> require explicit backfill if absent
-> write maxRetries
```

Failure injected after the durable write produced:

```text
injectedFailureRejected   true
exactPhysicalRollback = true
loadedMemoryRollback      true
```

The exact physical comparison includes:

- item JSON;
- path observed types and read/write counters;
- the existing `queue` derivation;
- the existing `queue` projection;
- absence of a durable `maxRetries` value/metadata change after rollback.

Successful retry produced:

```text
selectedMaxRetries                    3
requiredFieldPersistedBeforeQuery     true
queueProjectionPreservedAfterBackfill true
maxRetriesProjectionAbsentBeforeQuery true
reopenedMaxRetries                    3
reopenedQueue                         bulk
```

Immediately after backfill, the persisted item was:

```json
{"id":"JOB-1","queue":"bulk","maxRetries":3}
```

The existing `queue` projection remained intact. No `maxRetries` projection existed until the new field was queried.

### C. Missing-policy negative control

Without a backfill policy the migration rejected with:

```text
Required-field migration requires explicit maxRetries backfill policy.
```

Observed:

```text
rejected               true
explicitPolicyRequired true
valueStillAbsent       true
exactPhysicalRollback  true
```

No default was inferred from the TypeScript declaration, initializer, numeric zero, or any other convention.

### D. Query and durable-handle transition

After successful backfill:

```text
find("jobs", { queue: "bulk" })     -> 1
find("jobs", { maxRetries: 3 })     -> 1
```

The first query continued to use the existing projection. The second created the new scalar `maxRetries` projection on demand.

Observed:

```text
queriesReflectBackfill              true
durableHandleReturned               true
maxRetriesProjectionCoherent        true
queueProjectionStillCoherent        true
reopenedBackfillPreserved           true
```

Mutating `maxRetries` through the `find()`-returned durable handle (`3 -> 4 -> 3`) kept the new projection coherent and reopened as `3`.

## Interpretation

The incompatible-value boundary now covers a required invariant independently of representation change:

```text
static required TypeScript property
  !=
durable required-field backfill
```

The application owns the new semantic choice (`maxRetries = 3`). StorekeeperDB can keep the persistence mechanics transactional and can preserve unrelated derived state while creating new query metadata normally on demand.

This differs from scalar-to-object evolution: no existing query representation became invalid, so no projection retirement was required.

A narrower rule is supported:

> Semantic incompatibility determines when application policy must become explicit. Migration-specific metadata work is required only when an existing persisted/queryable representation becomes invalid.

## C — competing explanations

### V2 initializer merge

Falsified in this scenario. `maxRetries: 99` in the V2 initializer was not merged into the existing V1 row.

### Runtime required-field validation

Falsified in this scenario. Reopen succeeded and returned `undefined` for the missing required property.

### New-field backfill damages unrelated projection state

Not observed. The existing `queue` derivation/projection survived failed migration rollback and successful backfill unchanged.

### Dedicated migration runtime is already necessary

Not supported by this controlled case. Existing primitives were sufficient:

```text
batch()
+ durable handle mutation
+ explicit application policy
+ ordinary projection creation/update
```

## U — uncertainty

Still untested:

- field deletion semantics;
- numeric/range validation beyond the explicit backfill check;
- cross-field and cross-item invariants;
- migration idempotency and crash/retry markers;
- concurrent old/new application versions;
- whether repeated explicit policies justify a dedicated migration context.

No public migration API is authorized by this result.

## Next experiment

The next boundary is no longer whether an incompatible migration needs explicit application policy; three value-evolution probes now support that.

The next question is operational:

> After migration code exists, how does an application know whether it should run, has already run, or must be retried after interruption?

Evaluate a minimal atomic migration marker/version convention before considering any migration DSL.
