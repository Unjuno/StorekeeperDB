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

The current core runtime implements the third layer. The fourth layer is being evaluated as a convention above the core rather than added as a new public API prematurely.

## Runtime layers

```text
application code
  |
  | ordinary array/object mutation
  v
StorekeeperDB state proxies
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

inspect/debug trace (__sk_magic_log)
```

### 1. Application state

Application code works with mutable proxies returned by `state()` / `signal()`.

Current alpha boundary: root state is an **array of objects**. Arbitrary root scalars and arbitrary root objects are not yet part of the public contract.

### 2. Durable source state

`__sk_items` is the durable source of truth. Source rows survive close/reopen and are not silently deleted by projection lifecycle or metadata compaction.

This is the layer that turns a session-local value into durable state.

### 3. Derived lookup state

Supported scalar `find()` / `liveFind()` paths can create SQLite-backed projections. Projection state is derived and may be evicted/rebuilt from source rows.

Derived state must never become the only copy of user data.

### 4. Observation and lifecycle metadata

Path observations, derivation rows, and magic logs describe how the runtime is being used. They exist for planning, explanation, and bounded derived-state lifecycle behavior.

They are not the application's source of truth.

## Session bootstrap experiment

A separate process or agent session has two different problems:

1. **durability** — did the previous session's state survive?
2. **discoverability** — does the new session know what state to read?

StorekeeperDB already addresses the first problem. The alpha experiment evaluates the second with a small convention:

```text
known database path
  +
known bootstrap key: __workspace
  |
  v
workspace manifest
  |
  +--> current goal
  +--> active task
  +--> important state keys
  +--> checkpoint metadata
  |
  v
other durable states
```

Example manifest shape:

```ts
type WorkspaceManifest = {
  id: "workspace";
  schemaVersion: 1;
  currentGoal: string;
  activeTask: string;
  importantStateKeys: string[];
  checkpoint: {
    sequence: number;
    note: string;
  };
};
```

This is intentionally a **convention, not a reserved core API**. The experiment must first show that a new process can recover useful working state from only the database path and bootstrap key.

## What belongs outside the core

StorekeeperDB should not become an agent-memory framework by absorbing every coordination concern.

The following remain above the persistence core unless evidence demonstrates otherwise:

- deciding what an agent should remember;
- summarizing conversations;
- deciding when to checkpoint;
- trust / authority over stored instructions;
- conflict resolution between independent agents;
- selecting which durable states fit into a model context window.

The core should provide durable, inspectable state. A bootstrap protocol may provide discovery. Agent interpretation stays outside the database runtime.

## Important semantic boundaries

### Query results are snapshots

Current `find()` returns cloned result values rather than persistent proxy handles. Mutating a `find()` result does not mutate durable source state. This is a known semantic boundary that realistic scenarios should evaluate for surprise.

### Object identity does not cross sessions

Close/reopen preserves data, not JavaScript object identity. A new session receives new proxies reconstructed from durable source rows.

### Persistence is local, not distributed coordination

The Node alpha is local synchronous SQLite. Remote sync, multi-agent conflict resolution, and distributed consistency are not implied by durable variables.

### Schema evolution is not magically eliminated

Adding compatible JSON fields is naturally tolerant in the current source-state model, but incompatible semantic changes, migrations, validation policy, and long-lived data evolution remain real engineering concerns.

## Architectural decision rule

Use this order when considering a new capability:

1. prove the user-facing problem in a realistic scenario;
2. determine whether it is a core durability problem, a discovery problem, or an application/agent policy problem;
3. prefer a convention or documentation change before a new public API;
4. add core behavior only when the scenario cannot be solved cleanly above the runtime;
5. preserve the invariant that source state remains durable and derived state remains rebuildable.

The target is a small abstraction with a clear boundary:

> ordinary changing application state can become durable without database architecture dominating the prototype, while hard persistence problems remain observable and controllable.
