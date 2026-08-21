# StorekeeperDB

**Magic state for fast AI prototypes.**

StorekeeperDB lets TypeScript prototype apps use ordinary mutable state while SQLite persists it behind the scenes. You write arrays and objects. StorekeeperDB keeps them, observes how they are used, and quietly grows rebuildable SQLite-backed lookup structures when they become useful.

```ts
import { StorekeeperDB, liveFind } from "@storekeeper/db";

type Task = {
  title: string;
  done: boolean;
  priority?: "low" | "high" | "urgent";
};

const sk = new StorekeeperDB("app.sqlite");
const taskSignal = sk.signal<Task[]>("tasks", []);
const tasks = taskSignal.value;

tasks.push({ title: "Write proposal", done: false });
tasks[0].priority = "urgent";

// Magic mode: safe scalar lookup paths are promoted automatically.
const urgent = sk.find<Task>("tasks", { priority: "urgent" });
const liveUrgent = liveFind<Task>(sk, "tasks", { priority: "urgent" });
```

No SQL. No tables. No migrations in prototype code.

## Current status

This repository is an experimental pre-release. The current implementation targets local synchronous SQLite on Node.js. Browser-style async storage is intentionally separated under `experimental` because ordinary JavaScript mutation and async durability have different semantics.

Tested in the pre-repo experiments:

- ordinary TypeScript array/object mutation
- SQLite persistence and reopen recovery
- nested object/array mutation
- signal/live view notification
- rollback safety for failed batches
- safe scalar-path magic lookup projection
- derived projection lifecycle: create, hot, cold, evict, rebuild
- derived storage budget and metadata compaction
- inspect/debug APIs
- package boundary shape: core, node, react adapter, experimental

Not complete yet:

- real React DOM render tests
- browser adapter
- final public API freeze
- production benchmark suite

## Core idea

```text
ordinary TypeScript state
  -> proxy mutation capture
  -> SQLite source state
  -> path observation
  -> magic derivation
  -> projection / live lookup
  -> decay / eviction / rebuild
  -> metadata compaction
```

The source state is the source of truth. Storekeeper-created projections are derived information: they can be evicted and rebuilt.

## Magic mode

Magic mode is on by default for the local sync runtime.

```ts
const sk = new StorekeeperDB("app.sqlite");
```

When `find()` or `liveFind()` uses a safe scalar path, StorekeeperDB may automatically create a SQLite-backed projection. That projection may later become hot, cold, evicted, and rebuilt. The source state remains intact.

Magic is intentionally bounded:

- scalar paths can be auto-promoted
- object / array / mixed paths stay JSON-only
- destructive migration is not implemented
- async browser write-behind remains experimental
- debug APIs explain what happened

Explicit-only mode remains available:

```ts
const sk = new StorekeeperDB("app.sqlite", { magic: false });
sk.promote("tasks", ["priority"]);
```

`harden()` remains as a lower-level alias. Public language should prefer `promote()`.

## Debugging the magic

Normal prototype code should not need these, but the runtime must be inspectable.

```ts
sk.status();
sk.inspect("tasks");
sk.explain("tasks", "priority");

sk.debug().recentMagic();
sk.debug().derivations("tasks");
sk.debug().collectGarbage({ stateKey: "tasks", force: true });
sk.debug().evict("tasks", ["priority"]);
sk.debug().rebuild("tasks", ["priority"]);
sk.debug().compactMetadata({ maxMagicLogEntries: 100 });
```

## Honest boundary

This is natural JavaScript and runs in memory:

```ts
const high = tasks.filter((task) => task.priority === "high");
```

StorekeeperDB can observe reads during this code, but it does not claim to compile arbitrary JavaScript predicates into SQL.

This is the supported large-list lookup path:

```ts
const high = sk.find<Task>("tasks", { priority: "high" });
```

For live lookup:

```ts
const urgent = liveFind<Task>(sk, "tasks", { priority: "urgent" });
```

## Package boundaries

```text
@storekeeper/db              -> default local SQLite runtime
@storekeeper/db/core         -> state, signal, live, promote, inspect
@storekeeper/db/node         -> Node SQLite adapters
@storekeeper/db/react        -> useSyncExternalStore-compatible adapter shape
@storekeeper/db/experimental -> async write-behind boundary experiments
```

## Development

Node.js 22.5+ is required for `node:sqlite` experiments.

```bash
npm run build
npm test
npm run gate
npm run magic-lifecycle
npm run magic-decay
npm run metadata
```

Some commands require Node's experimental SQLite flag. The package scripts include it where needed.

## Product rule

**Magic by default. Explainable on demand. Source state is never silently deleted.**
