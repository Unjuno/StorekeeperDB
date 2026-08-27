# `find()` semantics evaluation

Status: **PASS — hybrid durable-handle design selected and implemented.**

Issue: #29. Evaluation PR: #30. Lifecycle hardening: #33 / #31. Reactive snapshot hardening: #34 / #32. Final implementation: #35.

## Goal

Choose the least-surprising query-result contract without adding unnecessary API surface or hidden identity/lifecycle machinery.

The original realistic issue-tracker scenario exposed this mismatch:

```text
state() item mutation -> durable
find() item mutation  -> detached clone
```

The evaluation compared three directions.

## Candidate A — keep detached `find()` snapshots

Advantages:

- smallest runtime change;
- naturally compatible with read-only/reactive use.

Costs:

- conflicts with JavaScript reference expectations;
- breaks the durable-variable mental model at the query boundary;
- query-to-update requires a second lookup through `state()`.

Decision: rejected as the default public contract.

## Candidate B — add an explicit snapshot query API

Advantages:

- explicit read semantics.

Costs:

- larger public API;
- still leaves query-to-update indirect;
- no demonstrated one-shot snapshot use case required a second method.

Decision: deferred. Do not add speculative API surface.

## Candidate C — durable item handles from `find()`

Target contract:

```text
find() result array      -> local ordinary array
find() result item       -> durable handle
reorder                  -> handle remains valid
rollback                 -> old handle becomes stale
remove                   -> removed handle cannot write
projection eviction      -> handle remains valid
liveFind()               -> detached stable snapshots
```

Decision: selected after experiment and blocker hardening.

## H — falsifiable hypothesis

StorekeeperDB can make query-to-update natural by returning durable handles from `find()` without a new identity subsystem, provided:

1. removed handles cannot write deleted rows back into persistence; and
2. reactive APIs own detached snapshot semantics independently of `find()`.

## T — experiment sequence

### Experiment 1 — simulate durable query handles

PR #30 used only public APIs and `state().filter(...)` to simulate the proposed `find()` handle model.

CI #94 confirmed:

```text
current detached find() behavior                    CONFIRMED
local result array + durable item handles           PASS
item mutation through durable handle                PASS
result-array mutation remains local                 PASS
handle identity survives reorder                    PASS
rollback invalidates captured handle                PASS
naive reactive handle snapshots alias old values   CONFIRMED BLOCKER
removed handles can resurrect deleted rows          CONFIRMED BLOCKER
```

This falsified the idea that C could be adopted by merely removing `cloneJson` from `find()`.

### Experiment 2 — removed-handle lifetime

Issue #31 / PR #33 strengthened write validity from generation-only to generation + state membership.

CI #98 passed the full `npm run release:check` gate.

Result:

```text
active member    -> writable
reordered member -> writable
rollback         -> stale
removed member   -> readable detached reference, writes fail
nested removed   -> writes fail
```

No new handle registry was required.

### Experiment 3 — reactive snapshot separation

Issue #32 / PR #34 made `liveFind()` explicitly clone its own snapshots instead of inheriting `find()` return semantics.

CI #101 passed the full release gate.

A regression proved that a non-filter content mutation:

- notifies exactly once;
- leaves the old snapshot unchanged;
- creates a new snapshot/version;
- remains compatible with React `useSyncExternalStore` verification.

### Experiment 4 — implement durable `find()`

PR #35 changes `find()` to return a new local array containing the same durable item handles held by loaded state.

The realistic issue-tracker scenario now mutates status directly through a `find()` result and verifies the change after reopen. It also mutates query-result membership and verifies source membership is unchanged.

CI #103 passed `npm run release:check` before documentation synchronization.

## D — decision

PASS criteria:

- query-to-update persists directly through `find()`;
- result-array mutation stays local;
- removed handles cannot resurrect rows;
- rollback handles remain stale;
- reorder identity remains valid;
- `liveFind()` keeps stable previous-value snapshots;
- realistic issue-tracker, React verification, consumer smoke, projection lifecycle, and full release gate remain green.

The runtime/scenario implementation satisfies these criteria in the current Node/SQLite alpha.

## Selected architecture

```text
command-capable durable plane
  state()
  find()

reactive read plane
  liveFind()
```

The important distinction is not “mutable vs immutable array.” It is:

```text
query result array identity -> local
matched item identity       -> durable while member/generation-valid
```

A durable handle is writable when:

```text
current generation
AND
current state membership by durable item id
```

Close/reopen preserves data, not JavaScript proxy identity.

## C — competing explanations / counter-hypotheses

1. Snapshot-only `find()` could have been sufficient if documentation was the only problem. The realistic query-to-update workflow still remained indirect, so this was not selected.
2. Durable handles could have required a broad identity registry. The experiments did not support that for the current runtime; existing ids + membership + generation were sufficient.
3. Mutable query handles could have broken reactive comparison. This counter-hypothesis was confirmed, which is why `liveFind()` remains a separate snapshot plane.
4. Future async/browser backends may not preserve the same cheap identity model. This remains uncertain and must be re-tested before generalizing the contract to a different backend architecture.

## U — uncertainty

The main remaining uncertainty is generalization beyond the current Node/SQLite loaded-state model:

- async/browser storage;
- multi-process writers;
- very large states where loaded proxy identity becomes expensive;
- explicit one-shot snapshot-query demand;
- incompatible schema evolution.

These do not invalidate the current alpha contract; they bound it.

## Product consequence

The experiment supports a stronger durable-variable rule:

> A normal query should not unexpectedly detach an object from persistence. Command-capable object identity can remain natural, while reactive read snapshots are explicitly separated where snapshot stability is required.
