# Next work

This document tracks current StorekeeperDB priorities. Historical implementation details belong in the changelog, merged pull requests, and subsystem notes; this file should answer one question: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The product direction is agent-oriented: StorekeeperDB is being evaluated as a **durable programming model for rapid agent-generated TypeScript prototypes**. The target is not merely shorter database code. The target is to remove persistence architecture decisions from the coding agent's normal planning path wherever doing so remains safe and explainable.

Working rule:

> **Persistence should normally not enter the coding agent's planning loop. Hard persistence problems must remain observable and controllable.**

See [Alpha evaluation loop](./EVALUATION_LOOP.md), [Architecture](./ARCHITECTURE.md), [Agent decision-burden experiment](./AGENT_DECISION_BURDEN_EXPERIMENT.md), [Agent project convention experiment](./AGENT_PROJECT_CONVENTION_EXPERIMENT.md), and [Declaration key rename experiment](./DECLARATION_KEY_RENAME_EXPERIMENT.md).

## Active priorities

### 1. Stress rename identity with a queried collection and projections

Status: **highest priority after declaration-key rename candidate PASS in CI #168.**

Issue #50 confirmed that naive property rename is unsafe and that an experiment-only one-shot rename alias can preserve logical state through a durable identity manifest:

```text
compatible path -> 0 extra key decisions
rename boundary -> 1 explicit rename-alias decision
later reopen    -> alias omitted; manifest retains binding
```

However, the successful candidate deliberately retains the old physical StorekeeperDB key. The singleton scenario therefore did not exercise projection/derived metadata relocation.

Next experiment should use a collection state that has already created projections through `find()` before rename, for example:

```text
issues -> tickets
```

Verify:

1. source items remain durable;
2. query behavior remains correct after logical rename;
3. existing projection rows remain usable because physical identity is stable;
4. no duplicate logical or physical source state appears;
5. mutation through post-rename `find()` handles remains durable;
6. debug/explain output remains interpretable;
7. collection rename does not force a physical-key migration merely for cosmetic naming.

If retaining the old physical key preserves all derived machinery cleanly, that strengthens logical/physical identity separation. If the system needs to rewrite `__sk_projection`, `__sk_paths`, derivations, or other metadata, the alias convention is less isolated than the singleton experiment suggests.

### 2. Test a multi-step rename chain

Status: planned.

Exercise:

```text
settings -> preferences -> configuration
```

with one explicit alias at each incompatible rename boundary and no alias on ordinary subsequent reopens.

Required properties:

- one durable logical state throughout;
- no alias chain ambiguity;
- no duplicate physical state;
- no requirement to remember every historic name at the application callsite;
- manifest history remains bounded or has an explicit compaction model;
- failed/ambiguous aliases fail loudly rather than guess.

This test should answer whether the logical-to-physical binding is a durable identity mechanism or merely a one-rename workaround.

### 3. Evaluate incompatible value evolution beyond key rename

Status: planned after collection/rename-chain verification.

Test deliberately incompatible value changes such as:

- scalar -> structured object;
- enum narrowing;
- required-field introduction;
- declared state split/merge;
- deletion of a declared state.

The objective is to define exactly where persistence must re-enter the coding agent's planning loop.

A clean explicit boundary is preferable to unsafe “migration-free” magic.

### 4. Replicate the project convention in a third topology

Status: **candidate direction, not public API.**

PR #49, merged as `881782341562ce070e65a300beb51a90784434a8`, reused the same generic helper unchanged across:

- task collection + singleton project settings;
- revision collection + singleton document metadata.

Final synchronized release gate: CI #165 PASS.

Measured per-prototype decisions:

```text
                     current StorekeeperDB   convention
project board                  7                 5
editor/workspace               7                 5
```

Reusable framework cost was reported separately:

```text
agent-facing concepts   2
internal mechanisms     4
```

Before exporting any project-store surface, test a third topology such as agent workspace/checkpoints or a multi-list workflow. The exact `openProjectStore/list/object` names remain experiment placeholders only.

### 5. Reuse durable-session bootstrap with the project convention

Status: initial cross-process bootstrap PASS; integration unproven.

The existing `__workspace` bootstrap experiment shows that one known key can discover additional durable states across processes. A project declaration plus identity manifest already contains a state namespace, so test whether bootstrap/discovery can reuse that information without creating a second competing registry.

Do not add a general workspace/agent-memory API until reuse is demonstrated.

