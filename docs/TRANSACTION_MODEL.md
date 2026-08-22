# Transaction model

StorekeeperDB is currently a local synchronous SQLite runtime. This document defines the alpha transaction boundary so prototype behavior is explicit.

## Product rule

**Magic by default. Explainable on demand. Source state is never silently deleted.**

## Source state and derived state

StorekeeperDB stores user-created state as source state. SQLite-backed lookup projections are derived state.

| Category | Example | May be evicted? | Rebuildable? |
| --- | --- | ---: | ---: |
| Source state | item JSON rows | No | No |
| Derived state | scalar-path projections | Yes | Yes |
| Debug trace | magic log rows | Yes | Partly |

The runtime may create, delete, and rebuild derived state. It must not silently delete source state.

## `batch()`

`batch()` wraps SQLite writes in a transaction. In the alpha runtime, a failed outer batch rolls back:

- SQLite writes
- loaded list state snapshots
- loaded item contents
- loaded item IDs

This keeps reopened state and loaded list state aligned after a failed transaction.

## Important handle boundary

Existing item proxy references captured before a failed batch may be stale after rollback.

```ts
const tasks = sk.state<Task[]>("tasks", []);
const item = tasks[0];

try {
  sk.batch(() => {
    item.priority = "urgent";
    throw new Error("abort");
  });
} catch {}

// Use the list again after rollback.
const current = tasks[0];
```

The list state is restored. External item handles should not be treated as durable transaction handles.

## Recommended alpha rule

After a failed batch, read from the state list again instead of continuing to mutate item references captured before the batch.

## Future work

- Introduce explicit transaction-scoped handles, or mark stale proxies as invalid after rollback.
- Add deeper tests around nested stale proxy references.
- Decide whether failed batch should invalidate all previously returned object proxies.
