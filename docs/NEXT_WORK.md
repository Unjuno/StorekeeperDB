# Next work

This document tracks current StorekeeperDB priorities. Historical implementation details belong in the changelog, merged pull requests, and subsystem notes; this file should answer one question: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The product direction is now more specific: StorekeeperDB is being evaluated as an **agent-oriented durable programming model for rapid TypeScript prototyping**. The target is not merely shorter database code. The target is to remove persistence architecture decisions from the coding agent's normal planning path wherever doing so remains safe and explainable.

Working rule:

> **Persistence should normally not enter the coding agent's planning loop. Hard persistence problems must remain observable and controllable.**

See [Alpha evaluation loop](./EVALUATION_LOOP.md), [Architecture](./ARCHITECTURE.md), and [Agent decision-burden experiment](./AGENT_DECISION_BURDEN_EXPERIMENT.md).

## Active priorities

### 1. Reduce agent-visible persistence decisions — follow-up to #46

Status: **first decision-burden scenario is CANDIDATE PASS in CI #147.**

The project-board experiment compared relational SQLite, JSON-blob SQLite, and StorekeeperDB using an auditable source-level decision manifest rather than hidden chain-of-thought.

Conservative result after correcting one favorable StorekeeperDB omission:

```text
                     persistence lines   persistence decisions
relational SQLite            19                    8
JSON-blob SQLite             25                    8
StorekeeperDB                14                    7
```

All implementations passed the same reopen, compatible-evolution, and urgent-query checks.

StorekeeperDB's remaining explicit decisions were:

```text
compatible-state-evolution
durable-query
durable-state
singleton-list-adaptation
state-keying
storekeeper-lifecycle
storekeeper-runtime
```

The next experiment should ask which of these are truly product/domain decisions and which are repetitive infrastructure decisions that an agent-facing project convention can absorb.

Candidate reductions to test without changing core storage semantics:

1. **runtime/lifecycle convention** — can project-scoped setup remove repeated `new StorekeeperDB(path)` / close bookkeeping from generated feature code while preserving an explicit durability boundary?
2. **state discovery/key convention** — can a known project/bootstrap manifest remove duplicated key bookkeeping without creating a central schema registry?
3. **singleton/root adaptation** — can the agent avoid inventing one-item arrays without adding a misleading arbitrary-root model or unnecessary permanent API?

Do not optimize for source characters alone. Measure the number of persistence-specific implementation obligations remaining after each convention.

### 2. Replicate agent decision burden in another prototype shape

Status: planned; required before broad product claims.

The first scenario combines a task collection with singleton project settings. A second scenario should stress a different state topology, for example:

- local content/editor draft with metadata + revision list;
- small workflow/run tracker with checkpoints + events;
- agent workspace state with bootstrap manifest + durable findings.

Use the same decision-marker methodology and direct relational / JSON-blob baselines. A one-scenario 7 vs 8 difference is evidence, not a general productivity guarantee.

### 3. Evaluate incompatible model evolution

Status: planned after the agent-facing convention experiment.

Test a deliberately incompatible change such as:

- field rename;
- scalar -> structured object;
- enum narrowing;
- required-field introduction.

The objective is to locate where persistence can no longer remain implicit and explicit migration/validation must re-enter the agent's planning architecture.

A clean explicit boundary is preferable to unsafe “migration-free” magic.

### 4. Reuse durable-session bootstrap in a second scenario

Status: initial cross-process experiment PASS; generalization remains uncertain.

A writer and reader in separate Node processes can use one known bootstrap key to discover other durable states. This is now especially relevant to the agent-oriented direction because discoverability can reduce state-key planning burden.

Reuse the convention in a second realistic scenario without modifying StorekeeperDB core specifically for it before considering a first-class workspace/bootstrap API.

## Current experimental evidence

### Agent persistence decision burden — #46

Status: **CANDIDATE PASS in CI #147.**

Against both direct-SQL baselines, StorekeeperDB used fewer persistence-specific decision categories in the project-board scenario: 7 vs 8, while also using 14 persistence-marked lines vs the strongest baseline's 19.

This is an auditable implementation proxy, not a measurement of private reasoning tokens. The taxonomy was deliberately corrected from an initial 6 to 7 Storekeeper decisions by adding `compatible-state-evolution`.

Interpretation:

> StorekeeperDB moved some schema/bootstrap/serialization/write-plumbing decisions behind the durable-state runtime, but it has not eliminated persistence reasoning. The remaining agent-visible decisions are now concrete optimization targets.

### Singleton-object public surface — #44

