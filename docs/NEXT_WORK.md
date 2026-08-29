# Next work

This document tracks current StorekeeperDB priorities. Historical details belong in the changelog, merged pull requests, and subsystem notes; this file should answer: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The product direction is agent-oriented: StorekeeperDB is being evaluated as a **durable programming model for rapid agent-generated TypeScript prototypes**. The target is to remove persistence architecture decisions from the coding agent's normal planning path wherever doing so remains safe and explainable.

Working rule:

> **Persistence should normally not enter the coding agent's planning loop. Hard persistence problems must remain observable and controllable.**

## Active priorities

### 1. Probe field deletion with active derived metadata

Status: **next incompatible-value experiment after migration-marker candidate pass in CI #232.**

Scenario:

```text
V1 jobs
{ id, queue, legacyTag }

  ->

V2 jobs
{ id, queue }
```

Before migration, create active scalar projections for both `queue` and `legacyTag`.

Required cases:

1. declaration-only reopen under the V2 TypeScript type must show whether `legacyTag` remains durably present;
2. explicit `delete job.legacyTag` inside one outer `batch()` with failure injection;
3. exact rollback of item/path/derivation/projection state;
4. after successful delete, `find({ legacyTag: oldValue })` must return zero;
5. determine whether the old projection cell disappears automatically;
6. separately determine whether `__sk_paths` / `__sk_derivations` metadata for `legacyTag` remains and whether explicit lifecycle cleanup is needed;
7. unrelated `queue` projection must remain coherent;
8. close/reopen must preserve field absence;
9. no public migration API unless a repeated unavoidable mechanism gap appears.

Candidate decisions:

```text
BOUNDARY_CONFIRMED_FIELD_DELETION_REQUIRES_EXPLICIT_VALUE_POLICY
MIXED_FIELD_DELETE_REQUIRES_METADATA_CLEANUP
INVALID_EXPERIMENT
```

Critical question:

> Does ordinary durable property deletion fully retire value-specific derived state, or only make the source/projection cell correct while leaving metadata that explicit migration cleanup should retire?

### 2. Replicate the project convention in a third topology

Status: candidate direction, not public API.

PR #49 reused the same generic helper unchanged across project-board and editor/workspace scenarios and reduced measured per-prototype persistence decisions from 7 to 5 in both. Test a third topology such as agent workspace/checkpoints or a multi-list workflow.

### 3. Reuse durable-session bootstrap with project identity

Status: initial cross-process bootstrap PASS; integration unproven.

Test whether the project declaration/identity manifest can also provide durable-state discovery without creating a second registry. Do not add a general workspace/agent-memory API until reuse is demonstrated.

## Current experimental evidence

### Migration idempotency and crash/retry marker — #70

Status: **CANDIDATE PASS in CI #232; experiment-only.**

This closes the prior **Evaluate migration idempotency and crash/retry markers** priority for the tested local SQLite scope.

Experiment-only convention:

```text
semantic value transform
+
applied-version marker
+
strict marker/value preconditions
+
one outer batch()
```

CI #232 selected:

```text
CANDIDATE_MINIMAL_ATOMIC_MIGRATION_MARKER_SUFFICIENT
```

Both failure points—after value mutation and after marker mutation—rolled back the value/marker durability unit exactly. A later reopen/retry committed once. The next reopen returned `already-applied`, retained one marker, left source item rows unchanged, and did not increase path write counts.

The rerun is write-idempotent, not observation-neutral: normal validation reads remain observable and may advance read-observation metadata.

Strict pair validation rejected both inconsistent states:

```text
marker present + value unmigrated
marker absent  + value migrated
```

Two split-commit negative controls demonstrated that committing the value and marker separately can strand exactly those mismatch states.

Interpretation:

> In the tested local SQLite scope, the semantic transform and applied marker must be one atomic durability unit, and marker/value consistency is a precondition on every run.

A marker alone does not prove semantic state. No public migration API is authorized by this result.

### Required-field incompatible value evolution — #68

Status: **BOUNDARY CONFIRMED in CI #224; experiment-only.**

```text
BOUNDARY_CONFIRMED_REQUIRED_FIELD_REQUIRES_EXPLICIT_BACKFILL_POLICY
```

A V2 required property and initializer did not backfill an existing V1 row. Explicit `maxRetries = 3` policy rolled back exactly under failure injection, preserved the existing `queue` projection, and created the new projection only on demand.

