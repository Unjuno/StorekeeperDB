# `find()` semantics evaluation

Status: CI #94 PASS; hybrid durable-handle direction conditionally selected for #29.

## Goal

Choose the least-surprising query-result contract without adding unnecessary API surface or hidden identity/lifecycle complexity.

The realistic issue-tracker scenario established the current mismatch:

```text
state() item mutation -> durable
find() item mutation  -> detached clone only
```

## Candidates

### A — keep detached snapshots

Keep `find()` behavior unchanged and make results explicitly read-only through types/documentation.

Advantages:

- minimal runtime complexity;
- current `liveFind()` snapshot behavior remains natural;
- no new handle lifetime rules are required.

Costs:

- JavaScript `Array.find()` normally returns the original object, not a clone;
- StorekeeperDB's durable-variable mental model becomes discontinuous at query boundaries;
- query-then-update requires a second lookup through `state()`;
- type-level readonly only helps TypeScript callers and does not change runtime mutation behavior.

Decision: not preferred unless durable handles prove substantially more complex than the experiment indicates.

### B — add/rename an explicit snapshot query API

Use a name that makes detached values explicit, while preserving or replacing `find()`.

Advantages:

- semantic clarity can be high;
- snapshot/read-model behavior is naturally compatible with reactive UI use.

Costs:

- larger public API or an alpha breaking rename;
- still leaves query-to-mutation workflows indirect;
- naming solves the symptom but does not strengthen the durable-variable abstraction.

Decision: defer. Do not add a second public query method without a demonstrated one-shot snapshot use case.

### C — return durable item handles from `find()`

Return a new local result array whose matching elements are the same Storekeeper-backed item proxies contained by `state()`.

Target contract:

```text
result array mutation  -> local only
result item mutation   -> durable while item belongs to the state
reorder                 -> handle identity survives
rollback                -> captured handle becomes stale
item deletion           -> captured handle becomes stale
projection eviction     -> handle remains valid because projections are derived
liveFind()              -> stable snapshot/read model, not mutable handles
```

Decision: **conditionally preferred**.

## H — hypothesis

A hybrid C design can reduce surprise without requiring a second public query API:

```text
state() / find()  = command-capable durable handles
liveFind()        = stable read snapshots
```

This is acceptable only if handle invalidation rules are explicit and reactive snapshots remain stable.

## T — experiment

`test/find_semantics_experiment.test.ts` used only current public APIs to simulate the proposed handle model through `state().filter(...)`.

CI #94 ran the experiment under Node 22.23.2 as part of the complete `npm run release:check` gate. All 24 tests passed.

## Result — CI #94

Observed behavior:

```text
current find() clone is detached                    CONFIRMED
local result array + durable item handles            PASS
item mutation through handle persists               PASS
result-array push remains local                      PASS
handle identity survives reorder                    PASS
rollback invalidates captured handle                PASS
naive live handle snapshots alias previous values   CONFIRMED BLOCKER
cloned reactive boundary restores notifications     PASS
removed handle can resurrect deleted row            CONFIRMED BLOCKER
```

### R1 — query handle model is smaller than expected

The current runtime already stores item identity on the loaded state proxies. Reorder preserves proxy identity and rollback increments state generation, making old proxies stale. The experiment did not justify a new identity registry.

### R2 — mutable handles cannot be reused as reactive snapshots

A naive selector returning durable proxies aliases the previous snapshot. When a matched item's content mutates, the old snapshot already observes the mutation before comparison, so change notification can be suppressed.

Cloning at the reactive boundary restored stable previous-value semantics and correct notification.

Therefore:

> `liveFind()` must preserve snapshot semantics independently of `find()`.

### R3 — deletion is the concrete handle-lifecycle defect

A proxy removed from a state list remains generation-valid today. Mutating it can write the deleted row back to SQLite and resurrect it after reopen.

This is not only a future `find()` problem; the same lifecycle defect exists for proxies returned by current array removals.

Tracked as #31.

## D — decision

The experiment does not support A as the default product direction: it is simpler internally but leaves the user-facing durable-variable model discontinuous.

The experiment does not justify B: adding a parallel snapshot query API increases public surface before a concrete need exists.

C is selected conditionally because its remaining complexity is localized to two explicit boundaries rather than a broad identity subsystem.

## Selected architecture

```text
command-capable durable plane
  state()
  find()        <- target after blockers are fixed

reactive read plane
  liveFind()    <- cloned/stable derived snapshots
```

A `find()` result array should be a new ordinary array. Mutating array membership must not mutate the underlying state. Its items, however, should be durable handles while they remain members of the state.

## Required implementation sequence

1. #31 — invalidate removed item handles by checking state membership in addition to generation.
2. Convert the experimental removed-handle observation into a regression asserting stale failure and no resurrection.
3. Decouple `liveFind()` snapshot cloning from the `find()` return contract.
4. Change `find()` to return matching state proxies in a new local result array.
5. Update the issue-tracker scenario so mutation through `find()` is expected to persist.
6. Re-run React/live, rollback, reorder/removal, projection lifecycle, consumer smoke, issue-tracker, and full `release:check`.

## C — competing explanations

1. Readonly snapshot types could reduce surprise enough without changing runtime behavior.
2. Future async/browser backends may make durable handle identity more expensive than the current in-memory Node runtime.
3. The split between mutable `find()` and snapshot `liveFind()` requires explicit documentation.
4. An explicit snapshot query may become useful later, but should be evidence-driven rather than added preemptively.

## U — remaining uncertainty

- close/reopen expectations for already-captured handles;
- future async/browser backend compatibility with the same handle contract;
- deep-readonly typing for `liveFind()` snapshots;
- whether a one-shot explicit snapshot query is eventually needed.

## Current recommendation

Proceed with the hybrid C architecture, but do not change `find()` until #31 and reactive snapshot separation are implemented and verified.
