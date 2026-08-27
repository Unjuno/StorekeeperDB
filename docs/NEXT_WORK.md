# Next work

This document tracks current StorekeeperDB priorities. Historical implementation details belong in the changelog, merged pull requests, and subsystem notes; this file should answer one question: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The current goal is not promotion and not feature-count growth. The goal is to use realistic application and process-lifecycle scenarios to expose API friction, surprising behavior, unclear failure modes, documentation gaps, persistence-specific change amplification, and reproducible performance roughness.

See [Alpha evaluation loop](./EVALUATION_LOOP.md) and [Architecture](./ARCHITECTURE.md).

## Active priorities

### 1. Measure persistence-specific change amplification

Status: **next experiment**.

The core product hypothesis is stronger than “CRUD works.” StorekeeperDB is intended to reduce the amount of persistence-specific work required while an application model is changing quickly.

The next experiment should implement the same small application change twice:

1. minimal plain SQLite baseline;
2. StorekeeperDB using only public APIs.

Do not intentionally overengineer the SQLite baseline.

Recommended first specification change:

```text
Issue V1
- id
- title
- status

        ↓ evolve

Issue V2
- id
- title
- status
- priority
- labels[]
- comments[]
```

Record:

- files touched;
- persistence-specific lines added/changed;
- schema/migration code;
- repository/query mapping code;
- serialization/deserialization code;
- undocumented workarounds;
- runtime failures;
- implementation notes showing hidden persistence complexity;
- elapsed implementation time only if measured under the same controlled procedure.

The important metric is **change amplification**, not total line count.

Working hypothesis:

> For compatible prototype model evolution, StorekeeperDB requires fewer persistence-specific edits and fewer persistence-specific concepts than a minimal direct-SQL baseline.

FAIL if StorekeeperDB-specific lifecycle/query workarounds grow enough to erase that advantage.

### 2. Reuse durable-session bootstrap in a second scenario — #26

Status: initial cross-process experiment PASS; generalization remains uncertain.

Current evidence shows that a writer and reader in separate Node processes can use one known bootstrap key to discover other durable states. This proves one convention, not a general workspace/agent-memory API.

Next evidence required: reuse the same bootstrap convention in a second realistic scenario without modifying StorekeeperDB core specifically for it.

Do not reserve `__workspace` or add a workspace API yet.

### 3. Evaluate incompatible model evolution

Status: planned after compatible change-amplification baseline.

The issue-tracker scenario only establishes compatible optional JSON-field additions. A later scenario should test one deliberately incompatible change, such as:

- field rename;
- scalar -> structured object;
- enum narrowing;
- required-field introduction.

The goal is not to promise migration-free persistence. The goal is to identify where the “magic” must stop and an explicit migration/validation boundary must begin.

## Recently resolved product/API decisions

### `find()` durable-handle semantics — #29

Status: implemented in PR #35 after focused experiments and blocker hardening.

Selected contract:

```text
state() item             -> durable handle
find() result item       -> durable handle
find() result array      -> ordinary local array
liveFind() result values -> detached stable snapshots
```

The decision was not made by naming preference alone. PR #30 demonstrated that durable handles were viable but exposed two concrete blockers.

### Removed-handle invalidation — #31

Status: PASS, fixed by PR #33; full release gate passed in CI #98.

```text
active member    -> readable + writable
reordered member -> writable
rollback         -> stale
removed member   -> readable detached reference, writes fail
```

The runtime uses existing item ids + state membership + generation rather than a new public identity subsystem.

### Reactive snapshot separation — #32

Status: PASS, fixed by PR #34; full release gate passed in CI #101.

`liveFind()` owns detached snapshot cloning independently of `find()`. This prevents mutable proxy aliasing from changing old snapshots and suppressing reactive notifications.

### Realistic application scenario — #24

Status: PASS.

The issue-tracker scenario established compatible optional-field evolution without a repository layer, direct SQL, or manual table migration in that scenario. It also generated the `find()` semantics finding that led to #29.

## Confirmed architecture boundaries

### Variable lifetime

```text
local value
session/process value
durable state
discoverable durable state
```

Current boundary:

- StorekeeperDB core owns durable local state;
- a bootstrap convention can provide discoverability above the core in tested cross-process cases;
- checkpoint policy, agent memory, summarization, trust, context selection, and multi-agent coordination remain outside the core.

### Query / command / read boundary

```text
command-capable durable plane
  state()
  find()

reactive read plane
  liveFind()
```

A durable item handle is writable only while its item id remains a member of the current loaded state generation.

Close/reopen preserves data, not JavaScript proxy identity.

### Application evolution

Compatible optional JSON-field additions work in the tested issue-tracker scenario. This does not establish incompatible schema evolution semantics.

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

The experimental async write-behind runtime defines a durability boundary; it is not a complete browser adapter. Browser work should wait until a realistic browser scenario demonstrates the required semantics.

### Agent-specific memory / orchestration

Conversation summarization, agent identity, prompt storage, autonomous checkpoint policy, and multi-agent conflict resolution remain separate architecture layers.

## Publication follow-up

Publishing is not the current optimization target. If `0.1.0-alpha.0` is published later:

- verify registry-installed package behavior from a clean consumer project;
- confirm release notes match the published tarball;
- collect concrete user-facing friction;
- feed those observations back into the evaluation loop.

## Release posture

`0.1.0-alpha.0` can be treated as a public alpha candidate only when:

- CI passes consistently;
- README matches actual public implementation;
- browser gaps are explicit;
- transaction behavior is stable enough or explicitly scoped as alpha behavior;
- deterministic realistic scenarios and architecture experiments in `release:check` pass;
- `npm run release:check` passes on a clean checkout;
- alpha release decision notes remain accurate.

Passing this checklist does not imply production readiness and does not end the refinement loop.
