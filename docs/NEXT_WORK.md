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

### 1. Realistic application scenario — #24

Status: next application-facing evaluation.

Build one small issue-tracker scenario that exercises StorekeeperDB as an application developer would, rather than as an implementation demo.

The scenario should include:

- state creation and ordinary mutation;
- nested data;
- `find()` or `liveFind()` where a scalar lookup is genuinely useful;
- reopen / persistence verification;
- at least one application-shape change or unsupported-operation boundary;
- public package entrypoints only;
- no internal imports or scenario-specific persistence workaround.

Record all friction before changing the runtime.

### 2. Durable variable / session bootstrap experiment — #26

Status: experiment in progress.

Evaluate whether StorekeeperDB can be treated as a durable-variable layer across process/session boundaries without adding agent-specific APIs to the core.

Current experiment:

- writer and reader run as separate Node processes;
- writer persists a `__workspace` manifest plus additional durable states;
- reader initially knows only the database path and bootstrap key;
- reader discovers other state keys from the manifest;
- release checks run the deterministic experiment;
- architecture documentation separates durability, discoverability, and agent/application policy.

Do not infer from a passing experiment that StorekeeperDB should become an agent-memory or orchestration framework. The immediate question is narrower: whether durable state plus a bootstrap convention is sufficient for cross-session recovery.

### 3. Convert findings into small PRs

Status: follows scenario evidence.

For each observed rough edge:

1. classify the finding;
2. decide whether the smallest fix belongs in runtime, public API, tests, docs, or an application-level convention;
3. prefer simplification over API growth;
4. add regression coverage when behavior changes;
5. run the scenario again;
6. run `npm run release:check` before merge.

One PR should normally address one observed problem or one tightly related group.

### 4. Evaluate change amplification

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

## Architecture questions opened by #26

The session-bootstrap experiment should help distinguish four scopes:

```text
local value
session/process value
durable state
discoverable durable state
```

Current working boundary:

- StorekeeperDB core owns durable local state;
- a bootstrap manifest may provide discoverability above the core;
- checkpoint policy, agent memory, summarization, trust, context selection, and multi-agent coordination remain outside the core unless later evidence requires otherwise.

Do not reserve `__workspace` or add a workspace API until the convention has been exercised in more than one scenario.

## Recently completed baseline

The current main branch already includes:

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
- alpha evaluation-loop and documentation organization.

This baseline is sufficient to stop treating missing infrastructure as the default reason to add more infrastructure.

## Deferred research

These remain valid research topics, but they are not the next product priority unless a realistic scenario demonstrates that they block the core value proposition.

### Time-based lifecycle decay — #16

- optional time-based cold marking;
- explicit periodic derived GC semantics;
- no hidden background work.

### Richer metadata scoring policy — #17

- usefulness scoring for observation metadata;
- explicit deletion boundaries;
- source state remains outside metadata scoring deletion.

### Full browser adapter

The current experimental async write-behind runtime defines a durability boundary; it is not a complete browser adapter. Browser implementation work should wait until the required semantics are justified by a realistic browser scenario.

### Agent-specific memory / orchestration

Do not add conversation summarization, agent identity, prompt storage, autonomous checkpoint policy, or multi-agent conflict resolution to the core based only on the durable-variable experiment. Those are separate architecture layers.

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
- deterministic architecture experiments included in the release gate pass;
- `npm run release:check` passes on a clean checkout;
- alpha release decision notes are accepted by a maintainer.

Passing this checklist does not end the refinement loop and does not imply production readiness.
