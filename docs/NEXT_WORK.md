# Next work

This document tracks current StorekeeperDB priorities. Historical details belong in experiment notes and merged pull requests; this file should answer: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The product direction is agent-oriented: StorekeeperDB is being evaluated as a **durable programming model for rapid agent-generated TypeScript prototypes**. The target is to remove persistence architecture decisions from the coding agent's normal planning path wherever doing so remains safe and explainable.

Working rule:

> **Persistence should normally not enter the coding agent's planning loop. Hard persistence problems must remain observable and controllable.**

## Active priorities

### 1. Test process-termination checkpoint durability before authorizing a project transaction surface

Status: **next durability-boundary experiment after #87 / CI #323**.

CI #323 showed that both raw `StorekeeperDB.batch()` fallback and an experiment-only thin project `batch()` delegation roll back exactly under a thrown failure, while the thin project candidate avoids four per-prototype decision categories relative to raw fallback.

That is not yet a process-crash guarantee.

Next scenario:

1. seed the same `__workspace` / `tasks` / `decisions` topology;
2. run the writer in a child process;
3. enter a transaction;
4. persist the task mutation;
5. terminate the writer process before checkpoint advancement and before normal transaction return;
6. start a fresh reader process;
7. require the reader to observe the pre-transaction task and checkpoint;
8. compare raw `StorekeeperDB.batch()` and the thin project delegation under the same termination point;
9. record SQLite journal/synchronous assumptions and do not generalize process termination to power-loss guarantees.

Do not publish a project transaction API from the thrown-failure result alone.

### 2. Integrate bootstrap discovery with durable identity only if it removes a real second registry

Status: **cross-process bootstrap without a second registry replicated in #84; declaration-identity integration still unproven**.

CI #312 showed that both candidates could start a fresh reader from DB path + explicit `__workspace`, discover `tasks` and `decisions`, and retain only `__workspace` as a registry-like durable state key. That does not yet prove integration with the declaration/rename identity manifest.

Test whether existing durable identity metadata can supply discovery/identity information without duplicating `__workspace` state references. Fail loudly on incompatible or ambiguous identity; do not infer rename or migration from state content.

### 3. Probe stronger structural lifecycle boundaries only when justified

The single-item parent subtree scenario has an exact fixed PASS regression after #82 / CI #300. Multi-row deletion, nested arrays/index shifts, and concurrent processes remain outside its scope. Extend the lifecycle experiment only when a realistic prototype requires those shapes; do not infer universal subtree correctness from #80.

## Current experimental evidence

### Project checkpoint atomicity escape hatch — #87

Status: **CANDIDATE in CI #323; experiment-only.**

```text
CANDIDATE_PREFER_THIN_PROJECT_BATCH_ESCAPE_HATCH
```

Both compared candidates restored exact task + checkpoint rollback under injected thrown failure and both recovered through a fresh reader process with no second registry.

Measured per-prototype source obligations:

| candidate | persistence-marked lines | decision categories |
|---|---:|---:|
| unchanged convention + raw StorekeeperDB fallback | 22 | 11 |
| experiment-only thin project batch | 15 | 7 |

Raw fallback reintroduced `state-keying`, `singleton-list-adaptation`, raw runtime lifecycle, and raw StorekeeperDB fallback decisions. The thin candidate kept `multi-state-atomicity` explicit and added one incremental experiment-framework concept: `project-batch`.

Interpretation:

> The hard transaction boundary should remain explicit, but dropping to raw StorekeeperDB for each checkpoint throws away much of the convention's routine simplification. A thin project-level delegation is the smaller candidate; public API naming/authorization remains unproven.


### Agent workspace checkpoint convention — #84

Status: **MIXED in CI #312; experiment-only.**

```text
MIXED_CONVENTION_REDUCES_DECISIONS_BUT_CHECKPOINT_ATOMICITY_GAP
```

The unchanged project convention was reused in a third, agent-workspace topology. Writer and reader ran as separate Node processes. A fresh reader started with DB path + explicit `__workspace`, discovered `tasks` and `decisions`, preserved compatible optional task metadata, and found no second registry-like durable state.

Measured source obligations:

| candidate | persistence-marked lines | decision categories |
|---|---:|---:|
| explicit current | 24 | 9 |
| unchanged project convention | 14 | 7 |

The convention removed per-prototype `state-keying` and `singleton-list-adaptation`, while the explicit bootstrap-key decision remained visible. The existing two framework concepts are still reported separately.

The hard boundary was checkpoint atomicity. Direct StorekeeperDB `batch()` rolled back a task mutation injected before checkpoint advancement. The unchanged project-convention surface durably committed the task while checkpoint sequence remained 1, and the split was observed after reopen before explicit repair.

Interpretation:

> Routine persistence decisions can stay reduced in a third topology, but a multi-state durability unit must re-enter the plan explicitly. The evidence supports a narrow transaction escape-hatch experiment, not a public workspace/memory API.


### Detached nested proxy write invalidation — #82

Status: **FIXED in CI #300 (34 tests PASS); minimal internal change, no new public API.**

```text
REPLICATION_PASS_PARENT_SUBTREE_DELETE_REINTRODUCTION_COHERENT
```

Nested proxy writes now require current owner-item membership and an exact live parent-object identity chain. A removed/replaced nested proxy rejects `set`, `deleteProperty`, and mutating array operations before touching local target state or durable/observation metadata. New tests cover detached root children, deeper objects, arrays, replacement, valid active updates, and reopen.

### Parent/subtree deletion and reintroduction — #80

Status: **MIXED in CI #287; experiment-only.**

```text
MIXED_PARENT_SUBTREE_CURRENT_STATE_CORRECT_BUT_STALE_CHILD_WRITE_ACCEPTED
```

Parent deletion and reintroduction preserved source/projection/query/rollback/reopen correctness and prefix-neighbor isolation. The child proxy captured before parent deletion accepted a detached write with persistence side effects, without resurrecting the subtree. A previously overcounted reintroduction audit was corrected: absent descendant cells produce INSERTs but no trigger events for zero-row DELETEs. This finding was corrected independently in #82 / CI #300; the historical MIXED result remains recorded. Neither a migration API nor a projection cell-diff optimization was required.

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

- Agent project convention: 7 -> 5 measured per-prototype persistence decisions in two earlier scenarios; the third agent-workspace topology measured 9 -> 7 while exposing a checkpoint-atomicity boundary. The #87 escape-hatch comparison then measured raw fallback 11 decisions vs thin project batch 7 while preserving explicit multi-state atomicity.
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
  -> parent/subtree deletion physical correctness observed in #80; stale child writes still accepted (MIXED)

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
