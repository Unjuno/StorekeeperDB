# StorekeeperDB

**Magic state for fast AI prototypes.**

StorekeeperDB lets TypeScript apps mutate ordinary arrays and objects while SQLite quietly persists the source state behind the scenes. Useful scalar lookup paths are derived automatically when `find()` / `liveFind()` needs them. The app code does not design tables, columns, migrations, or indexes.

```ts
import { StorekeeperDB, liveFind } from "@storekeeper/db";

type Task = {
  title: string;
  done: boolean;
  priority?: "low" | "high" | "urgent";
  tags?: string[];
};

const sk = new StorekeeperDB("app.sqlite");
const tasks = sk.state<Task[]>("tasks", []);

tasks.push({ title: "Write proposal", done: false, tags: [] });
tasks[0]!.priority = "urgent";
tasks[0]!.tags!.push("prototype");

// Magic: scalar lookup paths are projected when useful.
const urgent = sk.find<Task>("tasks", { priority: "urgent" });
const liveUrgent = liveFind<Task>(sk, "tasks", { priority: "urgent" });
```

## Product rule

> Magic by default. Explainable on demand. Source state is never silently deleted.

StorekeeperDB is built for local prototype loops where UI and state shape change quickly. It is not a production database migration framework.

## Demo

Run the executable demo:

```bash
npm run demo
```

The demo shows `json_only -> projection -> debug eviction -> rebuild`, live lookup updates, and source-state preservation. See [Demo](./docs/DEMO.md).

## Public alpha docs

- [Demo](./docs/DEMO.md)
- [React verification](./docs/REACT_VERIFICATION.md)
- [Changelog](./CHANGELOG.md)
- [Release checklist](./docs/RELEASE.md)
- [Transaction model](./docs/TRANSACTION_MODEL.md)
- [Browser storage boundary](./docs/BROWSER_BOUNDARY.md)
- [Audit notes](./docs/AUDIT.md)
- [Next work](./docs/NEXT_WORK.md)
- [Todo example](./examples/todo.ts)

## What is magic?

StorekeeperDB treats app state and derived structures differently.

```text
source state JSON       = source of truth, do not silently delete
projection / lookup     = derived information, can be evicted and rebuilt
magic log / metadata    = debug surface, can be compacted
```

When `find()` or `liveFind()` uses a supported scalar path, StorekeeperDB may create a SQLite-backed projection. That projection is rebuildable. The original state remains stored as source JSON rows.

## React adapter

The React surface is intentionally thin:

```ts
import { externalStore } from "@storekeeper/db/react";
```

`externalStore(signal)` returns the shape consumed by React's `useSyncExternalStore`. The alpha test suite verifies this with real React and `react-test-renderer` while keeping the core runtime independent of React.

## Debug surface

Magic must be inspectable.

```ts
sk.status();
sk.inspect("tasks");
sk.explain("tasks", "priority");
sk.debug().recentMagic();
sk.debug().evict("tasks", ["priority"]);
sk.debug().rebuild("tasks", ["priority"]);
```

## Honesty boundary

This remains ordinary in-memory JavaScript:

```ts
const high = tasks.filter((task) => task.priority === "high");
```

StorekeeperDB does **not** claim to compile arbitrary JavaScript predicates into SQL. The supported large-list lookup path is:

```ts
const high = sk.find<Task>("tasks", { priority: "high" });
```

## Current alpha scope

This public alpha baseline includes:

- ordinary mutable array/object state
- row-per-item SQLite persistence
- common array mutators: `push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`
- nested object/array mutation persistence
- scalar-path magic lookup projection
- `signal()` / `liveFind()` for local realtime prototype flows
- React `useSyncExternalStore` adapter verification
- debug APIs: `status`, `inspect`, `explain`, `debug()`
- loud failures for intentionally unsupported shape-breaking operations

Known gaps:

- Browser adapter is not implemented.
- API is alpha and not frozen.
- The larger v22 experiment has more lifecycle/decay machinery than this public baseline.

## Requirements

- Node.js `>=22.5`
- Run Node with `--experimental-sqlite`

```bash
npm install
npm run build
npm test
npm run gate
npm run demo
npm run release:check
```

## Package boundaries

```text
@storekeeper/db              -> default alpha runtime
@storekeeper/db/core         -> core exports
@storekeeper/db/node         -> Node-local runtime export
@storekeeper/db/react        -> useSyncExternalStore-compatible adapter shape
@storekeeper/db/experimental -> experimental async boundary placeholder
```

## License

MIT
