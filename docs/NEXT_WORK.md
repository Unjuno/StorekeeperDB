# Next work

This document tracks current StorekeeperDB priorities. Historical implementation details belong in the changelog, merged pull requests, and subsystem notes; this file should answer one question: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The product direction is agent-oriented: StorekeeperDB is being evaluated as a **durable programming model for rapid agent-generated TypeScript prototypes**. The target is to remove persistence architecture decisions from the coding agent's normal planning path wherever doing so remains safe and explainable.

Working rule:

> **Persistence should normally not enter the coding agent's planning loop. Hard persistence problems must remain observable and controllable.**

See [Alpha evaluation loop](./EVALUATION_LOOP.md), [Architecture](./ARCHITECTURE.md), [State split migration boundary experiment](./STATE_SPLIT_MERGE_BOUNDARY_EXPERIMENT.md), [State merge migration boundary experiment](./STATE_MERGE_BOUNDARY_EXPERIMENT.md), [Scalar-to-object value evolution experiment](./SCALAR_TO_OBJECT_VALUE_EVOLUTION_EXPERIMENT.md), [Enum narrowing value evolution experiment](./ENUM_NARROWING_VALUE_EVOLUTION_EXPERIMENT.md), and [Required-field value evolution experiment](./REQUIRED_FIELD_VALUE_EVOLUTION_EXPERIMENT.md).

## Active priorities

### 1. Evaluate migration idempotency and crash/retry markers

Status: **next operational migration experiment after three incompatible-value boundary confirmations.**

Current experiments establish that an explicit migration can be atomic once its code is running. They do not establish how an application knows whether that migration:

- has never run;
- committed successfully;
- should be skipped on reopen;
- must be retried after interruption;
- conflicts with the actual durable value state.

Use the required-field scenario because it has the smallest transformation surface:

```text
V1 jobs/JOB-1
{ id, queue }

  -> explicit backfill ->

V2 jobs/JOB-1
{ id, queue, maxRetries: 3 }
```

Introduce an **experiment-only durable migration marker/version convention**, not a public API. The marker and value transformation must commit in the same outer `batch()`.

Required cases:

1. no marker + unmigrated value -> migration applies and marker commits atomically;
2. marker + migrated value -> rerun skips safely and does not increment write/observation state unnecessarily;
3. failure after value mutation but before marker mutation -> both value and marker roll back;
4. failure after marker mutation but before outer commit -> both marker and value roll back;
5. close/reopen after failed attempt -> retry succeeds once;
6. marker present while value is still unmigrated/incompatible -> fail loudly as inconsistent durable state, not silently skip;
7. migrated value present while marker is absent -> determine whether precondition inspection can safely recover or whether this is ambiguous;
8. do not build migration history, locking, or a DSL unless the experiment demonstrates the need.

Primary question:

> Is one atomically committed applied-version marker plus explicit preconditions sufficient for restart-safe idempotent migration, or does safe recovery require richer migration state?

Candidate decisions:

```text
CANDIDATE_MINIMAL_ATOMIC_MIGRATION_MARKER_SUFFICIENT
MIXED_MARKER_CONVENTION_NEEDS_RUNTIME_SUPPORT
FAIL_MARKER_CANNOT_PROVE_SEMANTIC_STATE
INVALID_EXPERIMENT
```

### 2. Probe field deletion semantics

Status: planned after migration-marker evaluation.

Required-field addition showed that adding a path does not disturb unrelated projections. The inverse case should test deleting a field that already has observation/projection metadata and determine when explicit derived-state retirement is required.

### 3. Replicate the project convention in a third topology

Status: **candidate direction, not public API.**

PR #49 reused the same generic helper unchanged across project-board and editor/workspace scenarios and reduced measured per-prototype persistence decisions from 7 to 5 in both.

Test a third topology such as agent workspace/checkpoints or a multi-list workflow. The exact `openProjectStore/list/object` names remain experiment placeholders only.

### 4. Reuse durable-session bootstrap with project identity