### Enum narrowing incompatible value evolution — #66

Status: **BOUNDARY CONFIRMED in CI #218; experiment-only.**

```text
BOUNDARY_CONFIRMED_ENUM_NARROWING_REQUIRES_EXPLICIT_VALUE_POLICY
```

Persisted `legacy` survived a narrower TypeScript union until explicit `legacy -> manual` mapping. The same scalar projection stayed coherent through ordinary durable mutation.

### Scalar-to-object incompatible value evolution — #64

Status: **BOUNDARY CONFIRMED in CI #211; experiment-only.**

```text
BOUNDARY_CONFIRMED_SCALAR_TO_OBJECT_REQUIRES_EXPLICIT_VALUE_MIGRATION
```

The V2 TypeScript declaration did not transform persisted scalar JSON. Explicit policy was required, and the representation change required obsolete projection retirement plus nested projection rebuild.

### Split / merge boundaries

```text
BOUNDARY_CONFIRMED_SPLIT_REQUIRES_EXPLICIT_ATOMIC_MIGRATION
BOUNDARY_CONFIRMED_MERGE_REQUIRES_EXPLICIT_CONFLICT_AWARE_MIGRATION
```

Split and merge require explicit semantic transformation, source retirement, and conflict policy where applicable. Structural identity validity alone does not establish semantic preservation.

### Durable identity / rename chain

```text
CANDIDATE_PREFER_EXPLICIT_RENAME_ALIAS_WITH_IDENTITY_MANIFEST
CANDIDATE_PASS_LOGICAL_RENAME_PRESERVES_PHYSICAL_DERIVED_STATE
CANDIDATE_PASS_MULTI_STEP_RENAME_RETAINS_SINGLE_PHYSICAL_IDENTITY
```

These support one-to-one logical rename over stable physical identity, not general migration inference.

### Agent-facing and change-amplification evidence

- Agent project convention: 7 -> 5 measured per-prototype persistence decisions in two scenarios.
- Agent decision burden: relational 8, JSON blob 8, StorekeeperDB 7 decision categories.
- Compatible change amplification: lower explicit persistence edit surface in two small JSON-style scenarios, but no general concept-count advantage over a minimal JSON-blob baseline.
- Singleton/root experiments did not justify a broad arbitrary-root public API.

## Current architecture rules

### Command/read semantics

```text
state() item             -> durable handle
find() result item       -> durable handle
find() result array      -> ordinary local array
liveFind() result values -> detached stable snapshots
```

Removed references remain readable but cannot write deleted rows back. Rollback invalidates old-generation handles. Reorder preserves identity.

### Evolution classes observed

```text
compatible additive optional JSON evolution
  -> automatic in tested scenarios

one-to-one logical rename
  -> explicit identity alias

split / merge
  -> explicit semantic transform
  -> source retirement / conflict policy

scalar -> structured object
  -> explicit semantic transform
  -> representation-specific metadata reconciliation

enum narrowing
  -> explicit mapping policy
  -> ordinary mutation maintains same scalar projection

required-field introduction
  -> explicit backfill policy
  -> unrelated projections preserved
  -> new projection created on demand

migration execution / restart
  -> transform + applied marker in one transaction
  -> strict marker/value pair validation
  -> rerun can be write-idempotent
  -> validation reads remain observable
```

The key boundary is semantic preservation, not merely whether a TypeScript type changed.

### Hard persistence boundaries

The agent-first direction does not authorize hiding incompatible value transformation, split/merge, durable identity rename, corruption, concurrent writers, transaction failures, durability uncertainty, migration-version ambiguity, or inconsistent marker/value state.

Automatic heuristic rename, split, merge, enum remapping, required-field default inference, migration provenance inference, or incompatible-value conversion from declaration shape/content/order is not supported by current evidence.

## Deferred research

- concurrent old/new process migration behavior and multiple writers;
- migration dependency ordering / marker scope;
- time-based lifecycle decay (#16);
- richer metadata scoring policy (#17);
- full browser adapter after a realistic browser scenario;
- scalar/root cell abstraction only if a realistic scenario requires it;
- physical-key compaction only if retaining historical physical names becomes a demonstrated problem.

## Release posture

`0.1.0-alpha.0` remains a public alpha candidate only when deterministic scenarios/experiments in `release:check` pass and public documentation matches implementation. Passing these checks does not imply production readiness or end the refinement loop.
