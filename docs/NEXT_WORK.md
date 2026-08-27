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

Status: scenario implemented; CI validation pending.

The first issue-tracker evaluation now exercises three iterations against one durable database:

1. create a minimal `IssueV1` model;
2. reopen as `IssueV2` and add optional priority, labels, and comments;
3. reopen again and verify evolved nested state and durable mutation.

The scenario also deliberately tests a current semantic boundary:

```text
state proxy mutation -> durable
find() result mutation -> detached snapshot only
```

The PR that first records this result must not change `find()` behavior. If the scenario confirms the boundary is surprising, create a separate product/API decision issue.

Run:

```bash
npm run scenario:issue-tracker
```

See [Issue tracker evaluation](./ISSUE_TRACKER_EVALUATION.md).

### 2. Durable variable / session bootstrap experiment — #26

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

The session-bootstrap experiment distinguishes four scopes:

```text
local value
session/process value
durable state
discoverable durable state
```

Current working boundary after the first PASS:

- StorekeeperDB core owns durable local state;
- a bootstrap manifest can provide discoverability above the core for at least one cross-process scenario;
- checkpoint policy, agent memory, summarization, trust, context selection, and multi-agent coordination remain outside the core;
- a first-class workspace/bootstrap API is not justified yet.

The next useful falsification attempt is to apply the same convention in a second scenario and see whether the manifest shape remains stable or starts accumulating scenario-specific policy.

## API question expected from #24

If CI confirms the issue-tracker observation, separate the following question from the scenario PR:

> Should `find()` remain a detached snapshot API, become explicitly read-only/snapshot-named, or return durable state handles?

Do not infer the answer solely from implementation convenience. Evaluate least-surprise semantics, identity/lifecycle complexity, live query behavior, and API surface size.

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
- deterministic realistic scenarios and architecture experiments included in the release gate pass;
- `npm run release:check` passes on a clean checkout;
- alpha release decision notes are accepted by a maintainer.

Passing this checklist does not end the refinement loop and does not imply production readiness.