Status: initial cross-process bootstrap PASS; integration unproven.

The existing `__workspace` bootstrap experiment shows that one known key can discover additional durable states across processes. A project declaration plus identity manifest already contains a state namespace, so test whether bootstrap/discovery can reuse that information without creating a second competing registry.

Do not add a general workspace/agent-memory API until reuse is demonstrated.

## Current experimental evidence

### Required-field incompatible value evolution — #68

Status: **BOUNDARY CONFIRMED in CI #224; experiment-only.**

Stable identity and unchanged existing path:

```text
state key      jobs
item identity  JOB-1
existing path  queue
```

Shape transition:

```text
{ id, queue }
  ->
{ id, queue, maxRetries: number }
```

Declaration-only reopen through the V2 TypeScript type succeeded with `maxRetries === undefined`. The V2 initializer deliberately contained `maxRetries: 99`; that value was not merged into the existing durable row. The existing `queue` projection remained coherent.

Explicit `missing maxRetries -> 3` backfill ran inside one outer `batch()`. Failure injection restored item JSON, path counters/types, derivation, and projection exactly. Retry persisted `3`, preserved the existing `queue` projection, and created a new `maxRetries` projection only when queried. Mutation through the query-returned durable handle kept both projections coherent, and reopen retained `maxRetries = 3`.

Missing policy rejected atomically rather than inventing a value.

Machine result:

```text
BOUNDARY_CONFIRMED_REQUIRED_FIELD_REQUIRES_EXPLICIT_BACKFILL_POLICY
```

### Incompatible value boundary replicated across three cases

Three different value-semantic changes now produce the same core rule:

```text
static TypeScript declaration
  !=
runtime migration / durable validation / semantic policy
```

But persistence-mechanics work varies by representation impact:

```text
scalar -> object
  semantic transform required
  existing query representation invalidated
  -> projection retirement + nested rebuild

enum narrowing
  semantic mapping required
  same scalar representation remains valid
  -> ordinary durable mutation maintains projection

required-field introduction
  semantic backfill required
  existing unrelated representation remains valid
  -> existing projection preserved
  -> new projection created normally on demand
```

This supports a narrower rule:

> **Semantic incompatibility determines when application policy must become explicit. Migration-specific metadata work is required only when an existing persisted/queryable representation becomes invalid.**

No public migration or validation API is authorized by these results.

### Enum narrowing incompatible value evolution — #66

Status: **BOUNDARY CONFIRMED in CI #218; experiment-only.**

```text
"auto" | "manual" | "legacy"
  ->
"auto" | "manual"
```

Declaration-only reopen retained `legacy`; explicit `legacy -> manual` policy was required. Exact rollback passed, and the same scalar projection stayed coherent through ordinary durable mutation.

```text
BOUNDARY_CONFIRMED_ENUM_NARROWING_REQUIRES_EXPLICIT_VALUE_POLICY
```

### Scalar-to-object incompatible value evolution — #64

Status: **BOUNDARY CONFIRMED in CI #211; experiment-only.**

```text
retryPolicy: number
  ->
retryPolicy: { delayMs: number; maxAttempts: number }
```

Declaration-only reopen left the persisted scalar unchanged. Explicit migration required a `maxAttempts` policy, rolled back exactly under failure injection, retired the obsolete root scalar projection, created a nested projection after migration, and reopened in V2 shape.

```text
BOUNDARY_CONFIRMED_SCALAR_TO_OBJECT_REQUIRES_EXPLICIT_VALUE_MIGRATION
```

### Many-to-one declared-state merge migration — #60

Status: **BOUNDARY CONFIRMED in CI #205; experiment-only.**

Naive merge and alias misuse failed safely. Explicit conflict-aware merge placed source reads, validation, target construction, source retirement, identity-manifest transition, and metadata cleanup inside one transaction. Failure rollback restored behavior-driving metadata counters exactly.

```text
BOUNDARY_CONFIRMED_MERGE_REQUIRES_EXPLICIT_CONFLICT_AWARE_MIGRATION
```

