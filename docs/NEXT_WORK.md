# Next work

This document tracks current StorekeeperDB priorities. Historical implementation details belong in the changelog, merged pull requests, and subsystem notes; this file should answer one question: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The current goal is not promotion and not feature-count growth. The goal is to use realistic scenarios to expose API friction, failure modes, persistence-specific change amplification, and architecture boundaries before expanding the public surface.

See [Alpha evaluation loop](./EVALUATION_LOOP.md) and [Architecture](./ARCHITECTURE.md).

## Active priorities

### 1. Evaluate root-state semantics

Status: **new product/API decision justified by #38; do not implement a new root API yet.**

Two compatible-evolution experiments now show lower explicit persistence edit surface vs a minimal JSON-blob SQLite baseline:

```text
Issue-list scenario
  JSON blob       14 changed persistence lines
  StorekeeperDB    8

CLI metadata singleton
  JSON blob       12 changed persistence lines
  StorekeeperDB    8
```

However, the CLI metadata replication was MIXED because one logical metadata record must currently be represented as a one-item persistent list.

V2 persistence concepts:

```text
JSON blob       4
StorekeeperDB   5
```

The additional StorekeeperDB concept is the explicitly counted `singleton-list-boundary`.

This is now evidence that the list-only root contract creates real conceptual ceremony, not merely a documentation inconvenience.

Next evaluation should compare at least:

1. keep list-only `state()` and formalize a singleton convention;
2. add a focused singleton/object state API;
3. generalize `state()` to arbitrary JSON roots.

Evaluate API size, mutation ergonomics, rollback/stale semantics, identity, serialization, migration implications, implementation complexity, and compatibility with signals/reactive reads before choosing.

Do not add arbitrary-root support solely to make the previous benchmark look better.

See [CLI metadata replication](./CLI_METADATA_CHANGE_AMPLIFICATION_EXPERIMENT.md).

### 2. Evaluate incompatible model evolution

Status: planned after the root-state semantic decision is understood.

Test a deliberately incompatible change such as:

- field rename;
- scalar -> structured object;
- enum narrowing;
- required-field introduction.

The objective is to locate where persistence can no longer remain implicit and explicit migration/validation must re-enter the application architecture.

A clean explicit boundary is preferable to unsafe “migration-free” magic.

### 3. Reuse durable-session bootstrap in a second scenario — #26

Status: initial cross-process experiment PASS; generalization remains uncertain.

A writer and reader in separate Node processes can use one known bootstrap key to discover other durable states. This proves one convention, not a general workspace/agent-memory API.

Reuse the convention in a second realistic scenario without modifying StorekeeperDB core specifically for it before considering a first-class workspace/bootstrap API.

## Current experimental evidence

### Persistence-specific change amplification — #36

Status: CANDIDATE PASS in CI #116 / final gate CI #120.

Against the strongest JSON-blob baseline, persistence-specific changed lines were 14 -> 8 (~42.9% lower) and raw all-source changed lines were 40 -> 34. Concept count was equal at 4 vs 4.

### CLI metadata replication — #38

Status: MIXED in CI #122.

Against JSON-blob SQLite, persistence-specific changed lines were 12 -> 8 (~33.3% lower) and raw all-source changed lines were 35 -> 30. StorekeeperDB concept count was worse at 5 vs 4 because the one-record workload exposed `singleton-list-boundary`.

Interpretation:

> Reduced explicit persistence edit surface now has directionally consistent evidence in two compatible JSON-style scenarios. Lower conceptual complexity does not; the root-list restriction is a measured counterexample.

Do not convert the measured percentages into a general performance/product claim.

## Resolved product/API decisions

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

### Variable lifetime

```text
local value
session/process value
durable state
discoverable durable state
```

StorekeeperDB core owns durable local state. Bootstrap/discovery conventions may live above core. Agent memory, summarization, trust, context selection, and multi-agent coordination remain outside core.

### Command / read boundary

```text
command-capable durable plane
  state()
  find()

reactive read plane
  liveFind()
```

A durable item handle is writable only while its durable id remains a member of the current loaded state generation. Close/reopen preserves data, not JavaScript proxy identity.

### Application evolution

Compatible JSON-style evolution has now been exercised in two small scenarios. Neither experiment establishes incompatible schema evolution semantics, arbitrary root-state semantics, or general workload performance.

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

### Agent-specific memory / orchestration

Conversation summarization, agent identity, prompt storage, autonomous checkpoint policy, and multi-agent conflict resolution remain separate architecture layers.

## Release posture

`0.1.0-alpha.0` remains a public alpha candidate only when deterministic scenarios/experiments in `release:check` pass and public documentation matches implementation. Passing these checks does not imply production readiness or end the refinement loop.