## Current experimental evidence

### Declaration property rename / durable identity — #50

Status: **CANDIDATE PASS in CI #168; experiment-only.**

Four candidates were tested after persisting non-default `settings` state and then renaming the declaration property to `preferences`.

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

Corrected decision comparison after a marker-classification audit:

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

Interpretation:

> Routine compatible work can remain free of explicit durable-key bookkeeping, while an actual durable-identity rename requires one explicit alias decision.

Important limitations:

- the identity manifest is registry-like and must remain narrow;
- candidate C keeps the old physical StorekeeperDB key;
- collection/projection rename has not yet been exercised;
- repeated rename chains have not yet been exercised;
- no public API decision has been made.

### Agent-facing durable project convention — #48

Status: **CANDIDATE PASS; merged PR #49 / final synchronized CI #165.**

The same generic helper was reused unchanged in two scenarios. Both runtime paths preserved reopen durability, compatible evolution, singleton state, and queries.

```text
project board      7 -> 5 decisions; 14 -> 8 persistence lines
editor/workspace   7 -> 5 decisions; 14 -> 8 persistence lines
```

The convention introduced two reusable agent-facing concepts:

```text
project-store
shape-descriptor
```

and four reported internal mechanisms:

```text
derived-state-keys
runtime-ownership
singleton-adaptation
state-reference-query
```

Interpretation:

> A project-level declaration can absorb repeated state-key and singleton-storage decisions across multiple prototypes. This supports the architecture direction, not the exact API.

Issue #50 refined the earlier limitation: property-derived names can remain the default compatible-path identity only if incompatible rename becomes explicit rather than silently creating fresh state.

### Agent persistence decision burden — #46

Status: **CANDIDATE PASS in CI #147 / final synchronized gate CI #153.**

Against both direct-SQL baselines, StorekeeperDB used fewer persistence-specific decision categories in the project-board scenario: 7 vs 8, while also using 14 persistence-marked lines vs the strongest baseline's 19.

This is an auditable implementation proxy, not a measurement of private reasoning tokens. The taxonomy was deliberately corrected from an initial 6 to 7 Storekeeper decisions by adding `compatible-state-evolution`.

### Singleton-object public surface — #44

Status: **NO CLEAR WINNER in CI #144; no public API change.**

```text
A current list-only          11 surface lines / 483 chars / 0 new names
B objectState/objectSignal   10 surface lines / 496 chars / 2 new names
C objectHandle               10 surface lines / 418 chars / 1 new name + .value ceremony
```

This result is why singleton adaptation is currently tested as reusable project convention machinery rather than a standalone core API.

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
agent-facing project convention
   ↓
StorekeeperDB durable runtime
   ↓
SQLite
```

StorekeeperDB core should own durable local state and derived persistence machinery. Project/bootstrap conventions may reduce repetitive per-prototype decisions above core. Conversation summarization, prompt policy, trust, agent identity, and multi-agent coordination remain separate concerns.

### Logical vs physical durable identity

The current experiment candidate separates declaration naming from physical StorekeeperDB identity:

```text
logical declaration name
  preferences
       |
       v
identity binding
       |
       v
physical StorekeeperDB key
  settings
```

This is an experiment-layer concept only. It is not yet a public core contract.

### Decision amortization

A reusable framework concept is different from a per-prototype persistence decision.

Experiments therefore report:

```text
per-prototype decisions
reusable agent-facing concepts
internal framework mechanisms
```

Do not hide helper implementation cost, but do not count a once-learned convention as if every generated prototype independently redesigned it.

### Variable lifetime

```text
local value
session/process value
durable state
discoverable durable state
```

### Command / read boundary

```text
command-capable durable plane
  state()
  find()

reactive read plane
  liveFind()
```

The experiment project wrapper preserves the core scalar-predicate query restriction; it does not widen `find()` to arbitrary nested predicates.

### Root values

Current public `state()` remains list-of-objects. The experiments do not authorize arbitrary-root support.

The project convention can hide singleton list adaptation above core, but that does not change StorekeeperDB's underlying storage contract.

### Hard persistence boundaries

The agent-first goal does not authorize hiding incompatible migration, durable identity rename, corruption, concurrent writers, transaction failures, or durability uncertainty. When the runtime cannot preserve semantics safely, the persistence problem must become explicit.

Automatic heuristic rename matching based on shape, content, or declaration order is not supported by the current evidence.

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
