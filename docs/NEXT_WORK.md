# Next work

This document tracks current StorekeeperDB priorities. Historical implementation details belong in the changelog, merged pull requests, and subsystem notes; this file should answer one question: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The current goal is not promotion and not feature-count growth. The goal is to use realistic scenarios to expose API friction, failure modes, persistence-specific change amplification, and architecture boundaries before expanding the public surface.

See [Alpha evaluation loop](./EVALUATION_LOOP.md) and [Architecture](./ARCHITECTURE.md).

## Active priorities

### 1. Fix replacement-handle invalidation — #42

Status: **runtime correctness blocker discovered by root-state semantics experiment CI #128.**

The root-state experiment directly replaced one durable list item while keeping its durable row id, then wrote through the displaced old proxy.

Observed:

```text
old handle write after replacement          accepted
loaded memory after old write               replacement object
reopened durable value                      old proxy payload
memory/durable divergence                   yes
```

Current writable-handle validation checks current generation + durable id membership. That is sufficient for removal and reorder, but not direct replacement because the new proxy intentionally reuses the old durable id.

Required invariant:

```text
active current proxy                    writable
reordered current proxy                 writable
removed proxy                           write rejected
rollback old-generation proxy           rejected
replaced old proxy with reused id       rejected
new replacement proxy                   writable
```

Fix this before adding singleton/root APIs. Prefer strengthening existing proxy-identity validation rather than adding a new public identity system.

### 2. Re-run root-state semantics after #42 — #40

Status: **first experiment selects candidate B, but re-verification after #42 is required.**

CI #128 compared:

```text
A  current list-only state
B  narrow singleton/object helper over current public APIs
C  generic root cell / arbitrary-root direction
```

First result:

```text
A  singleton ceremony remains; direct replacement currently unsafe
B  nested mutation PASS; rollback stale rejection PASS; signal mapping PASS
C  scalar cell works only through explicit `.value`; raw primitive mutable-reference state is not coherent
```

Candidate decision:

```text
PREFER_NARROW_SINGLETON_OBJECT_PROTOTYPE
```

Interpretation:

> The measured singleton-list ceremony can be hidden without inventing a second storage/lifetime model. Broad arbitrary-root `state()` generalization is not justified by current evidence.

However, do not open a public singleton API implementation until #42 is fixed and this experiment passes again with the stronger replacement invariant.

See [Root-state semantics evaluation](./ROOT_STATE_SEMANTICS_EVALUATION.md).

### 3. Evaluate a focused singleton/object public surface

Status: **conditional follow-up after #42 + root experiment re-verification.**

If candidate B remains valid, evaluate the smallest public surface for one durable object, for example a dedicated object/singleton abstraction rather than widening `state()` to every JSON root.

Required properties:

- no exposed one-item array ceremony;
- same durable-item nested mutation semantics;
- same rollback/stale-handle rules;
- clear signal/reactive mapping;
- no implied primitive mutable-reference semantics;
- root replacement either explicitly unsupported or separately specified;
- no new storage representation solely for syntax.

Naming/API shape remains undecided.

### 4. Evaluate incompatible model evolution

Status: planned after root/object semantics stabilize.

Test a deliberately incompatible change such as:

- field rename;
- scalar -> structured object;
- enum narrowing;
- required-field introduction.

The objective is to locate where persistence can no longer remain implicit and explicit migration/validation must re-enter the application architecture.

A clean explicit boundary is preferable to unsafe “migration-free” magic.

### 5. Reuse durable-session bootstrap in a second scenario — #26

Status: initial cross-process experiment PASS; generalization remains uncertain.

A writer and reader in separate Node processes can use one known bootstrap key to discover other durable states. This proves one convention, not a general workspace/agent-memory API.

Reuse the convention in a second realistic scenario without modifying StorekeeperDB core specifically for it before considering a first-class workspace/bootstrap API.

## Current experimental evidence

### Persistence-specific change amplification — #36

Status: CANDIDATE PASS in CI #116 / final gate CI #120.

Against the strongest JSON-blob baseline, persistence-specific changed lines were 14 -> 8 (~42.9% lower) and raw all-source changed lines were 40 -> 34. Concept count was equal at 4 vs 4.

### CLI metadata replication — #38

Status: MIXED in CI #122 / final gate CI #126.

Against JSON-blob SQLite, persistence-specific changed lines were 12 -> 8 (~33.3% lower) and raw all-source changed lines were 35 -> 30. StorekeeperDB concept count was worse at 5 vs 4 because the one-record workload exposed `singleton-list-boundary`.

### Root-state semantics — #40

Status: candidate B in CI #128; runtime unchanged.

The singleton/object helper worked over existing public state/signal behavior. Raw arbitrary primitive `state()` cannot provide mutation-by-reference semantics; an explicit cell/get-set model would be required. The same experiment exposed #42.

Interpretation across the three experiments:

> Reduced explicit persistence edit surface now has directionally consistent evidence in two compatible JSON-style scenarios. Lower conceptual complexity does not. A narrow object abstraction is more strongly supported than broad arbitrary-root generalization, but runtime identity correctness takes priority.

Do not convert measured percentages or candidate API results into general product guarantees.

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

The intended writable-item rule now needs one refinement from #42: durable id membership alone is insufficient when direct replacement reuses the id; the displaced proxy must become stale.

Close/reopen preserves data, not JavaScript proxy identity.

### Root values

Current public `state()` remains list-of-objects. The experiment does not authorize arbitrary-root support.

A JavaScript primitive cannot act as a mutable persistent reference. Any future scalar-root API must use explicit cell/get-set/replacement semantics rather than pretending otherwise.

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

The C prototype showed that explicit `cell.value` semantics can persist primitives, but no realistic scenario yet shows that this additional abstraction belongs in core. Keep it separate from singleton/object work.

### Agent-specific memory / orchestration

Conversation summarization, agent identity, prompt storage, autonomous checkpoint policy, and multi-agent conflict resolution remain separate architecture layers.

## Release posture

`0.1.0-alpha.0` remains a public alpha candidate only when deterministic scenarios/experiments in `release:check` pass and public documentation matches implementation. Passing these checks does not imply production readiness or end the refinement loop.
