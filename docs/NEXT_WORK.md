# Next work

This document tracks current StorekeeperDB priorities. Historical implementation details belong in the changelog, merged pull requests, and subsystem notes; this file should answer one question: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The product direction is agent-oriented: StorekeeperDB is being evaluated as a **durable programming model for rapid agent-generated TypeScript prototypes**. The target is to remove persistence architecture decisions from the coding agent's normal planning path wherever doing so remains safe and explainable.

Working rule:

> **Persistence should normally not enter the coding agent's planning loop. Hard persistence problems must remain observable and controllable.**

See [Alpha evaluation loop](./EVALUATION_LOOP.md), [Architecture](./ARCHITECTURE.md), [State split migration boundary experiment](./STATE_SPLIT_MERGE_BOUNDARY_EXPERIMENT.md), [State merge migration boundary experiment](./STATE_MERGE_BOUNDARY_EXPERIMENT.md), and [Scalar-to-object value evolution experiment](./SCALAR_TO_OBJECT_VALUE_EVOLUTION_EXPERIMENT.md).

## Active priorities

### 1. Probe enum narrowing incompatible value evolution

Status: **next value-semantic replication after scalar-to-object boundary confirmation in CI #211.**

Keep durable state identity and the field path unchanged:

```text
V1 mode: "auto" | "manual" | "legacy"
  ->
V2 mode: "auto" | "manual"
```

Required cases:

1. persist `"legacy"`, establish a projection on `mode`, close, and reopen under the narrower V2 TypeScript type;
2. verify declaration-only reopen leaves the runtime value as `"legacy"` rather than validating or transforming it;
3. require an explicit policy such as `legacy -> manual` for a successful transform;
4. without a policy, reject atomically and leave value plus metadata unchanged;
5. inject failure after the value mutation and verify exact rollback of item, path counters/types, derivation, and projection;
6. after successful transform, verify the existing `mode` scalar projection remains coherent or is explicitly rebuilt if required;
7. close/reopen and verify only an allowed V2 value remains.

Primary question:

> Does enum narrowing confirm the same boundary as scalar-to-object evolution—static type change is not durable validation, while explicit application policy plus current transactional primitives is sufficient?

Candidate decision:

```text
BOUNDARY_CONFIRMED_ENUM_NARROWING_REQUIRES_EXPLICIT_VALUE_POLICY
MIXED_RUNTIME_SUPPORT_WITH_PROJECTION_GAP
INVALID_EXPERIMENT
```

Do not add a validation/schema DSL in this experiment.

### 2. Probe required-field introduction independently

Status: planned after enum narrowing.

Scalar-to-object #64 already required an explicit `maxAttempts` value, but that requirement was coupled to a representation change. A separate experiment should add a genuinely required field to otherwise-compatible object shape and determine whether missing persisted values should be rejected, explicitly backfilled, or represented as a versioned migration obligation.

### 3. Evaluate migration idempotency and crash/retry markers

Status: planned after incompatible-value replication.

Split, merge, and scalar-to-object experiments prove in-process transaction rollback. They do not establish how a migration is recognized, retried, or skipped after process interruption or old/new application version skew.

Evaluate whether a minimal migration marker/version convention is sufficient before considering any migration DSL.

### 4. Replicate the project convention in a third topology

Status: **candidate direction, not public API.**

PR #49 reused the same generic helper unchanged across project-board and editor/workspace scenarios and reduced measured per-prototype persistence decisions from 7 to 5 in both.

Test a third topology such as agent workspace/checkpoints or a multi-list workflow. The exact `openProjectStore/list/object` names remain experiment placeholders only.

### 5. Reuse durable-session bootstrap with project identity

Status: initial cross-process bootstrap PASS; integration unproven.

The existing `__workspace` bootstrap experiment shows that one known key can discover additional durable states across processes. A project declaration plus identity manifest already contains a state namespace, so test whether bootstrap/discovery can reuse that information without creating a second competing registry.

Do not add a general workspace/agent-memory API until reuse is demonstrated.

## Current experimental evidence

### Scalar-to-object incompatible value evolution — #64

Status: **BOUNDARY CONFIRMED in CI #211; experiment-only.**

The test deliberately held stable:

```text
state key       jobs
item identity   JOB-1
field path      retryPolicy
```

while changing only the field's persisted semantic representation:

```text
number
  ->
{ delayMs: number; maxAttempts: number }
```

Declaration-only reopen through the V2 TypeScript type left the runtime value as the original number `750`; no automatic object conversion or fresh default occurred, and the old scalar projection remained present.

