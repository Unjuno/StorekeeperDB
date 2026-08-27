# Next work

This document tracks current StorekeeperDB priorities. Historical implementation details belong in the changelog, merged pull requests, and subsystem notes; this file should answer one question: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The product direction is agent-oriented: StorekeeperDB is being evaluated as a **durable programming model for rapid agent-generated TypeScript prototypes**. The target is to remove persistence architecture decisions from the coding agent's normal planning path wherever doing so remains safe and explainable.

Working rule:

> **Persistence should normally not enter the coding agent's planning loop. Hard persistence problems must remain observable and controllable.**

See [Alpha evaluation loop](./EVALUATION_LOOP.md), [Architecture](./ARCHITECTURE.md), [Agent project convention experiment](./AGENT_PROJECT_CONVENTION_EXPERIMENT.md), [Declaration key rename experiment](./DECLARATION_KEY_RENAME_EXPERIMENT.md), [Collection rename + projection experiment](./COLLECTION_RENAME_PROJECTION_EXPERIMENT.md), [Multi-step declaration rename experiment](./MULTI_STEP_DECLARATION_RENAME_EXPERIMENT.md), [State split migration boundary experiment](./STATE_SPLIT_MERGE_BOUNDARY_EXPERIMENT.md), and [State merge migration boundary experiment](./STATE_MERGE_BOUNDARY_EXPERIMENT.md).

## Active priorities

### 1. Evaluate incompatible value evolution

Status: **next hard migration experiment after split and merge boundary confirmation.**

Probe deliberately incompatible value changes in one stable durable state identity:

```text
scalar -> structured object
enum widening/narrowing
optional -> required field
field deletion with dependent query/projection metadata
```

The first scenario should keep identity stable and change value meaning, so durable-key rename cannot explain the result.

Required properties:

1. persisted V1 values must survive reopen before migration;
2. merely changing the TypeScript declaration must not be counted as a successful migration if stored V1 values remain semantically incompatible;
3. an explicit transform must run atomically in `batch()`;
4. source reads/validation must occur inside the transaction when they affect observation metadata;
5. failure injection must restore values, projections/derivations, and observation counters exactly;
6. successful retry must reopen in the V2 shape;
7. narrowing/required-field cases must reject unmappable inputs rather than invent defaults silently;
8. no new public migration API should be added unless the experiment shows repeated unavoidable ceremony beyond the tested primitives.

Primary question:

> Where exactly does StorekeeperDB's compatible JSON evolution stop, and what is the minimum explicit migration contract needed once a value's meaning changes?

Candidate first case:

```text
V1: retryDelayMs: number
V2: retryPolicy: { delayMs: number; maxAttempts: number }
```

This forces a semantic scalar-to-object transform and an explicit value for newly required `maxAttempts`.

### 2. Evaluate migration idempotency and crash/retry markers

Status: planned after incompatible value transformation.

Split and merge experiments prove transaction rollback inside one process, but do not establish how a migration is recognized, retried, or skipped after process interruption or version skew.

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

### Many-to-one declared-state merge migration — #60

Status: **BOUNDARY CONFIRMED in CI #205; experiment-only.**

Scenario:

```text
account { displayName, locale }
preferences { compactMode, locale }
  ->
profile { displayName, compactMode, locale }
```

Naive merge failed safely before target creation. Misusing one-to-one aliasing as `profile from account` was also rejected because `preferences` remained an unexplained removed source.

The explicit migration then placed source reads, conflict resolution, target construction, source retirement, manifest mutation, and metadata cleanup inside one outer `batch()`. Failure injected after all mutations restored both source values, target absence, identity bindings, projections/derivations, and exact source path counters. Retry succeeded and reopened with one `profile` state.

With conflicting source locales, merge without a policy failed. Explicit `prefer-account` deterministically persisted `en-US`.

Machine result:

```text
BOUNDARY_CONFIRMED_MERGE_REQUIRES_EXPLICIT_CONFLICT_AWARE_MIGRATION
```

Interpretation:

> Many-to-one merge is a semantic migration, not identity aliasing. Conflict resolution belongs to explicit application/migration policy, and the atomic unit must include source reads/validation when those reads affect behavior-driving metadata.

No public migration API is authorized by this result.

### Declared-state split migration boundary — #56

Status: **BOUNDARY CONFIRMED in CI #192; experiment-only.**

Scenario:

```text
profile { displayName, compactMode }
  ->
account { displayName }
preferences { compactMode }
```

Naive remove+add failed before target creation and preserved the source/manifest. Misusing `account from profile` plus fresh `preferences` produced a structurally valid but semantically incomplete result: the persisted `compactMode` value was lost.

An explicit migration using `StorekeeperDB.batch()`, durable states, manifest mutation, projection eviction, and source metadata compaction was failure-injected after all writes. Rollback restored source, absent targets, manifest, derivation, and projection; retry succeeded and reopened with both transformed values.

Machine result:

```text
BOUNDARY_CONFIRMED_SPLIT_REQUIRES_EXPLICIT_ATOMIC_MIGRATION
```

### Batch rollback observation neutrality — #62

Status: **fixed in PR #63 / CI #202.**

