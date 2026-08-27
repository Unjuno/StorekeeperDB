# Next work

This document tracks current StorekeeperDB priorities. Historical implementation details belong in the changelog, merged pull requests, and subsystem notes; this file should answer one question: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The product direction is agent-oriented: StorekeeperDB is being evaluated as a **durable programming model for rapid agent-generated TypeScript prototypes**. The target is to remove persistence architecture decisions from the coding agent's normal planning path wherever doing so remains safe and explainable.

Working rule:

> **Persistence should normally not enter the coding agent's planning loop. Hard persistence problems must remain observable and controllable.**

See [Alpha evaluation loop](./EVALUATION_LOOP.md), [Architecture](./ARCHITECTURE.md), [Agent decision-burden experiment](./AGENT_DECISION_BURDEN_EXPERIMENT.md), [Agent project convention experiment](./AGENT_PROJECT_CONVENTION_EXPERIMENT.md), [Declaration key rename experiment](./DECLARATION_KEY_RENAME_EXPERIMENT.md), and [Collection rename + projection experiment](./COLLECTION_RENAME_PROJECTION_EXPERIMENT.md).

## Active priorities

### 1. Test a multi-step rename chain

Status: **highest priority after collection rename + projection candidate PASS in CI #175.**

Issue #52 strengthened the one-shot alias model: a logical collection rename can keep one physical StorekeeperDB identity, including source rows and derived projection/path/derivation metadata.

Next exercise:

```text
settings -> preferences -> configuration
```

Use one explicit alias at each incompatible rename boundary and omit aliases on ordinary subsequent reopens.

Required properties:

1. exactly one durable physical state throughout;
2. each rename requires only the immediately previous logical name;
3. no requirement to remember the full historical alias chain at the application callsite;
4. current manifest contains one current logical binding rather than accumulating duplicate logical names;
5. ambiguous, reversed, missing, or conflicting aliases fail loudly;
6. ordinary reopen after each rename requires no alias;
7. a later rename still resolves to the original physical identity.

Primary question:

> Is the identity manifest a minimal logical-to-physical identity layer, or merely a one-rename workaround that becomes a schema registry under repeated evolution?

### 2. Evaluate incompatible value evolution beyond key rename

Status: planned after rename-chain verification.

Test deliberately incompatible value changes such as:

- scalar -> structured object;
- enum narrowing;
- required-field introduction;
- declared state split/merge;
- deletion of a declared state.

The objective is to define exactly where persistence must re-enter the coding agent's planning loop. A clean explicit boundary is preferable to unsafe “migration-free” magic.

### 3. Replicate the project convention in a third topology

Status: **candidate direction, not public API.**

PR #49 reused the same generic helper unchanged across project-board and editor/workspace scenarios and reduced measured per-prototype persistence decisions from 7 to 5 in both.

Before exporting any project-store surface, test a third topology such as agent workspace/checkpoints or a multi-list workflow. The exact `openProjectStore/list/object` names remain experiment placeholders only.

### 4. Reuse durable-session bootstrap with project identity

Status: initial cross-process bootstrap PASS; integration unproven.

The existing `__workspace` bootstrap experiment shows that one known key can discover additional durable states across processes. A project declaration plus identity manifest already contains a state namespace, so test whether bootstrap/discovery can reuse that information without creating a second competing registry.

Do not add a general workspace/agent-memory API until reuse is demonstrated.

## Current experimental evidence

### Collection rename with active projection — #52

Status: **CANDIDATE PASS in CI #175; experiment-only.**

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

All behavioral checks passed:

- renamed state preserved both items;
- renamed `find()` returned durable item handles;
- query-result array membership remained local;
- mutating the projected field through a renamed query handle updated the existing projection;
- no source or derived metadata leaked into the logical `workItems` namespace;
- manifest persisted `workItems -> physical "tasks"`;
- later reopen worked without repeating the alias.

Machine result:

```text
CANDIDATE_PASS_LOGICAL_RENAME_PRESERVES_PHYSICAL_DERIVED_STATE
```

Interpretation:

> The successful path did not migrate projection metadata. It avoided migration by keeping physical durable identity stable while changing only the logical declaration name.

This reduces candidate migration complexity, but repeated rename history remains untested.

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

Corrected decision comparison:

```text
compatible-path extra decisions
A 0
B 0
C 0
D 1

rename-boundary extra decisions
A 0  (unsafe)
B 0  (rejects only)
C 1
D 0  (paid up front)
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

Persistence-marked lines were 19, 25, and 14 respectively. This is an auditable implementation proxy, not a measurement of hidden reasoning.

### Singleton-object public surface — #44

Status: **NO CLEAR WINNER in CI #144; no public API change.**

Removing `[0]` ceremony alone did not justify permanent public methods. Singleton adaptation therefore remains project-convention machinery rather than a core API decision.

### Change amplification — #36 / #38

First issue-model scenario: candidate positive evidence, StorekeeperDB persistence-specific changed lines 8 vs 14 for the strongest JSON-blob baseline, concept count tied 4 vs 4.

CLI metadata replication: mixed evidence, StorekeeperDB changed lines 8 vs 12 but concept count 5 vs 4 because the singleton-list boundary became visible.

### Root-state semantics — #40 / #42

A narrow singleton/object helper can reuse current lifecycle semantics, but broad arbitrary-root `state()` generalization remains unsupported. Direct replacement was hardened so writable item handles require current generation, durable-id membership, and exact current proxy identity.

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
  workItems
      |
      v
identity binding
      |
      v
physical StorekeeperDB key
  tasks
      |
      +-- source rows
      +-- paths
      +-- projections
      +-- derivations
```

This is an experiment-layer concept only. It is not yet a public core contract.

### Hard persistence boundaries

The agent-first goal does not authorize hiding incompatible migration, durable identity rename, corruption, concurrent writers, transaction failures, or durability uncertainty. When the runtime cannot preserve semantics safely, the persistence problem must become explicit.

Automatic heuristic rename matching based on shape, content, or declaration order is not supported by current evidence.

## Deferred research

- time-based lifecycle decay (#16);
- richer metadata scoring policy (#17);
- full browser adapter after a realistic browser scenario;
- scalar/root cell abstraction only if a realistic scenario requires it;
- physical-key compaction only if retaining historical physical names becomes a demonstrated problem.

## Release posture

`0.1.0-alpha.0` remains a public alpha candidate only when deterministic scenarios/experiments in `release:check` pass and public documentation matches implementation. Passing these checks does not imply production readiness or end the refinement loop.
