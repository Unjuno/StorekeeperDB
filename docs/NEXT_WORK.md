# Next work

This document tracks current StorekeeperDB priorities. Historical implementation details belong in the changelog, merged pull requests, and subsystem notes; this file should answer one question: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The product direction is agent-oriented: StorekeeperDB is being evaluated as a **durable programming model for rapid agent-generated TypeScript prototypes**. The target is to remove persistence architecture decisions from the coding agent's normal planning path wherever doing so remains safe and explainable.

Working rule:

> **Persistence should normally not enter the coding agent's planning loop. Hard persistence problems must remain observable and controllable.**

See [Alpha evaluation loop](./EVALUATION_LOOP.md), [Architecture](./ARCHITECTURE.md), [Agent project convention experiment](./AGENT_PROJECT_CONVENTION_EXPERIMENT.md), [Declaration key rename experiment](./DECLARATION_KEY_RENAME_EXPERIMENT.md), [Collection rename + projection experiment](./COLLECTION_RENAME_PROJECTION_EXPERIMENT.md), and [Multi-step declaration rename experiment](./MULTI_STEP_DECLARATION_RENAME_EXPERIMENT.md).

## Active priorities

### 1. Test declared-state split/merge boundary

Status: **highest priority after multi-step rename candidate PASS in CI #183.**

The identity model now passed:

- one-shot object rename;
- collection rename with an active projection;
- repeated `settings -> preferences -> configuration` rename;
- alias-free ordinary reopens;
- failure-atomic negative cases for missing, stale, nonexistent, and kind-mismatched aliases.

The next challenge is deliberately not one-to-one:

```text
profile
  ->
account + preferences
```

or the reverse.

Required properties:

1. naive remove+add without an explicit migration must fail before fresh target state is silently accepted;
2. a one-to-one rename alias must not pretend to represent one-to-many or many-to-one transformation;
3. any explicit migration candidate must own value transformation and atomicity;
4. a failed transform must leave the old source valid;
5. failed migration must not leave partial target state;
6. successful source retirement/retention policy must be explicit;
7. split/merge must not be inferred heuristically from shape, content, or declaration order.

Primary question:

> Have we reached the point where a narrow durable-identity alias is no longer enough and real migration semantics must re-enter the coding agent's planning loop?

### 2. Evaluate incompatible value evolution

Status: planned alongside or immediately after split/merge.

Probe deliberately incompatible value changes such as:

- scalar -> structured object;
- enum narrowing;
- required-field introduction;
- deletion of a declared state;
- value transformation that cannot be expressed as compatible JSON shape evolution.

The objective is to define exactly where persistence must become explicit. A clean, transactional migration boundary is preferable to unsafe “migration-free” magic.

### 3. Replicate the project convention in a third topology

Status: **candidate direction, not public API.**

PR #49 reused the same generic helper unchanged across project-board and editor/workspace scenarios and reduced measured per-prototype persistence decisions from 7 to 5 in both.

Before exporting any project-store surface, test a third topology such as agent workspace/checkpoints or a multi-list workflow. The exact `openProjectStore/list/object` names remain experiment placeholders only.

### 4. Reuse durable-session bootstrap with project identity

Status: initial cross-process bootstrap PASS; integration unproven.

The existing `__workspace` bootstrap experiment shows that one known key can discover additional durable states across processes. A project declaration plus identity manifest already contains a state namespace, so test whether bootstrap/discovery can reuse that information without creating a second competing registry.

Do not add a general workspace/agent-memory API until reuse is demonstrated.

## Current experimental evidence

### Multi-step declaration rename — #54

Status: **CANDIDATE PASS in CI #183; experiment-only.**

Tested:

```text
settings -> preferences -> configuration
```

Each rename supplied only the immediately previous logical name. Ordinary reopens required no alias.

Final manifest:

```text
configuration -> physical settings
```

Final physical source keys:

```text
settings only
```

Negative controls all rejected safely:

- missing alias;
- stale original `from: "settings"` during the second rename;
- nonexistent alias source;
- object/list kind mismatch;
- expired `preferences` alias after `configuration` became current.

After every failed attempt, the current value and manifest remained intact.

Machine result:

```text
CANDIDATE_PASS_MULTI_STEP_RENAME_RETAINS_SINGLE_PHYSICAL_IDENTITY
```

