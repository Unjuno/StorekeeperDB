# `find()` semantics evaluation

Status: experimental decision record for #29.

## Goal

Choose the least-surprising query-result contract without adding unnecessary API surface or hidden identity/lifecycle complexity.

The realistic issue-tracker scenario established the current mismatch:

```text
state() item mutation -> durable
find() item mutation  -> detached clone only
```

This document compares three product directions.

## Candidates

### A — keep detached snapshots

Keep `find()` behavior unchanged and make results explicitly read-only through types/documentation.

Advantages:

- minimal runtime complexity;
- current `liveFind()` snapshot behavior remains natural;
- no handle lifetime rules need to be added.

Costs:

- JavaScript `Array.find()` normally returns the original object, not a clone;
- StorekeeperDB's durable-variable mental model becomes discontinuous at query boundaries;
- query-then-update requires a second lookup through `state()`;
- type-level readonly only helps TypeScript callers and does not change runtime mutation behavior.

### B — add/rename an explicit snapshot query API

Use a name that makes detached values explicit, while preserving or replacing `find()`.

Advantages:

- semantic clarity can be high;
- snapshot/read-model behavior is naturally compatible with reactive UI use.

Costs:

- larger public API or an alpha breaking rename;
- still leaves query-to-mutation workflows indirect;
- naming solves the symptom but does not strengthen the durable-variable abstraction.

### C — return durable item handles from `find()`

Return a new local result array whose matching elements are the same Storekeeper-backed item proxies contained by `state()`.

Expected contract:

```text
result array mutation  -> local only
result item mutation   -> durable while item belongs to the state
reorder                 -> handle identity survives
rollback                -> captured handle becomes stale
item deletion           -> captured handle must become stale
projection eviction     -> handle remains valid because projections are derived
liveFind()              -> remains a stable snapshot/read model, not mutable handles
```

Advantages:

- aligns with JavaScript reference semantics;
- aligns with StorekeeperDB's durable-variable model;
- query-then-update becomes direct;
- current runtime already filters the loaded state proxies before cloning, so the basic handle path is conceptually small.

Costs / required hardening:

- `liveFind()` cannot naively reuse mutable handles because previous snapshots alias current state;
- removed item proxies need explicit invalidation;
- query handle semantics must remain compatible with rollback and deletion lifecycle rules.

## H — hypothesis

A hybrid C design can reduce surprise without requiring a second public query API:

```text
state() / find()  = command-capable durable handles
liveFind()        = stable read snapshots
```

This is acceptable only if handle invalidation rules are explicit and reactive snapshots remain stable.

## T — minimum experiment

`test/find_semantics_experiment.test.ts` uses only current public APIs to simulate the proposed handle model through `state().filter(...)` and checks:

1. current `find()` clones are detached;
2. state-filter handles persist item mutation while their result array remains local;
3. naive reactive selectors over durable handles alias prior snapshots;
4. cloning at the reactive boundary restores stable snapshot behavior;
5. handle identity survives reorder;
6. rollback already invalidates captured proxies;
7. removed handles are tested for stale behavior.

The experiment intentionally records current unsafe behavior if a removed proxy can write again. That observation is a blocker for making `find()` return handles until fixed.

## D — decision rules

Choose A when durable handles require broad new identity machinery or cannot coexist cleanly with reactive snapshots.

Choose B when snapshot semantics are clearly preferred but the `find()` name remains materially misleading after type/documentation hardening.

Choose C when:

- query-to-update becomes natural;
- result arrays remain local values;
- reorder preserves handle identity;
- rollback and deletion make invalid handles fail loudly;
- `liveFind()` keeps stable snapshot semantics;
- the implementation remains smaller than adding parallel mutable/snapshot query APIs.

## C — competing explanations

1. The issue-tracker surprise may be fixable with readonly types alone.
2. Durable handles may appear simple only because state is already loaded in memory; future backends could make identity more expensive.
3. Snapshot semantics may be more database-like even if they are less JavaScript-like.
4. A split between mutable `find()` and snapshot `liveFind()` may itself require careful documentation.

## U — uncertainty

- removed-handle invalidation behavior;
- whether future async/browser backends can preserve the same handle model;
- close/reopen handle expectations;
- whether users need an explicit one-shot snapshot query later;
- deep-readonly ergonomics for reactive snapshots.

## Working recommendation

Do not add a second public query method yet.

If the experiment confirms that the two identified blockers are localized, prefer the hybrid C direction:

```text
find()     -> local array of durable item handles
liveFind() -> stable read snapshots
```

Before changing `find()` itself:

1. make removed item proxies stale instead of allowing writes after deletion;
2. add regression coverage for removed handles;
3. preserve clone/snapshot semantics inside `liveFind()` independently of `find()`;
4. then change `find()` to return matching state proxies in a new local array;
5. rerun issue-tracker, React/live tests, rollback tests, projection lifecycle tests, consumer smoke, and `release:check`.
