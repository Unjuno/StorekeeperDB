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

### 1. Decide `find()` snapshot vs durable-handle semantics — #29

Status: next product/API decision after #24.

The realistic issue-tracker scenario passed its compatible shape-evolution hypothesis, but confirmed a least-surprise problem:

```text
state proxy mutation -> durable
find() result mutation -> detached snapshot only
```

The next PR must not simply make query results mutable. First compare three designs:

1. keep `find()` as a snapshot API and make that contract explicit/read-only;
2. rename or supplement the query surface with explicit snapshot semantics;
3. return durable handles and accept the resulting identity, lifecycle, live-query, rollback, and cache complexity.

Prefer the smallest semantic surface that preserves StorekeeperDB's durable-variable mental model.

### 2. Realistic application scenario — #24

Status: PASS; merge/closure pending for the evaluation PR.

Validated by CI #87 scenario output, CI #89 full release gate, and CI #91 after final result documentation:

- two `IssueV1` rows survived close/reopen;
- reopening as `IssueV2` required no repository layer, direct SQL, or manual table migration for optional JSON fields;
- nested `priority`, `labels`, and `comments` persisted after another reopen;
- scalar lookup created the expected projection;
- mutation through the state proxy persisted;
- mutation through a `find()` result was confirmed to be detached.

See [Issue tracker evaluation](./ISSUE_TRACKER_EVALUATION.md).

### 3. Durable variable / session bootstrap experiment — #26

Status: initial cross-process experiment PASS; generalization remains uncertain.

Validated by CI #83 and final CI #85 through `npm run release:check`:

- writer and reader run as separate Node processes;
- writer persists a `__workspace` manifest plus additional durable states;
- nested checkpoint mutation survives the writer process exit;
- reader initially knows only the database path and bootstrap key;
- reader discovers other state keys from the manifest;
- scenario uses the public `@storekeeper/db` package entrypoint;
- architecture documentation separates durability, discoverability, and agent/application policy.

The immediate hypothesis passed for one controlled scenario: durable state plus a bootstrap convention is sufficient for cross-process recovery.

Do not infer that StorekeeperDB should become an agent-memory or orchestration framework. Do not reserve `__workspace` or add a workspace API after one passing scenario.

Next evidence required: reuse the same bootstrap convention in at least one additional scenario without modifying the core specifically for that scenario.

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

## Confirmed architecture boundaries

### Variable lifetime

The durable-session experiment distinguishes four scopes:

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

The issue-tracker scenario establishes a narrower application result:

- compatible optional JSON-field additions can evolve through ordinary durable proxy mutation without a separate migration layer in this scenario;
- this does not establish incompatible schema evolution semantics;
- `find()` is currently a snapshot boundary and must be treated as an explicit product decision rather than an implementation detail.

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
- alpha evaluation-loop and documentation organization;
- initial durable-session architecture experiment.

After the #24 evaluation PR merges, the issue-tracker scenario becomes part of this baseline as well.

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
- deterministic realistic scenarios and architecture experiments included in the release gate pass;
- `npm run release:check` passes on a clean checkout;
- alpha release decision notes are accepted by a maintainer.

Passing this checklist does not end the refinement loop and does not imply production readiness.
