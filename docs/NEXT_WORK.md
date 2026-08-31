# Next work

This document tracks current StorekeeperDB priorities. Historical details belong in experiment notes and merged pull requests; this file should answer: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The product direction is agent-oriented: StorekeeperDB is being evaluated as a **durable programming model for rapid agent-generated TypeScript prototypes**. The target is to remove persistence architecture decisions from the coding agent's normal planning path wherever doing so remains safe and explainable.

Working rule:

> **Persistence should normally not enter the coding agent's planning loop. Hard persistence problems must remain observable and controllable.**

## Active priorities

### 1. Measure projection-maintenance write amplification

Status: **next falsification target after #74 / CI #252. Do not optimize first.**

The partial-row field-deletion experiment replicated current-state correctness but showed that projection maintenance for a changed item is item-local rather than deleted-cell-only:

```text
MIXED_PARTIAL_ROW_DELETE_REBUILDS_ITEM_PROJECTIONS_BUT_STAYS_CORRECT
```

For the changed item, each active derivation cell is deleted and still-present scalar cells are reinserted. The next experiment must determine whether that deterministic write amplification is materially relevant at prototype scale.

Hypothesis:

> If mutation rebuilds all active projection cells for a changed item, projection row writes grow approximately linearly with projected-path count `P`; practical wall-time impact may still be negligible for prototype-scale `P`.

Candidate points:

```text
P = 1, 4, 16, 64
```

Measure:

```text
P     active projected paths / item
W(P)  projection row writes / mutation
t(P)  mutation wall time / operation
```

Requirements:

1. mutate one item while keeping row count fixed;
2. count projection INSERT/DELETE/UPDATE deterministically with trigger audit;
3. verify source/query/reopen correctness separately from write count;
4. use warmup plus repeated iterations for timing;
5. report median and range/quantiles rather than a single timing;
6. do not add timing to a brittle release latency gate;
7. do not implement cell-diff optimization in the measurement PR.

Critical question:

> Even if `W(P)` is linear, is the absolute cost large enough to justify more complex incremental maintenance, or is it only internal churn without meaningful user impact?

### 2. Replicate the project convention in a third topology

Status: candidate direction, not public API.

PR #49 reused the same generic helper unchanged across project-board and editor/workspace scenarios and reduced measured per-prototype persistence decisions from 7 to 5 in both. Test a third topology such as agent workspace/checkpoints or a multi-list workflow.

### 3. Reuse durable-session bootstrap with project identity

Status: initial cross-process bootstrap PASS; integration unproven.

Test whether the project declaration/identity manifest can also provide durable-state discovery without creating a second registry. Do not add a general workspace/agent-memory API until reuse is demonstrated.

## Current experimental evidence

### Partial-row field deletion — #74

Status: **MIXED in CI #252; experiment-only.**

Historical task: **Replicate field deletion on a partial-row topology** — completed by #74 / CI #252.

```text
MIXED_PARTIAL_ROW_DELETE_REBUILDS_ITEM_PROJECTIONS_BUT_STAYS_CORRECT
```

The mixed topology remained correct: deleted source field absent, surviving row/query intact, durable `find()` handle coherent, rollback exact, identity/order stable, and reopen coherent. Projection writes remained isolated from the surviving row.

The projection audit showed item-local maintenance on JOB-1:

```text
queue      DELETE + INSERT
legacyTag  DELETE
JOB-2      no projection writes during JOB-1 deletion
```

Interpretation:

> Field deletion correctness replicated beyond the single-row case, but minimal cell-level write granularity did not. This is a measured write-amplification mechanism, not a correctness defect.

No runtime optimization is authorized until scaling cost is measured.

### Field deletion with active derived metadata — #72

Status: **BOUNDARY CONFIRMED; experiment-only.**

```text
BOUNDARY_CONFIRMED_FIELD_DELETE_CURRENT_STATE_COHERENT_METADATA_RETAINED
```

Ordinary durable `delete job.legacyTag` removed the current source field and projection cell, rolled back exactly under failure injection, and stayed absent after reopen. Historical derivation/path metadata may remain; current-state correctness and metadata retirement are separate concerns.

### Migration idempotency and crash/retry marker — #70

Status: **CANDIDATE PASS in CI #232; experiment-only.**

Historical task: **Evaluate migration idempotency and crash/retry markers** — completed by #70 / CI #232.

```text
CANDIDATE_MINIMAL_ATOMIC_MIGRATION_MARKER_SUFFICIENT
```

The semantic transform and applied marker must be one atomic durability unit, with strict marker/value validation on every run. Rerun can be write-idempotent while validation reads remain observable. No public migration API is authorized by this result.

### Incompatible value evolution

```text
BOUNDARY_CONFIRMED_REQUIRED_FIELD_REQUIRES_EXPLICIT_BACKFILL_POLICY
BOUNDARY_CONFIRMED_ENUM_NARROWING_REQUIRES_EXPLICIT_VALUE_POLICY
BOUNDARY_CONFIRMED_SCALAR_TO_OBJECT_REQUIRES_EXPLICIT_VALUE_MIGRATION
```

Required-field introduction needs explicit backfill policy; enum narrowing needs explicit mapping; scalar-to-object needs explicit semantic transformation and metadata reconciliation. Static TypeScript declarations are not migrations.

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

field deletion
  -> declaration alone does not delete persisted data
  -> explicit durable property delete is mechanically sufficient in tested single- and mixed-row cases
  -> deleted projection cell disappears automatically
  -> changed-item active projections are currently rebuilt item-locally
  -> surviving rows remain isolated in the tested mixed topology
  -> derivation/path history may remain as lifecycle metadata

migration execution / restart
  -> transform + applied marker in one transaction
  -> strict marker/value pair validation
  -> rerun can be write-idempotent
  -> validation reads remain observable
```

The key boundary is semantic preservation, not merely whether a TypeScript type changed.

### Hard persistence boundaries

The agent-first direction does not authorize hiding incompatible value transformation, split/merge, durable identity rename, corruption, concurrent writers, transaction failures, durability uncertainty, migration-version ambiguity, or inconsistent marker/value state.

Automatic heuristic rename, split, merge, enum remapping, required-field default inference, field-deletion policy inference, migration provenance inference, or incompatible-value conversion from declaration shape/content/order is not supported by current evidence.

## Deferred research

- nested field deletion and field reintroduction after deletion;
- automatic decay/compaction policy for obsolete derivation/path metadata;
- concurrent old/new process migration behavior and multiple writers;
- migration dependency ordering / marker scope;
- time-based lifecycle decay (#16);
- richer metadata scoring policy (#17);
- full browser adapter after a realistic browser scenario;
- scalar/root cell abstraction only if a realistic scenario requires it;
- physical-key compaction only if retaining historical physical names becomes a demonstrated problem.

## Release posture

`0.1.0-alpha.0` remains a public alpha candidate only when deterministic scenarios/experiments in `release:check` pass and public documentation matches implementation. Passing these checks does not imply production readiness or end the refinement loop.
