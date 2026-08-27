# Next work

This document tracks current StorekeeperDB priorities. Historical implementation details belong in the changelog, merged pull requests, and subsystem notes; this file should answer one question: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The product direction is agent-oriented: StorekeeperDB is being evaluated as a **durable programming model for rapid agent-generated TypeScript prototypes**. The target is to remove persistence architecture decisions from the coding agent's normal planning path wherever doing so remains safe and explainable.

Working rule:

> **Persistence should normally not enter the coding agent's planning loop. Hard persistence problems must remain observable and controllable.**

See [Alpha evaluation loop](./EVALUATION_LOOP.md), [Architecture](./ARCHITECTURE.md), [State split migration boundary experiment](./STATE_SPLIT_MERGE_BOUNDARY_EXPERIMENT.md), [State merge migration boundary experiment](./STATE_MERGE_BOUNDARY_EXPERIMENT.md), [Scalar-to-object value evolution experiment](./SCALAR_TO_OBJECT_VALUE_EVOLUTION_EXPERIMENT.md), and [Enum narrowing value evolution experiment](./ENUM_NARROWING_VALUE_EVOLUTION_EXPERIMENT.md).

## Active priorities

### 1. Probe required-field introduction independently

Status: **next incompatible-value replication after enum narrowing confirmation in CI #218.**

Keep durable state identity and existing fields unchanged while adding newly required information:

```text
V1
job { id, queue }

  ->

V2
job { id, queue, maxRetries: number }
```

Persist a V1 object with no `maxRetries`, establish a projection on unchanged `queue`, close, and reopen through a V2 TypeScript declaration.

Required cases:

1. declaration-only reopen must reveal whether the persisted object remains physically missing `maxRetries` despite the V2 static type;
2. no fresh/default `maxRetries` may be counted as migration unless the runtime actually persisted it;
3. explicit backfill must require an application policy such as `maxRetries = 3`;
4. missing policy must reject atomically rather than invent a value;
5. failure injected after backfill must restore item JSON, path metadata counters/types, derivations, and projections exactly;
6. the unrelated existing `queue` projection should remain coherent throughout;
7. after successful backfill, query `maxRetries = 3`, verify projection creation and durable-handle semantics, then close/reopen.

Primary question:

> Does a newly required property produce the same boundary as scalar-to-object and enum narrowing: TypeScript declaration is not runtime data migration, while current transaction/handle/projection primitives remain sufficient for explicit policy-driven backfill?

Candidate decision:

```text
BOUNDARY_CONFIRMED_REQUIRED_FIELD_INTRODUCTION_REQUIRES_EXPLICIT_BACKFILL_POLICY
MIXED_RUNTIME_SUPPORT_WITH_METADATA_GAP
UNEXPECTED_RUNTIME_DEFAULTING
INVALID_EXPERIMENT
```

Do not add schema validation or a migration DSL in this experiment.

### 2. Evaluate migration idempotency and crash/retry markers

Status: planned after required-field replication.

Split, merge, scalar-to-object, and enum-narrowing experiments prove in-process transaction rollback. They do not establish how a migration is recognized, retried, or skipped after interruption or old/new application version skew.

Evaluate whether a minimal migration marker/version convention is sufficient before considering any migration DSL.

### 3. Replicate the project convention in a third topology

Status: **candidate direction, not public API.**

PR #49 reused the same generic helper unchanged across project-board and editor/workspace scenarios and reduced measured per-prototype persistence decisions from 7 to 5 in both.

Test a third topology such as agent workspace/checkpoints or a multi-list workflow. The exact `openProjectStore/list/object` names remain experiment placeholders only.

### 4. Reuse durable-session bootstrap with project identity

Status: initial cross-process bootstrap PASS; integration unproven.

The existing `__workspace` bootstrap experiment shows that one known key can discover additional durable states across processes. A project declaration plus identity manifest already contains a state namespace, so test whether bootstrap/discovery can reuse that information without creating a second competing registry.

Do not add a general workspace/agent-memory API until reuse is demonstrated.

## Current experimental evidence

### Enum narrowing incompatible value evolution — #66

Status: **BOUNDARY CONFIRMED in CI #218; experiment-only.**

Stable identity and path:

```text
state key      jobs
item identity  JOB-1
field path     mode
```

Semantic transition:

```text
"auto" | "manual" | "legacy"
  ->
"auto" | "manual"
```

Declaration-only reopen through the narrower TypeScript type succeeded and still returned `"legacy"`. No runtime validation, conversion, or defaulting occurred, and the existing `mode` projection continued to reflect the stored value.

Explicit `legacy -> manual` mapping ran inside one outer `batch()`. Failure injection restored item JSON, path counters/types, derivation, and projection exactly. Retry persisted `manual`, `find(mode="legacy")` returned 0, `find(mode="manual")` returned 1, and reopen retained the allowed V2 value.

Unlike scalar-to-object evolution, the path and scalar representation stayed compatible. **Ordinary durable mutation kept the existing scalar projection coherent**; no migration-specific eviction/rebuild was required.

Machine result:

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

Declaration-only reopen left the persisted scalar unchanged. Explicit migration required a `maxAttempts` policy, rolled back exactly under failure injection, retired the obsolete root scalar projection, created a nested `retryPolicy.delayMs` projection after migration, and reopened in V2 shape.

Machine result:

```text
BOUNDARY_CONFIRMED_SCALAR_TO_OBJECT_REQUIRES_EXPLICIT_VALUE_MIGRATION
```

### Incompatible value boundary replicated

Two different value-semantic changes now show the same core result:

```text
static TypeScript declaration
  !=
runtime migration / durable validation
```

But derived-state treatment differs by representation compatibility:

```text
scalar -> object
  old query representation invalidated
  -> explicit projection retirement/rebuild

enum narrowing on same scalar path
  query representation remains valid
  -> ordinary durable mutation maintains projection
```

This supports a narrower rule:

> Migration policy is driven by semantic incompatibility; migration-specific metadata work is driven by whether the persisted/queryable path representation remains valid.

No public migration or validation API is authorized by either result.

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
compatible additive JSON evolution
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
```

The key boundary is semantic preservation, not merely whether a TypeScript type changed.

### Hard persistence boundaries

The agent-first goal does not authorize hiding incompatible value transformation, split/merge, durable identity rename, corruption, concurrent writers, transaction failures, or durability uncertainty. When the runtime cannot preserve semantics safely, the persistence problem must become explicit.

Automatic heuristic rename, split, merge, enum remapping, or incompatible-value conversion from declaration shape/content/order is not supported by current evidence.

## Deferred research

- time-based lifecycle decay (#16);
- richer metadata scoring policy (#17);
- full browser adapter after a realistic browser scenario;
- scalar/root cell abstraction only if a realistic scenario requires it;
- physical-key compaction only if retaining historical physical names becomes a demonstrated problem.

## Release posture

`0.1.0-alpha.0` remains a public alpha candidate only when deterministic scenarios/experiments in `release:check` pass and public documentation matches implementation. Passing these checks does not imply production readiness or end the refinement loop.