The explicit migration then performed source read/validation, required-field policy, scalar-to-object replacement, and obsolete projection eviction inside one outer `batch()`. Failure injection restored the complete item/path/derivation/projection snapshot exactly. Retry succeeded, a nested `retryPolicy.delayMs` projection was created by `find()`, the returned item remained a durable handle, and reopen preserved the V2 object.

Missing `maxAttempts` policy rejected atomically rather than inventing a default.

Machine result:

```text
BOUNDARY_CONFIRMED_SCALAR_TO_OBJECT_REQUIRES_EXPLICIT_VALUE_MIGRATION
```

Interpretation:

> **TypeScript declaration change alone does not migrate persisted semantic shape.** Durable identity can stay stable while an explicit value migration becomes necessary.

This completes the first case under **Evaluate incompatible value evolution**. It does not justify a public migration API.

### Many-to-one declared-state merge migration — #60

Status: **BOUNDARY CONFIRMED in CI #205; experiment-only.**

Scenario:

```text
account { displayName, locale }
preferences { compactMode, locale }
  ->
profile { displayName, compactMode, locale }
```

Naive merge failed safely. One-to-one alias misuse was rejected because the second source remained unexplained. Explicit merge placed reads, conflict resolution, target construction, source retirement, manifest transition, and metadata cleanup in one outer `batch()`.

Failure injection restored source values, target absence, identity bindings, projections/derivations, and exact observation counters. Conflicting locales required an explicit resolution policy.

Machine result:

```text
BOUNDARY_CONFIRMED_MERGE_REQUIRES_EXPLICIT_CONFLICT_AWARE_MIGRATION
```

### Declared-state split migration boundary — #56

Status: **BOUNDARY CONFIRMED in CI #192; experiment-only.**

Naive split failed safely. Misusing one-to-one aliasing could produce a structurally valid but semantically incomplete result, losing persisted source meaning. Explicit transactional transform with source retirement and metadata cleanup succeeded under failure injection and reopen.

Machine result:

```text
BOUNDARY_CONFIRMED_SPLIT_REQUIRES_EXPLICIT_ATOMIC_MIGRATION
```

### Batch rollback observation neutrality — #62

Status: **fixed in PR #63 / CI #202.**

Internal rollback snapshot reads no longer increment application observation counters. Callback reads remain observable and roll back with a failed transaction.

### `debug().compactMetadata()` static type mismatch — #58

Status: **fixed in PR #59 / CI #199.**

The concrete `StorekeeperDB.debug()` type now agrees with the exported `StorekeeperDebugAPI`; runtime behavior was unchanged.

### Durable identity / rename chain

- #50: `CANDIDATE_PREFER_EXPLICIT_RENAME_ALIAS_WITH_IDENTITY_MANIFEST`
- #52: `CANDIDATE_PASS_LOGICAL_RENAME_PRESERVES_PHYSICAL_DERIVED_STATE`
- #54: `CANDIDATE_PASS_MULTI_STEP_RENAME_RETAINS_SINGLE_PHYSICAL_IDENTITY`

Together these support one-to-one logical rename over stable physical identity, not general migration inference.

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

Current evidence separates two independent axes:

```text
logical identity changes, value meaning stable
  -> explicit one-to-one rename alias
  -> physical identity can remain stable

logical identity stable, value meaning incompatible
  -> TypeScript type change is insufficient
  -> explicit value interpretation/policy
  -> transactional transform
  -> derived metadata reconciliation
```

### Evolution classes now observed

```text
compatible additive JSON evolution
  -> automatic in tested scenarios

one-to-one logical rename
  -> explicit identity alias

split / merge
  -> explicit semantic transform
  -> explicit source retirement
  -> conflict policy where required

scalar -> structured object
  -> explicit value transform
  -> explicit required-field policy
  -> obsolete projection retirement / nested projection rebuild
```

The key boundary is semantic preservation, not merely whether a TypeScript type changed.

### Hard persistence boundaries

The agent-first goal does not authorize hiding incompatible value transformation, split/merge, durable identity rename, corruption, concurrent writers, transaction failures, or durability uncertainty. When the runtime cannot preserve semantics safely, the persistence problem must become explicit.

Automatic heuristic rename, split, merge, or incompatible-value conversion from declaration shape/content/order is not supported by current evidence.

## Deferred research

- time-based lifecycle decay (#16);
- richer metadata scoring policy (#17);
- full browser adapter after a realistic browser scenario;
- scalar/root cell abstraction only if a realistic scenario requires it;
- physical-key compaction only if retaining historical physical names becomes a demonstrated problem.

## Release posture

`0.1.0-alpha.0` remains a public alpha candidate only when deterministic scenarios/experiments in `release:check` pass and public documentation matches implementation. Passing these checks does not imply production readiness or end the refinement loop.
