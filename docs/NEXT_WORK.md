# Next work

This document tracks current StorekeeperDB priorities. Historical implementation details belong in the changelog, merged pull requests, and subsystem notes; this file should answer one question: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The current goal is not promotion and not feature-count growth. The goal is to use realistic application and process-lifecycle scenarios to expose API friction, surprising behavior, unclear failure modes, documentation gaps, persistence-specific change amplification, and reproducible performance roughness.

See [Alpha evaluation loop](./EVALUATION_LOOP.md) and [Architecture](./ARCHITECTURE.md).

## Active priorities

### 1. Replicate persistence-specific change amplification

Status: **first experiment CANDIDATE PASS; generalization not established.**

CI #116 compared the same Issue V1 -> V2 compatible evolution using:

1. minimal relational `node:sqlite`;
2. minimal JSON-blob `node:sqlite`;
3. StorekeeperDB.

Observed persistence-specific changed lines:

```text
relational SQLite  20
JSON-blob SQLite   14
StorekeeperDB       8
```

Against the strongest JSON-blob baseline, the annotated persistence-specific edit surface decreased from 14 to 8 changed lines (~42.9%). Raw all-source changed lines decreased from 40 to 34 (15%).

However, V2 persistence-concept count was 4 vs 4 for JSON-blob and StorekeeperDB. JSON-blob introduced no new persistence concept in V2, while StorekeeperDB introduced `durable-query`.

Therefore the current evidence supports only the narrower claim:

> StorekeeperDB reduced explicit persistence edit surface for this compatible prototype evolution; it did not demonstrate a lower persistence-concept count than a deliberately minimal JSON-blob design.

See [Change amplification experiment](./CHANGE_AMPLIFICATION_EXPERIMENT.md).

Next evidence required: repeat the same measurement method on a structurally different application, preferably small CLI/project metadata state. Do not generalize the percentage from one scenario.

### 2. Evaluate incompatible model evolution

Status: planned after one replication of the compatible-change result.

Test a deliberately incompatible change such as:

- field rename;
- scalar -> structured object;
- enum narrowing;
- required-field introduction.

The objective is to locate the boundary where persistence can no longer remain implicit and explicit migration/validation must re-enter the application architecture.

Do not optimize for “migration-free.” A clean, observable explicit boundary is preferable to unsafe magic.

### 3. Reuse durable-session bootstrap in a second scenario — #26

Status: initial cross-process experiment PASS; generalization remains uncertain.

Current evidence shows that a writer and reader in separate Node processes can use one known bootstrap key to discover other durable states. This proves one convention, not a general workspace/agent-memory API.

Next evidence required: reuse the same bootstrap convention in a second realistic scenario without modifying StorekeeperDB core specifically for it.

Do not reserve `__workspace` or add a workspace API yet.

## Recently resolved product/API decisions

### `find()` durable-handle semantics — #29

Status: implemented in PR #35; final release gate passed in CI #113.

```text
state() item             -> durable handle
find() result item       -> durable handle
find() result array      -> ordinary local array
liveFind() result values -> detached stable snapshots
```

### Removed-handle invalidation — #31

Status: PASS, fixed by PR #33; full release gate passed in CI #98.

```text
active member    -> readable + writable
reordered member -> writable
rollback         -> stale
removed member   -> readable detached reference, writes fail
```

### Reactive snapshot separation — #32

Status: PASS, fixed by PR #34; full release gate passed in CI #101.

`liveFind()` owns detached snapshot cloning independently of `find()`.

### Realistic application scenario — #24

Status: PASS.

Compatible optional JSON-field evolution works in the tested issue tracker without a repository layer, direct SQL, or manual table migration. This does not establish incompatible migration semantics.

### First change-amplification experiment — #36

Status: CANDIDATE PASS in CI #116.

The result is evidence for reduced explicit persistence edit surface in one compatible evolution scenario, not a general benchmark or proof of lower conceptual complexity.

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

Compatible optional JSON-field additions work in the tested issue-tracker scenario. The first comparison experiment suggests lower explicit persistence edit amplification, including against a JSON-blob direct-SQL baseline. Neither result establishes incompatible schema evolution semantics.

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