The merge experiment exposed that `memorySnapshot()` cloned observable proxies and thereby incremented `__sk_paths.read_count` before transaction start. Internal snapshot reads are now observation-suppressed while callback reads remain observable and rollback correctly.

This is a runtime hardening result, not a migration API change.

### `debug().compactMetadata()` static type mismatch — #58

Status: **fixed in PR #59 / CI #199.**

The concrete `StorekeeperDB.debug()` return type now agrees with the already-exported `StorekeeperDebugAPI`, allowing object-form `compactMetadata({ stateKey, ... })` without a cast. Runtime behavior was unchanged.

### Multi-step declaration rename — #54

Status: **CANDIDATE PASS in CI #183; experiment-only.**

Tested `settings -> preferences -> configuration` while retaining physical key `settings`. Missing/stale/nonexistent aliases and kind mismatch all failed loudly; current value/manifest remained intact after rejected attempts.

Machine result:

```text
CANDIDATE_PASS_MULTI_STEP_RENAME_RETAINS_SINGLE_PHYSICAL_IDENTITY
```

### Collection rename with active projection — #52

Status: **CANDIDATE PASS in CI #175 / final synchronized gate CI #181.**

Logical `tasks -> workItems` retained physical key `tasks`, source rows and projection cells remained in one physical namespace, and projected-field mutation stayed durable and index-consistent.

Machine result:

```text
CANDIDATE_PASS_LOGICAL_RENAME_PRESERVES_PHYSICAL_DERIVED_STATE
```

### Declaration property rename / durable identity — #50

Status: **CANDIDATE PASS in CI #168 / final synchronized gate CI #173.**

Naive property-derived identity silently initialized fresh state and duplicated physical state. Fail-loudly manifest and explicit one-shot alias paths avoided this; stable durable ids also worked but added an upfront compatible-path decision.

Machine result:

```text
CANDIDATE_PREFER_EXPLICIT_RENAME_ALIAS_WITH_IDENTITY_MANIFEST
```

### Agent-facing durable project convention — #48

Status: **CANDIDATE PASS; final synchronized CI #165.**

The same generic helper was reused unchanged in project-board and editor/workspace scenarios:

```text
project board      7 -> 5 decisions; 14 -> 8 persistence lines
editor/workspace   7 -> 5 decisions; 14 -> 8 persistence lines
```

This supports a project-level architecture direction, not the exact public API.

### Agent persistence decision burden — #46

Status: **CANDIDATE PASS in CI #147 / final synchronized gate CI #153.**

Measured persistence-specific decision categories:

```text
relational SQLite  8
JSON-blob SQLite   8
StorekeeperDB      7
```

This is an auditable implementation proxy, not a measurement of hidden reasoning.

### Singleton/root and change-amplification evidence

- Singleton-object surface #44: no clear winner; no public API change.
- First change-amplification scenario #36: StorekeeperDB 8 changed persistence lines vs 14 for strongest JSON-blob baseline, concept count tied 4 vs 4.
- CLI metadata replication #38: 8 vs 12 changed lines but 5 vs 4 concepts due to singleton-list boundary.
- Root-state semantics #40/#42: narrow singleton/object adaptation can reuse current lifecycle semantics; broad arbitrary-root `state()` remains unsupported.

## Resolved command/read semantics

```text
state() item             -> durable handle
find() result item       -> durable handle
find() result array      -> ordinary local array
liveFind() result values -> detached stable snapshots
```

Removed references remain readable but cannot write deleted rows back. Rollback invalidates old-generation handles. Reorder preserves identity.

## Confirmed architecture boundaries

### Logical vs physical durable identity

```text
logical declaration name
  configuration
      |
      v
current identity binding
      |
      v
physical StorekeeperDB key
  settings
```

For queried collections, the same physical namespace owns source rows, paths, projections, and derivations. The tested manifest keeps only the current logical binding; it is not a rename-history registry.

### Evolution classes now observed

```text
compatible value evolution
  -> automatic where semantics remain compatible

one-to-one logical rename
  -> explicit identity alias
  -> stable physical identity

split / merge / semantic transform
  -> explicit value transformation
  -> source reads + validation inside transaction
  -> explicit conflict policy when required
  -> explicit source retirement
  -> derived metadata cleanup
```

The split and merge experiments show that structural identity validity is insufficient to prove semantic preservation.

### Hard persistence boundaries

The agent-first goal does not authorize hiding incompatible value transformation, split/merge, durable identity rename, corruption, concurrent writers, transaction failures, or durability uncertainty. When the runtime cannot preserve semantics safely, the persistence problem must become explicit.

Automatic heuristic rename, split, or merge matching based on shape, content, or declaration order is not supported by current evidence.

## Deferred research

- time-based lifecycle decay (#16);
- richer metadata scoring policy (#17);
- full browser adapter after a realistic browser scenario;
- scalar/root cell abstraction only if a realistic scenario requires it;
- physical-key compaction only if retaining historical physical names becomes a demonstrated problem.

## Release posture

`0.1.0-alpha.0` remains a public alpha candidate only when deterministic scenarios/experiments in `release:check` pass and public documentation matches implementation. Passing these checks does not imply production readiness or end the refinement loop.