Status: **NO CLEAR WINNER in CI #144; no public API change.**

```text
A current list-only          11 surface lines / 483 chars / 0 new names
B objectState/objectSignal   10 surface lines / 496 chars / 2 new names
C objectHandle               10 surface lines / 418 chars / 1 new name + .value ceremony
```

B removes list/index ceremony but did not dominate enough to justify permanent API. The agent-first framing changes the next question from “which callsite is shortest?” to “which convention removes a persistence decision?”

### Persistence-specific change amplification — #36

Status: CANDIDATE PASS in CI #116 / final gate CI #120.

Against the strongest JSON-blob baseline, persistence-specific changed lines were 14 -> 8 (~42.9% lower) and raw all-source changed lines were 40 -> 34. Concept count was equal at 4 vs 4.

### CLI metadata replication — #38

Status: MIXED in CI #122 / final gate CI #126.

Against JSON-blob SQLite, persistence-specific changed lines were 12 -> 8 (~33.3% lower) and raw all-source changed lines were 35 -> 30. StorekeeperDB concept count was worse at 5 vs 4 because the one-record workload exposed `singleton-list-boundary`.

### Root-state semantics — #40

Status: candidate B in CI #128, revalidated after replacement hardening in CI #136.

A narrow singleton/object helper can reuse current lifecycle semantics, but broad arbitrary-root `state()` generalization remains unsupported. JavaScript primitive values cannot provide mutation-by-reference durability without an explicit cell/get-set model.

## Resolved product/API decisions

### Direct replacement handle invalidation — #42

Implemented in PR #43 and revalidated in CI #139.

Writable item handles require:

```text
current loaded generation
AND current durable-id membership
AND exact current proxy identity
```

This preserves reorder identity while invalidating displaced replacement handles.

### `find()` durable-handle semantics — #29

Implemented in PR #35; final release gate passed in CI #113.

```text
state() item             -> durable handle
find() result item       -> durable handle
find() result array      -> ordinary local array
liveFind() result values -> detached stable snapshots
```

### Removed-handle invalidation — #31

Fixed by PR #33 / CI #98. Removed references remain readable but writes fail; reorder remains valid; rollback invalidates old-generation handles.

### Reactive snapshot separation — #32

Fixed by PR #34 / CI #101. `liveFind()` owns detached snapshots independently of mutable `find()` handles.

## Confirmed architecture boundaries

### Agent-facing layers

```text
user intent
   ↓
coding agent / prototype generator
   ↓
agent-facing project convention      <- current simplification target
   ↓
StorekeeperDB durable runtime
   ↓
SQLite
```

StorekeeperDB core should own durable local state and derived persistence machinery. Project/bootstrap conventions may reduce repetitive agent decisions above core. Conversation summarization, prompt policy, trust, agent identity, and multi-agent coordination remain separate concerns.

### Variable lifetime

```text
local value
session/process value
durable state
discoverable durable state
```

The durable-session experiment proves one bootstrap convention for moving from durable to discoverable durable state. It does not yet justify a general workspace API.

### Command / read boundary

```text
command-capable durable plane
  state()
  find()

reactive read plane
  liveFind()
```

Close/reopen preserves durable data, not JavaScript proxy identity.

### Root values

Current public `state()` remains list-of-objects. The experiments do not authorize arbitrary-root support.

The list-only shape is now also measured as an **agent decision cost** (`singleton-list-adaptation`), but the failed domination of candidate singleton APIs means the next move should test conventions/architecture rather than immediately add methods.

### Hard persistence boundaries

The agent-first goal does not authorize hiding incompatible migration, corruption, concurrent writers, transaction failures, or durability uncertainty. When the runtime cannot preserve semantics safely, the persistence problem must become explicit.

## Deferred research

### Time-based lifecycle decay — #16

- optional time-based cold marking;
- explicit periodic derived GC semantics;
- no hidden background work.

### Richer metadata scoring policy — #17

- usefulness scoring for observation metadata;
- explicit deletion boundaries;
- source state remains outside metadata-scoring deletion.

### Full browser adapter

The experimental async write-behind runtime defines a durability boundary; it is not a complete browser adapter. Browser work should wait for a realistic browser scenario.

### Scalar/root cell abstraction

The explicit `cell.value` prototype can persist primitives, but no realistic scenario yet shows that this additional abstraction belongs in core.

## Release posture

`0.1.0-alpha.0` remains a public alpha candidate only when deterministic scenarios/experiments in `release:check` pass and public documentation matches implementation. Passing these checks does not imply production readiness or end the refinement loop.
