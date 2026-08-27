# Next work

This document tracks current StorekeeperDB priorities. Historical implementation details belong in the changelog, merged pull requests, and subsystem notes; this file should answer one question: **what should be evaluated or changed next?**

## Current phase

StorekeeperDB is a public alpha candidate in a product refinement / alpha hardening loop.

The current goal is not promotion and not feature-count growth. The goal is to use realistic application and process-lifecycle scenarios to expose:

- API friction;
- surprising behavior;
- unclear failure modes;
- documentation gaps;
- test gaps;
- persistence-specific change amplification;
- session / process lifetime boundaries;
- reproducible performance roughness.

See [Alpha evaluation loop](./EVALUATION_LOOP.md) and [Architecture](./ARCHITECTURE.md).

## Active priorities

### 1. Invalidate removed durable item handles — #31

Status: next runtime hardening, discovered by #29 experiment.

CI #94 confirmed that a proxy captured from `state()` can currently be removed and then mutated again, which re-creates the deleted SQLite row. This is a lifecycle defect independently of `find()`.

Required contract:

```text
active member    -> writable
reordered member -> writable
rollback         -> stale
removed member   -> stale
```

Prefer strengthening the existing generation/membership check over adding a new handle registry.

### 2. Complete `find()` durable-handle semantics — #29

Status: architecture direction conditionally selected; blocked by #31 and reactive snapshot separation.

The focused semantics experiment compared three directions:

1. keep detached `find()` snapshots and strengthen readonly/documentation semantics;
2. add/rename an explicit snapshot query surface;
3. return durable handles from `find()`.

CI #94 supports the hybrid C direction:

```text
state() / find() -> local arrays containing durable item handles
liveFind()       -> stable cloned/read snapshots
```

Positive evidence:

- query-to-update through existing state handles persists naturally;
- result-array mutation can remain local;
- handle identity survives reorder;
- rollback already invalidates captured handles;
- no new identity registry was required by the experiment.

Confirmed blockers:

- naive reactive selectors over durable handles alias previous snapshots and can suppress notifications;
- removed handles can currently resurrect deleted rows.

See [`find()` semantics evaluation](./FIND_SEMANTICS_EVALUATION.md).

Do not add a second public snapshot query method yet. After #31, preserve independent clone semantics inside `liveFind()`, then change `find()` and re-run the realistic scenario.

### 3. Realistic application scenario — #24

Status: PASS and merged.

The issue-tracker evaluation established that compatible optional JSON-field evolution works in the tested scenario without a repository layer, direct SQL, or manual table migration. It also produced the `find()` semantics finding now tracked by #29.

See [Issue tracker evaluation](./ISSUE_TRACKER_EVALUATION.md).

### 4. Durable variable / session bootstrap experiment — #26

Status: initial cross-process experiment PASS; generalization remains uncertain.

Validated by CI #83 and final CI #85 through `npm run release:check`:

- writer and reader run as separate Node processes;
- writer persists a `__workspace` manifest plus additional durable states;
- nested checkpoint mutation survives the writer process exit;
- reader initially knows only the database path and bootstrap key;
- reader discovers other state keys from the manifest;
- scenario uses the public `@storekeeper/db` package entrypoint;
- architecture documentation separates durability, discoverability, and agent/application policy.

Do not reserve `__workspace` or add a workspace API after one passing scenario. Reuse the convention in another realistic scenario before generalizing it.

### 5. Evaluate change amplification

Status: planned.

The core product hypothesis is that StorekeeperDB reduces persistence-specific work while application models are changing quickly.

For selected scenario changes, record:

- files touched;
- persistence-specific code added or changed;
- migration or repository boilerplate required;
- undocumented workarounds;
- runtime failures;
- implementation notes that reveal hidden persistence complexity.

The purpose is not to manufacture a favorable line-count comparison. The purpose is to detect whether StorekeeperDB actually moves persistence concerns out of the early prototype loop or merely hides them until failure.

## Confirmed architecture boundaries

### Variable lifetime

```text
local value
session/process value
durable state
discoverable durable state
```

Current working boundary:

- StorekeeperDB core owns durable local state;
- a bootstrap manifest can provide discoverability above the core for at least one cross-process scenario;
- checkpoint policy, agent memory, summarization, trust, context selection, and multi-agent coordination remain outside the core;
- a first-class workspace/bootstrap API is not justified yet.

### Application evolution

- compatible optional JSON-field additions can evolve through ordinary durable proxy mutation without a separate migration layer in the issue-tracker scenario;
- this does not establish incompatible schema evolution semantics.

### Query/read boundary

The current refinement direction separates command-capable durable handles from reactive read snapshots:

```text
state() / find()   -> durable handles (find is target, not implemented yet)
liveFind()         -> stable derived snapshots
```

The key invariant is that a durable handle is valid only while its item remains a member of the current loaded state generation.

## Recently completed baseline

The current main branch includes:

- runtime rollback and projection hardening;
- release hygiene and package export checks;
- executable demo;
- React `useSyncExternalStore` verification;
- experimental async write-behind boundary model;
- derived projection lifecycle GC and opt-in lookup-count-based decay;
- metadata compaction;
- public manual and observational benchmark;
- alpha release decision notes;
- prepublish wording inspection;
- clean consumer tarball install simulation;
- slimmed release-check fixtures while preserving semantic coverage;
- alpha evaluation-loop and documentation organization;
- initial durable-session architecture experiment;
- realistic issue-tracker application-evolution scenario.

## Deferred research

### Time-based lifecycle decay — #16

- optional time-based cold marking;
- explicit periodic derived GC semantics;
- no hidden background work.

### Richer metadata scoring policy — #17

- usefulness scoring for observation metadata;
- explicit deletion boundaries;
- source state remains outside metadata scoring deletion.

### Full browser adapter

The current experimental async write-behind runtime defines a durability boundary; it is not a complete browser adapter. Browser implementation work should wait until required semantics are justified by a realistic browser scenario.

### Agent-specific memory / orchestration

Conversation summarization, agent identity, prompt storage, autonomous checkpoint policy, and multi-agent conflict resolution remain separate architecture layers.

## Publication follow-up

Publishing is not the current optimization target. If `0.1.0-alpha.0` is published later:

- verify registry-installed package behavior from a clean consumer project;
- confirm GitHub release notes match the published tarball;
- collect concrete user-facing friction;
- feed those observations back into the same evaluation loop.

## Release posture

`0.1.0-alpha.0` can be treated as a public alpha candidate only when:

- CI passes consistently;
- README matches actual public implementation;
- browser gaps are clearly documented;
- transaction behavior is either stable or explicitly scoped as alpha behavior;
- deterministic realistic scenarios and architecture experiments included in the release gate pass;
- `npm run release:check` passes on a clean checkout;
- alpha release decision notes are accepted by a maintainer.

Passing this checklist does not end the refinement loop and does not imply production readiness.