Interpretation:

> The tested manifest behaves as one current logical-to-physical identity binding rather than a rename-history registry. Previous logical names are consumed, while the original physical key remains stable.

This resolves the repeated-rename uncertainty from #52 for the tested one-state chain. It does **not** establish split/merge or arbitrary value-migration semantics.

### Collection rename with active projection — #52

Status: **CANDIDATE PASS in CI #175 / final synchronized gate CI #181; merged in PR #53.**

Scenario:

```text
logical before: tasks
logical after:  workItems
physical key:   tasks
projected path: priority
```

Observed:

```text
projection cells before rename         2
projection cells after rename          2
source rows under tasks                 2
source rows under workItems             0
workItems projection/path/derivation    0
```

Machine result:

```text
CANDIDATE_PASS_LOGICAL_RENAME_PRESERVES_PHYSICAL_DERIVED_STATE
```

The successful path did not migrate projection metadata. It avoided migration by keeping physical durable identity stable while changing only the logical declaration name.

Repeated rename history was subsequently tested successfully by #54.

### Declaration property rename / durable identity — #50

Status: **CANDIDATE PASS in CI #168; final synchronized gate CI #173.**

Four candidates were tested after persisting non-default `settings` state and renaming the declaration property to `preferences`.

```text
A naive property-derived key
  old value preserved     NO
  silent fresh init       YES
  duplicate physical key  YES

B strict identity manifest
  unexplained rename      FAILS LOUDLY
  silent fresh init       NO
  duplicate physical key  NO

C one-shot rename alias
  old value preserved     YES
  later alias required    NO
  duplicate physical key  NO
  physical key renamed    NO

D stable durable id
  old value preserved     YES
  compatible-path cost    +1 explicit identity decision
```

Machine result:

```text
CANDIDATE_PREFER_EXPLICIT_RENAME_ALIAS_WITH_IDENTITY_MANIFEST
```

Current interpretation:

> Routine compatible work can remain free of explicit durable-key bookkeeping, while an actual durable-identity rename requires one explicit alias decision.

### Agent-facing durable project convention — #48

Status: **CANDIDATE PASS; PR #49 / final synchronized CI #165.**

The same generic helper was reused unchanged in project-board and editor/workspace scenarios.

```text
project board      7 -> 5 decisions; 14 -> 8 persistence lines
editor/workspace   7 -> 5 decisions; 14 -> 8 persistence lines
```

The result supports a project-level architecture direction, not the exact public API.

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
- First change-amplification scenario #36: candidate positive evidence, StorekeeperDB 8 changed persistence lines vs 14 for strongest JSON-blob baseline, concept count tied 4 vs 4.
- CLI metadata replication #38: mixed evidence, 8 vs 12 changed lines but 5 vs 4 concepts due to singleton-list boundary.
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

### Agent-facing layers

```text
user intent
   ↓
coding agent / prototype generator
   ↓
agent-facing project convention
   ↓
StorekeeperDB durable runtime
   ↓
SQLite
```

### Logical vs physical durable identity

Current experiment evidence supports separating declaration naming from physical StorekeeperDB identity:

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

For queried collections, the same physical namespace also owns source rows, paths, projections, and derivations.

The tested manifest keeps only the current logical binding; it does not preserve a rename-history chain.

This remains an experiment-layer concept only. It is not yet a public core contract.

### Hard persistence boundaries

The agent-first goal does not authorize hiding incompatible value transformation, split/merge, durable identity rename, corruption, concurrent writers, transaction failures, or durability uncertainty. When the runtime cannot preserve semantics safely, the persistence problem must become explicit.

Automatic heuristic rename or split/merge matching based on shape, content, or declaration order is not supported by current evidence.

## Deferred research

- time-based lifecycle decay (#16);
- richer metadata scoring policy (#17);
- full browser adapter after a realistic browser scenario;
- scalar/root cell abstraction only if a realistic scenario requires it;
- physical-key compaction only if retaining historical physical names becomes a demonstrated problem.

## Release posture

`0.1.0-alpha.0` remains a public alpha candidate only when deterministic scenarios/experiments in `release:check` pass and public documentation matches implementation. Passing these checks does not imply production readiness or end the refinement loop.
