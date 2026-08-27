# Enum narrowing incompatible value evolution experiment

Status: **BOUNDARY CONFIRMED in CI #218; experiment-only.**

Issue: #66

## Goal

Replicate the incompatible-value boundary with a second semantic-change class while keeping durable identity and the queryable field path stable.

```text
state key      jobs        unchanged
item identity  JOB-1       unchanged
field path     mode        unchanged

V1 mode: "auto" | "manual" | "legacy"
  ->
V2 mode: "auto" | "manual"
```

No public migration or validation API is authorized by this result.

## H — hypothesis

Narrowing a TypeScript string union will not validate, reject, or transform an already-persisted value that is no longer part of the union. Such a value must require explicit application policy before it can become V2-compatible.

Because the field remains the same scalar path and scalar type category, ordinary StorekeeperDB mutation should keep an existing projection coherent without migration-specific projection cleanup.

## T — test

V1 persists:

```json
{"id":"JOB-1","mode":"legacy"}
```

Before close, `find("jobs", { mode: "legacy" })` establishes an active scalar projection on `mode`.

### A. Declaration-only negative control

Reopen the V1 database through:

```ts
type JobV2 = {
  id: string;
  mode: "auto" | "manual";
};
```

No migration runs.

### B. Explicit narrowing policy

Use an experiment policy:

```text
legacy -> manual
```

The full operation runs inside one outer `StorekeeperDB.batch()`:

```text
read persisted mode
→ validate known representation
→ require explicit legacy mapping
→ mutate mode to manual
```

Failure is injected after mutation and the complete physical snapshot is compared before and after rollback:

- source item JSON;
- `__sk_paths` observed types and read/write counters;
- derivation row;
- projection cell/value.

After retry, both `legacy` and `manual` queries are checked, and the `manual` result is mutated through the returned durable handle.

### C. Missing-policy negative control

Attempt to migrate `legacy` without a mapping policy.

Expected behavior: reject atomically rather than selecting an allowed value from declaration order, defaults, or heuristics.

## D — result

CI #218 passed full `npm run release:check`.

### Declaration-only behavior

```text
openRejected                         false
runtimeLegacyPreserved               true
freshAllowedDefaultNotApplied        true
samePhysicalItemIdentity             true
legacyProjectionStillMatchesStorage  true
runtimeValue                         legacy
```

The narrower TypeScript union does not transform persisted `"legacy"` and does not provide runtime validation of the stored value.

### Explicit policy and rollback

CI #218 reported:

```text
injectedFailureRejected                  true
exactPhysicalRollback                    true
loadedMemoryRollback                     true
selectedMode                             manual
projectionUpdatedByOrdinaryMutation      true
legacyQueryCount                         0
manualQueryCount                         1
queriesReflectNarrowedValue              true
durableHandleReturned                    true
projectionStillCoherentAfterHandleMutation true
reopenedMode                             manual
```

Equivalent release wording:

```text
exactPhysicalRollback = true
```

The failure-injected attempt restored the item, path counters/types, derivation, and projection exactly.

The successful migration persisted `mode = "manual"` and reopened with only a V2-allowed value.

### Projection behavior

This case differs materially from scalar-to-object evolution.

After `legacy -> manual`, the existing `mode` projection was updated in place by ordinary durable mutation:

```text
before projection value: "legacy"
after  projection value: "manual"
```

Then:

```text
find(mode = "legacy") -> 0
find(mode = "manual") -> 1
```

The returned `manual` item remained a durable handle. Mutating it `manual -> auto -> manual` kept the same projection coherent.

Therefore:

> **ordinary durable mutation kept the existing scalar projection coherent.**

No migration-specific projection eviction or rebuild was required because the path and scalar representation category remained valid.

### Missing mapping policy

Migration without policy rejected with:

```text
Enum narrowing migration requires explicit legacy mapping policy.
```

The value remained `legacy`, and the complete physical snapshot was unchanged.

Machine decision:

```text
BOUNDARY_CONFIRMED_ENUM_NARROWING_REQUIRES_EXPLICIT_VALUE_POLICY
```

## C — competing explanations

One competing explanation was that the narrower TypeScript union would provide runtime protection against persisted `legacy`. The negative control falsified that: open succeeded and `legacy` remained visible.

Another was that changing an indexed scalar category value would require migration-specific derived-state reconstruction. In this scenario, that was unnecessary: normal durable mutation updated the existing scalar projection correctly.

## U — uncertainty

Still untested:

- required-field introduction independent of another representation change;
- field deletion;
- numeric/range validation;
- cross-item invariants;
- migration idempotency and crash/retry markers;
- concurrent old/new application versions;
- whether repeated migration ceremony eventually justifies a dedicated migration context.

This result does not turn TypeScript declarations into runtime schemas.

## Architectural implication

Two incompatible value-semantic classes now show the same core boundary:

```text
static TypeScript declaration
  !=
runtime migration / durable validation
```

But metadata treatment depends on whether the persisted/queryable representation remains structurally valid:

```text
scalar -> object
  old projected representation becomes invalid
  -> retire/rebuild derived metadata

enum narrowing on same scalar path
  projected representation remains scalar and valid
  -> ordinary mutation maintains projection
```

The migration obligation is driven by semantic incompatibility, while derived-metadata work is driven by representation/path compatibility.

No public migration or validation API is authorized by this result.
