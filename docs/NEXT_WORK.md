# Next work

This document tracks current StorekeeperDB priorities. Historical implementation details belong in the changelog, merged pull requests, and subsystem notes; this file should answer one question: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The current goal is not promotion and not feature-count growth. The goal is to use realistic scenarios to expose API friction, failure modes, persistence-specific change amplification, and architecture boundaries before expanding the public surface.

See [Alpha evaluation loop](./EVALUATION_LOOP.md) and [Architecture](./ARCHITECTURE.md).

## Active priorities

### 1. Evaluate the smallest singleton/object public surface

Status: **candidate B revalidated after #42 in CI #136.**

Two compatible-evolution experiments established a recurring pattern:

- StorekeeperDB reduced explicit persistence edit surface;
- lower persistence-concept count did not consistently follow;
- the single-record CLI workload exposed `singleton-list-boundary` as a concrete extra concept.

Root-state experiment #40 compared:

```text
A  current list-only state
B  narrow singleton/object helper over existing state()/signal()
C  arbitrary-root / explicit cell direction
```

After replacement-handle hardening #42, CI #136 observed:

```text
A  replacement old handle rejected; memory/durable divergence gone
B  nested mutation PASS; rollback stale rejection PASS; signal mapping PASS
C  scalar still requires explicit `.value`; nested lifetime after cell replacement remains ambiguous
```

Decision remains:

```text
PREFER_NARROW_SINGLETON_OBJECT_PROTOTYPE
```

The next experiment should therefore evaluate the **smallest permanent public surface** for one durable object, not widen `state()` to arbitrary JSON roots.

Required comparison:

1. document the existing one-item-list convention only;
2. public `objectState()`-style method/helper returning the durable object directly;
3. a combined object handle that also exposes reactive subscription without a second method.

Measure:

- callsite ceremony;
- new public names/concepts;
- implementation LOC/surface;
- nested mutation and reopen behavior;
- rollback/replacement stale semantics;
- TypeScript inference;
- signal/reactive ergonomics;
- whether the abstraction remains explainable as one durable item under the hood.

Do not include primitive roots or implicit whole-object replacement in this decision.

### 2. Evaluate incompatible model evolution

Status: planned after object/singleton surface decision.

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

## Recently resolved hardening

### Direct replacement handle invalidation — #42

Status: **PASS in CI #136; pending merge of PR #43.**

The root-state experiment originally found that a displaced old proxy could keep writing after `list[index] = replacement` because the replacement reused the durable id.

The write invariant is now:

```text
active current proxy                    writable
reordered current proxy                 writable
removed proxy                           write rejected
rollback old-generation proxy           rejected
replaced old proxy with reused id       rejected
new replacement proxy                   writable
```

Implementation uses current generation + durable-id membership + exact current proxy identity. No public identity registry was added.

A regression test covers both displaced item and nested handles. The root-state experiment was corrected so its validity no longer depended on the former stale-overwrite behavior and revalidated candidate B.

## Current experimental evidence

### Persistence-specific change amplification — #36

Status: CANDIDATE PASS in CI #116 / final gate CI #120.

Against the strongest JSON-blob baseline, persistence-specific changed lines were 14 -> 8 (~42.9% lower) and raw all-source changed lines were 40 -> 34. Concept count was equal at 4 vs 4.

### CLI metadata replication — #38

Status: MIXED in CI #122 / final gate CI #126.

Against JSON-blob SQLite, persistence-specific changed lines were 12 -> 8 (~33.3% lower) and raw all-source changed lines were 35 -> 30. StorekeeperDB concept count was worse at 5 vs 4 because the one-record workload exposed `singleton-list-boundary`.

### Root-state semantics — #40

Status: candidate B in CI #128, revalidated after #42 in CI #136.

The singleton/object helper works over existing public state/signal behavior. Raw arbitrary primitive `state()` cannot provide mutation-by-reference semantics; an explicit cell/get-set model would be required. Broad arbitrary-root generalization remains unsupported.

Interpretation across the experiments:

> Reduced explicit persistence edit surface has directionally consistent evidence in two compatible JSON-style scenarios. Lower conceptual complexity does not. The strongest next simplification target is the observed singleton-object ceremony, not generic root values.

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

Durable item writability requires current loaded generation, current durable-id membership, and exact current proxy identity. Close/reopen preserves data, not JavaScript proxy identity.

### Root values

Current public `state()` remains list-of-objects. The experiments do not authorize arbitrary-root support.

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
