# StorekeeperDB Manual

This manual describes the public alpha API and its current boundaries.

StorekeeperDB is for fast local prototype loops. It lets TypeScript code mutate ordinary arrays and objects while SQLite persists source state and StorekeeperDB derives useful lookup structures behind the scenes.

## Install posture

This package is still `0.1.0-alpha.0`.

Local development requirements:

```bash
npm install
npm run build
```

Runtime requirement:

```bash
node --experimental-sqlite
```

Node's built-in SQLite API is still behind the experimental flag, so all scripts use `--experimental-sqlite`.

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

The app code mutates a normal-looking array. StorekeeperDB persists item rows in SQLite.

## Source state vs derived state

The core rule is:

```text
source state      = user data, do not silently delete
derived state     = projection / lookup structure, can be evicted and rebuilt
metadata          = observation counts / magic log, can be compacted
```

When in doubt, treat source rows as the durable truth.

## Lookup

Use `find()` for supported large-list scalar lookup.

```ts
const urgent = sk.find<Task>("tasks", { priority: "urgent" });
```

The first lookup on a supported scalar path may create a projection. Later lookups can use that projection.

Supported lookup values are scalar JSON values:

```text
string | number | boolean | null
```

Do not expect arbitrary JavaScript predicates to compile into SQL.

This is ordinary in-memory JavaScript:

```ts
const urgent = tasks.filter((task) => task.priority === "urgent");
```

This is StorekeeperDB lookup:

```ts
const urgent = sk.find<Task>("tasks", { priority: "urgent" });
```

## Realtime local view

Use `liveFind()` for a live lookup signal.

```ts
import { StorekeeperDB, liveFind } from "@storekeeper/db";

const sk = new StorekeeperDB("app.sqlite");
const tasks = sk.state<Task[]>("tasks", []);
const urgent = liveFind<Task>(sk, "tasks", { priority: "urgent" });

const unsubscribe = urgent.subscribe(() => {
  console.log(urgent.getSnapshot().value);
});

tasks.push({ title: "Fix login", done: false, priority: "urgent" });
unsubscribe();
```

`liveFind()` is for local prototype UI flows. It is not remote synchronization.

## React adapter

The React adapter is deliberately thin.

```ts
import { externalStore } from "@storekeeper/db/react";
```

It exposes the shape React's `useSyncExternalStore` expects.

```ts
const store = externalStore(urgentSignal);
```

The core runtime does not import React. React is only used by the test suite to verify adapter behavior.

## Batch

Use `batch()` to group mutations.

```ts
sk.batch(() => {
  tasks.push({ title: "A", done: false });
  tasks.push({ title: "B", done: false });
});
```

If an outer `batch()` fails, StorekeeperDB rolls back the database and loaded list state. Item/nested proxy handles captured before the failed batch are stale after rollback. Re-read from the list.

```ts
try {
  sk.batch(() => {
    const task = tasks[0]!;
    task.title = "temporary";
    throw new Error("fail");
  });
} catch {
  // Re-read. Do not keep using old item proxy handles from the failed batch.
  const fresh = tasks[0];
}
```

## Debug surface

Magic must be inspectable.

```ts
sk.status();
sk.inspect("tasks");
sk.explain("tasks", "priority");
sk.debug().recentMagic();
sk.debug().derivations("tasks");
```

Use `explain()` to check whether a path is still JSON-only or backed by a projection.

```ts
sk.explain("tasks", "priority");
```

## Manual derived lifecycle

Projection rows are derived. They can be evicted and rebuilt.

```ts
sk.debug().markCold("tasks", ["priority"]);
sk.debug().collectGarbage({ stateKey: "tasks" });
sk.debug().evict("tasks", ["priority"]);
sk.debug().rebuild("tasks", ["priority"]);
```

Evicting a projection does not delete source rows. The next supported `find()` can rebuild it.

## Automatic derived decay

Automatic derived decay is opt-in.

```ts
const sk = new StorekeeperDB("app.sqlite", {
  decay: {
    enabled: true,
    collectEveryFinds: 4,
    maxDerivations: 2,
    markCold: true,
  },
});
```

Current alpha behavior:

- lookup-count-based
- synchronous after configured `find()` intervals
- no hidden async background worker
- current lookup path protected during the same GC pass
- source rows preserved

## Metadata compaction

Magic logs and path observations are metadata.

```ts
sk.debug().compactMetadata({
  maxMagicLogEntries: 500,
  pathCountDecayFactor: 0.5,
  dropPathStatsBelow: 1,
  stateKey: "tasks",
});
```

This may trim old magic logs and reduce/delete low-value non-projection observations.

It does not delete:

- source rows
- active projection cells
- projection-backed path observations

## Browser boundary

`@storekeeper/db` is the synchronous local SQLite runtime.

Browser-style async storage is represented only by the experimental write-behind model:

```ts
import {
  AsyncMemoryStorage,
  ExperimentalAsyncWriteBehindRuntime,
} from "@storekeeper/db/experimental";

const storage = new AsyncMemoryStorage();
const sk = new ExperimentalAsyncWriteBehindRuntime(storage);
const tasks = await sk.state<Task[]>("tasks", []);

tasks.push({ title: "Draft", done: false });

sk.status(); // dirty
await sk.flush();
sk.status(); // clean
```

Meaning:

```text
mutation returned = memory changed
flush resolved    = async storage accepted the write
```

Do not treat browser async storage as equivalent to the Node SQLite runtime.

## Benchmark

Run:

```bash
npm run benchmark
```

The benchmark prints JSON with timings and semantic pass/fail information. See [Benchmarks](./BENCHMARKS.md).

## Unsupported or intentionally loud operations

StorekeeperDB intentionally rejects some shape-breaking array operations in the alpha.

Examples:

- sparse assignment
- `delete tasks[0]`
- `fill()`
- `copyWithin()`
- growing `length`

The aim is to fail loudly rather than silently diverge from SQLite source state.

## Operational checklist

Before treating a change as release-ready, run:

```bash
npm run release:check
```

This runs build, tests, gate, demo, export checks, and package dry-run.

Run the benchmark separately when evaluating runtime changes:

```bash
npm run benchmark
```
