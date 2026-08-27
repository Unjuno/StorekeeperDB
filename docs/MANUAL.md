# StorekeeperDB Manual

This manual describes the public alpha API and its current boundaries.

StorekeeperDB is for fast local prototype loops. It lets TypeScript code mutate ordinary-looking arrays and objects while SQLite persists source state and StorekeeperDB derives lookup structures behind the scenes.

## Install posture

This package is still `0.1.0-alpha.0`.

```bash
npm install
npm run build
node --experimental-sqlite your-app.js
```

## Minimal state

```ts
import { StorekeeperDB } from "@storekeeper/db";

type Task = {
  title: string;
  done: boolean;
  priority?: "low" | "high" | "urgent";
};

const sk = new StorekeeperDB("app.sqlite");
const tasks = sk.state<Task[]>("tasks", []);

tasks.push({ title: "Write proposal", done: false });
tasks[0]!.priority = "urgent";

sk.close();
```

Root-state alpha boundary: `state()` currently supports arrays of objects.

## Source state vs derived state

```text
source state      = user data, do not silently delete
derived state     = projection / lookup structure, evictable + rebuildable
metadata          = observation counts / magic log, compactable
```

`__sk_items` is the durable source of truth.

## `find()` — query with durable item handles

Use `find()` for supported scalar lookup.

```ts
const urgent = sk.find<Task>("tasks", { priority: "urgent" });
```

The first lookup on a supported scalar path may create a projection. Later lookups can use that projection.

Supported lookup values are scalar JSON values:

```text
string | number | boolean | null
```

`find()` has an intentional two-level contract:

```text
result array -> ordinary local array
result items -> durable StorekeeperDB handles
```

Therefore query-to-update is direct:

```ts
const [task] = sk.find<Task>("tasks", { priority: "urgent" });
if (task) task.done = true; // persists
```

But changing query-result membership does not change source membership:

```ts
const urgent = sk.find<Task>("tasks", { priority: "urgent" });
urgent.pop(); // only changes this local result array
```

`find(key, {})` also returns a new ordinary local array rather than the persistent list proxy itself.

StorekeeperDB does not compile arbitrary JavaScript predicates into SQL:

```ts
const local = tasks.filter((task) => task.priority === "urgent");
const projected = sk.find<Task>("tasks", { priority: "urgent" });
```

## Durable handle lifetime

A handle is writable only while its item belongs to the current loaded state generation.

```text
active member    -> readable + writable
reordered member -> same handle remains writable
rollback         -> old-generation handle is stale
removed member   -> readable detached reference, writes fail
close/reopen     -> data survives; JavaScript proxy identity does not
```

Example removal behavior:

```ts
const removed = tasks.pop();
if (removed) {
  console.log(removed.title); // readable
  // removed.done = true;     // throws: item is no longer writable
}
```

This prevents a stale removed object from silently recreating a deleted persistent row.

## `liveFind()` — stable reactive snapshots

Use `liveFind()` for a live lookup signal.

```ts
import { liveFind } from "@storekeeper/db";

const urgent = liveFind<Task>(sk, "tasks", { priority: "urgent" });
const unsubscribe = urgent.subscribe(() => {
  console.log(urgent.getSnapshot());
});
```

`liveFind()` is deliberately not a collection of command-capable handles. It owns detached stable snapshots.

A previously returned snapshot retains its previous content after source mutation; a changed result appears in a new snapshot/version. This avoids proxy aliasing and is the required boundary for React-style external-store consumers.

```text
state() / find() -> durable command-capable handles
liveFind()       -> detached stable read snapshots
```

`liveFind()` is local realtime behavior, not remote synchronization.

## React adapter

```ts
import { externalStore } from "@storekeeper/db/react";
```

The adapter exposes the shape expected by React `useSyncExternalStore`. The core runtime itself does not import React.

## Batch and rollback

```ts
sk.batch(() => {
  tasks.push({ title: "A", done: false });
  tasks.push({ title: "B", done: false });
});
```

If an outer `batch()` fails, StorekeeperDB rolls back database and loaded-list state. Item/nested handles captured before the failed batch become stale because the loaded state advances to a new generation.

```ts
const captured = tasks[0];

try {
  sk.batch(() => {
    if (captured) captured.done = true;
    throw new Error("fail");
  });
} catch {
  // Re-read from tasks. Do not keep writing through captured.
}
```

## Debug surface

```ts
sk.status();
sk.inspect("tasks");
sk.explain("tasks", "priority");
sk.debug().recentMagic();
sk.debug().derivations("tasks");
```

Use `explain()` to inspect whether a path is JSON-only or backed by a projection.

## Derived lifecycle

Projection rows are derived and may be evicted/rebuilt without deleting source rows.

```ts
sk.debug().markCold("tasks", ["priority"]);
sk.debug().collectGarbage({ stateKey: "tasks" });
sk.debug().evict("tasks", ["priority"]);
sk.debug().rebuild("tasks", ["priority"]);
```

Automatic derived decay is opt-in and currently lookup-count-based. It has no hidden async background worker.

## Metadata compaction

```ts
sk.debug().compactMetadata({
  maxMagicLogEntries: 500,
  pathCountDecayFactor: 0.5,
  dropPathStatsBelow: 1,
  stateKey: "tasks",
});
```

Metadata compaction may reduce debug/planning observations. It must not delete source rows, active projection cells, or projection-backed path observations required by active derivations.

## Browser boundary

`@storekeeper/db` is the synchronous local SQLite runtime.

Browser-style async storage is represented only by the experimental write-behind model in `@storekeeper/db/experimental`.

```text
mutation returned = memory changed
flush resolved    = async storage accepted the write
```

Do not treat the experimental async runtime as a complete browser adapter.

## Unsupported or intentionally loud operations

The alpha rejects shape-breaking persistent-array operations rather than silently diverging from source state, including:

- sparse assignment;
- `delete tasks[0]`;
- `fill()`;
- `copyWithin()`;
- growing `length` by direct assignment.

## Benchmark

```bash
npm run benchmark
```

Benchmark timings are observational, not production guarantees.

## Operational checklist

Before treating a change as release-ready:

```bash
npm run release:check
```

This runs build, tests, deterministic scenarios/experiments, export checks, documentation checks, package dry-run, and consumer smoke.
