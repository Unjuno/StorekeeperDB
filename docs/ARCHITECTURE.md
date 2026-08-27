# StorekeeperDB architecture

StorekeeperDB is an alpha persistence runtime for fast-changing TypeScript applications. Its architectural goal is to let application state outlive the process that created it without forcing a database/repository design into the first prototype loop.

The useful mental model is a **durable variable runtime**, not "a database no longer exists."

## Variable lifetime model

StorekeeperDB distinguishes four increasingly durable scopes:

```text
local value
  -> function / task lifetime

session value
  -> process / agent-session lifetime

durable state
  -> survives close, reopen, process replacement

discoverable durable state
  -> a new process / agent can find the durable state it should read
```

The current core implements durable local state. Discoverability is being evaluated as a convention above the core rather than added as a public workspace API prematurely.

## Runtime layers

```text
application code
  |
  | state() / find() durable handles
  v
loaded StorekeeperDB state
  |
  | source persistence
  v
__sk_items
  |
  +--> observation metadata (__sk_paths)
  |
  +--> derived scalar projections (__sk_projection)
          |
          +--> derivation lifecycle (__sk_derivations)

liveFind()
  ^
  | detached stable snapshots cloned from the durable plane
  |
reactive UI / external-store consumers
```

## Durable handle plane

Application code can obtain command-capable durable item handles from both `state()` and `find()`.

```text
state() item       -> durable handle
find() result item -> durable handle
```

A `find()` result array is deliberately different from its elements: the array is an ordinary local array, while matched items are Storekeeper-backed handles.

```text
result-array mutation -> local only
result-item mutation  -> persistent while handle is writable
```

This keeps query-to-update natural without turning temporary query-result membership into durable state membership.

### Handle validity

A durable handle is writable only while both of these conditions hold:

1. it belongs to the current loaded state generation; and
2. its durable item id is still a member of that loaded state.

Operationally:

```text
active member    -> readable + writable
reordered member -> same handle remains writable
rollback         -> old-generation handle is stale
removed member   -> readable detached reference, writes fail
close/reopen     -> durable data survives, JavaScript identity does not
```

No separate public identity registry is required for the current Node runtime. Existing internal item ids, loaded-state membership, and generation checks are sufficient for the tested semantics.

## Reactive read plane

`liveFind()` is not a collection of mutable handles. It owns detached stable snapshots independently of `find()`.

That separation is required because mutable proxies alias prior values: if an old reactive snapshot contains the same proxy that is later mutated, the old snapshot changes before comparison and content-change notification can be suppressed.

Therefore:

```text
command-capable plane -> state(), find()
reactive read plane   -> liveFind()
```

A previous `liveFind()` snapshot must retain its previous content after later source mutation. New source content is exposed through a new snapshot/version.

This boundary is also what keeps the React `useSyncExternalStore` adapter coherent.

## Durable source state

`__sk_items` is the durable source of truth. Source rows survive close/reopen and are not silently deleted by projection lifecycle or metadata compaction.

Root-state alpha boundary: `state()` is currently an array-of-objects API. Arbitrary root scalars and arbitrary root objects are not yet part of the public contract.

## Derived lookup state

Supported scalar `find()` / `liveFind()` paths can create SQLite-backed projections. Projection state is derived and may be evicted/rebuilt from source rows.

Projection eviction does not invalidate a durable item handle because item identity belongs to source state, not to the derived projection.

Derived state must never become the only copy of user data.

## Observation and lifecycle metadata

Path observations, derivation rows, and magic logs describe how the runtime is being used. They exist for planning, explanation, and bounded derived-state lifecycle behavior. They are not application source data.

## Session bootstrap experiment

A separate process or agent session has two different problems:

1. **durability** — did the previous session's state survive?
2. **discoverability** — does the new session know what state to read?

The alpha experiment uses a known database path plus a known bootstrap key such as `__workspace` to discover other durable state keys. This is a convention, not a reserved core API.

StorekeeperDB should not absorb agent policy by default. Checkpoint policy, summarization, trust, context selection, and multi-agent conflict resolution remain above the persistence core unless evidence demonstrates otherwise.

## Important boundaries

### Object identity does not cross sessions

Close/reopen preserves durable data and durable item ids in storage, but callers receive newly reconstructed JavaScript proxies. Do not rely on `===` identity across sessions.

### Persistence is local, not distributed coordination

The Node alpha is local synchronous SQLite. Remote sync, distributed consistency, and multi-process conflict resolution are not implied by durable variables.

### Schema evolution is not eliminated

Compatible optional JSON-field additions work naturally in the tested issue-tracker scenario. Incompatible semantic changes, field renames, validation policy, and long-lived migration remain real persistence problems.

### Simple things automatic, hard things explicit

The architecture should hide persistence ceremony, not failure reality. Unexpected lifecycle states should fail loudly rather than silently re-create, lose, or reinterpret source data.

## Architectural decision rule

When considering a new capability:

1. prove the user-facing problem in a realistic scenario;
2. classify it as durability, identity/lifecycle, discovery, reactive-read, or application policy;
3. prefer a smaller invariant or convention before a new public API;
4. add core behavior only when the scenario cannot be solved cleanly above the runtime;
5. preserve durable source state and rebuildable derived state;
6. preserve the split between command-capable handles and stable reactive snapshots unless new evidence falsifies it.

The target remains small:

> ordinary changing application state can become durable without database architecture dominating the prototype, while hard persistence problems remain observable and controllable.
