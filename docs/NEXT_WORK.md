# Next work

This document tracks current StorekeeperDB priorities. Historical details belong in experiment notes and merged pull requests; this file should answer: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The product direction is agent-oriented: StorekeeperDB is being evaluated as a **durable programming model for rapid agent-generated TypeScript prototypes**. The target is to remove persistence architecture decisions from the coding agent's normal planning path wherever doing so remains safe and explainable.

Working rule:

> **Persistence should normally not enter the coding agent's planning loop. Hard persistence problems must remain observable and controllable.**

## Active priorities

### 1. Test projected parent/subtree deletion after nested-leaf lifecycle PASS

Status: **next correctness falsification target after #78 / CI #280.**

The nested projected-leaf experiment now has an exact regression gate and observed:

```text
REPLICATION_PASS_NESTED_DELETE_REINTRODUCTION_COHERENT
```

for:

```text
routing.legacyTag present
-> delete nested leaf
-> close/reopen
-> reintroduce nested leaf
-> close/reopen
```

Source state, sibling `routing.queue` projection, query semantics, rollback, item identity, metadata reuse, and the expected changed-item projection rebuild shape stayed coherent. This closes the leaf-level stale-cell question but does not prove subtree deletion.

Next scenario:

```text
V1 job
{
  id,
  routing: {
    queue,
    legacyTag
  },
  routingBackup: {
    queue
  }
}

  -> delete routing ->

V2 job
{
  id,
  routingBackup: {
    queue
  }
}
```

Required checks:

1. activate projections for multiple descendants under `routing` plus an unrelated similarly named subtree;
2. delete the parent object through a durable handle;
3. inject failure and require exact source/projection/metadata rollback;
4. inspect physical projection storage before any query can rebuild it;
5. require all removed descendant queries to exclude the deleted subtree;
6. require `routingBackup` and unrelated rows to remain untouched;
7. close/reopen and verify parent absence;
8. reintroduce `routing` and verify descendant projection/query recovery without stale or duplicate cells;
9. test stale parent/child handles captured before parent deletion so they cannot resurrect removed state;
10. keep projection cell-diff optimization out of the same experiment.

Critical question:

> Does correctness still hold when one mutation removes and later reintroduces an entire projected subtree, including multiple descendant paths and stale nested handles, or was the nested-leaf PASS too narrow?

### 2. Replicate the project convention in a third topology

Status: candidate direction, not public API.

PR #49 reused the same generic helper unchanged across project-board and editor/workspace scenarios and reduced measured per-prototype persistence decisions from 7 to 5 in both. Test a third topology such as agent workspace/checkpoints or a multi-list workflow.

### 3. Reuse durable-session bootstrap with project identity

Status: initial cross-process bootstrap PASS; integration unproven.

Test whether the project declaration/identity manifest can also provide durable-state discovery without creating a second registry. Do not add a general workspace/agent-memory API until reuse is demonstrated.

## Current experimental evidence

### Nested field deletion and reintroduction — #78

Status: **REPLICATION PASS in CI #280; experiment-only.**

```text
REPLICATION_PASS_NESTED_DELETE_REINTRODUCTION_COHERENT
```

The regression gate now requires that exact decision plus the observed correctness checks; FAIL or MIXED decisions no longer pass merely because they are known labels.

The tested nested leaf lifecycle preserved:

- exact rollback under injected failure;
- source and sibling projection correctness immediately after delete;
- old-value query exclusion;
- physical projection correctness before query execution;
- item id/position across both reopen boundaries;
- reintroduction without stale/duplicate cells;
- derivation/path metadata coherence and reuse;
- the expected item-local projection rebuild pattern.

This is evidence for nested scalar-leaf lifecycle correctness, not parent/subtree deletion, nested-array deletion, or concurrent writers.

### Projection-maintenance write amplification — #76

Status: **MEASURED in CI #258; experiment-only.**

```text
MEASURED_LINEAR_ITEM_REBUILD_WRITES_TIMING_OBSERVATIONAL
```

For a one-field replacement with all active projected scalar paths retained:

```text
D(P) = P
I(P) = P
U(P) = 0
W(P) = 2P
```

Observed deterministic write counts:

| `P` | writes/op |
|---:|---:|
| 1 | 2 |
| 4 | 8 |
| 16 | 32 |
| 64 | 128 |

Source, projection, query, and reopen correctness passed for all four cases. Timing was measured separately without audit triggers and is observational only; no latency threshold was added to the release gate.

Interpretation:

> The current projection update path has exact changed-item `O(P)` write amplification in this scenario, but one CI environment does not establish that the absolute cost is product-significant. Keep the simple rebuild until a realistic workload demonstrates that incremental cell maintenance is worth its additional stale-cell and rollback complexity.

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
  -> explicit durable property delete is mechanically sufficient in tested single-row, mixed-row, and nested-leaf cases
  -> deleted projection cell disappears automatically
  -> changed-item active projections are currently rebuilt item-locally
  -> surviving rows and sibling nested projections remain isolated/coherent in tested scenarios
  -> derivation/path history may remain as lifecycle metadata and can be reused on reintroduction
  -> projected parent/subtree deletion remains unproven

projection maintenance
  -> one-field replacement with P active scalar projections measured W(P) = 2P writes/op
  -> timing remains observational and environment-specific
  -> no incremental cell-diff optimization justified yet

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

- automatic decay/compaction policy for obsolete derivation/path metadata;
- concurrent old/new process migration behavior and multiple writers;
- migration dependency ordering / marker scope;
- realistic active-projection-count distributions before any cell-diff optimization;
- time-based lifecycle decay (#16);
- richer metadata scoring policy (#17);
- full browser adapter after a realistic browser scenario;
- scalar/root cell abstraction only if a realistic scenario requires it;
- physical-key compaction only if retaining historical physical names becomes a demonstrated problem.

## Release posture

`0.1.0-alpha.0` remains a public alpha candidate only when deterministic scenarios/experiments in `release:check` pass and public documentation matches implementation. Passing these checks does not imply production readiness or end the refinement loop.