### Declared-state split migration boundary — #56

Status: **BOUNDARY CONFIRMED in CI #192; experiment-only.**

One-to-one aliasing was insufficient for one-to-many semantic transformation. Explicit transactional migration succeeded under failure injection and reopen.

```text
BOUNDARY_CONFIRMED_SPLIT_REQUIRES_EXPLICIT_ATOMIC_MIGRATION
```

### Runtime hardening found by migration experiments

- #62 / PR #63 / CI #202: internal rollback snapshots no longer count as application observations.
- #58 / PR #59 / CI #199: concrete `StorekeeperDB.debug()` type now matches exported `StorekeeperDebugAPI` for object-form metadata compaction.

### Durable identity / rename chain

- #50: `CANDIDATE_PREFER_EXPLICIT_RENAME_ALIAS_WITH_IDENTITY_MANIFEST`
- #52: `CANDIDATE_PASS_LOGICAL_RENAME_PRESERVES_PHYSICAL_DERIVED_STATE`
- #54: `CANDIDATE_PASS_MULTI_STEP_RENAME_RETAINS_SINGLE_PHYSICAL_IDENTITY`

These support one-to-one logical rename over stable physical identity, not general migration inference.

### Agent-facing and change-amplification evidence

- Agent project convention: 7 -> 5 measured per-prototype persistence decisions in two scenarios.
- Agent decision burden: relational 8, JSON blob 8, StorekeeperDB 7 decision categories.
- Compatible change amplification: StorekeeperDB reduced persistence-specific changed lines in two small JSON-style scenarios, but did not generally reduce concept count below the JSON-blob baseline.
- Singleton/root experiments did not justify a broad arbitrary-root public API.

## Resolved command/read semantics

```text
state() item             -> durable handle
find() result item       -> durable handle
find() result array      -> ordinary local array
liveFind() result values -> detached stable snapshots
```

Removed references remain readable but cannot write deleted rows back. Rollback invalidates old-generation handles. Reorder preserves identity.

## Confirmed architecture boundaries

### Identity evolution vs value-semantic evolution

```text
logical identity changes, value meaning stable
  -> explicit one-to-one rename alias
  -> physical identity can remain stable

logical identity stable, value meaning incompatible
  -> TypeScript type change is insufficient
  -> explicit value interpretation/policy
  -> transactional transform
```

### Evolution classes now observed

```text
compatible additive optional JSON evolution
  -> automatic in tested scenarios

one-to-one logical rename
  -> explicit identity alias

split / merge
  -> explicit semantic transform
  -> source retirement / conflict policy

scalar -> structured object
  -> explicit value transform
  -> explicit newly-required value policy
  -> representation-specific metadata reconciliation

enum narrowing
  -> explicit mapping policy
  -> same scalar projection maintained by ordinary mutation

required-field introduction
  -> explicit backfill policy
  -> unrelated projections preserved
  -> new projection created on demand
```

The key boundary is semantic preservation, not merely whether a TypeScript type changed.

### Hard persistence boundaries

The agent-first goal does not authorize hiding incompatible value transformation, split/merge, durable identity rename, corruption, concurrent writers, transaction failures, durability uncertainty, or migration-version ambiguity. When the runtime cannot preserve semantics safely, the persistence problem must become explicit.

Automatic heuristic rename, split, merge, enum remapping, required-field default inference, or incompatible-value conversion from declaration shape/content/order is not supported by current evidence.

## Deferred research

- time-based lifecycle decay (#16);
- richer metadata scoring policy (#17);
- full browser adapter after a realistic browser scenario;
- scalar/root cell abstraction only if a realistic scenario requires it;
- physical-key compaction only if retaining historical physical names becomes a demonstrated problem.

## Release posture

`0.1.0-alpha.0` remains a public alpha candidate only when deterministic scenarios/experiments in `release:check` pass and public documentation matches implementation. Passing these checks does not imply production readiness or end the refinement loop.
