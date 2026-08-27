# StorekeeperDB

**Magic persistence for fast-changing TypeScript prototypes.**

StorekeeperDB lets TypeScript applications mutate ordinary-looking arrays and objects while SQLite persists source state behind the scenes. The product goal is to delay persistence architecture decisions while an application is changing quickly, without pretending that hard persistence problems disappear.

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

const urgent = sk.find<Task>("tasks", { priority: "urgent" });
urgent[0]!.done = true; // durable item-handle mutation

const liveUrgent = liveFind<Task>(sk, "tasks", { priority: "urgent" });
```

## Product rule

> Magic by default. Explainable on demand. Source state is never silently deleted.

StorekeeperDB is built for local prototype loops where state shape changes quickly. It is not a production database migration framework.

The intended abstraction is not “databases no longer exist.” It is “simple persistence should not dominate application architecture before it needs to.” Transaction semantics, durability boundaries, incompatible shape changes, indexing cost, recovery, and concurrency remain real engineering concerns.

## Core semantic contract

StorekeeperDB now separates command-capable durable handles from reactive read snapshots.

```text
state() item             -> durable handle
find() result item       -> durable handle
find() result array      -> ordinary local array
liveFind() result values -> detached stable snapshots
```

`find()` returns durable item handles. Mutating a matched item persists while that item remains a member of the current loaded state generation.

```ts
const [task] = sk.find<Task>("tasks", { priority: "urgent" });
if (task) task.done = true;
```

The result array itself is not persistent. Changing query-result membership does not change source membership.

```ts
const urgent = sk.find<Task>("tasks", { priority: "urgent" });
urgent.pop(); // local result array only; source state is unchanged
```

Handle lifetime is explicit:

```text
active member    -> readable + writable
reordered member -> same handle remains writable
rollback         -> old-generation handle is stale
removed member   -> readable detached reference, writes fail
close/reopen     -> data survives; JavaScript object identity does not
```

`liveFind()` intentionally uses detached snapshots so previous reactive snapshots do not alias later mutations. This keeps React-style external-store semantics stable while `find()` remains command-capable.

See [`find()` semantics evaluation](./docs/FIND_SEMANTICS_EVALUATION.md) and [Architecture](./docs/ARCHITECTURE.md).

## Current development posture

`0.1.0-alpha.0` is a public alpha candidate, not a stable API release. The current priority is evaluation and product refinement, not promotion or feature-count growth.

The default loop is:

1. choose a realistic usage scenario;
2. use the documented public API;
3. record friction, surprise, failure, documentation gaps, and performance roughness;
4. make the smallest justified change;
5. run regression checks and the scenario again;
6. repeat.

See [Alpha evaluation loop](./docs/EVALUATION_LOOP.md) and [Next work](./docs/NEXT_WORK.md).

## Realistic issue tracker scenario

Run:

```bash
npm run scenario:issue-tracker
```

The scenario creates a minimal issue model, closes/reopens the database, evolves the model with optional priority/labels/comments, queries an issue, mutates it directly through the `find()` durable handle, and reopens again to verify persistence. It also verifies that modifying the query-result array does not modify source-state membership.

See [Issue tracker evaluation](./docs/ISSUE_TRACKER_EVALUATION.md).

## Durable session experiment

Run:

```bash
npm run experiment:durable-session
```

The writer and reader execute as separate Node processes against one temporary SQLite database. The reader initially knows only a bootstrap state key and discovers other durable state keys from the stored manifest. This evaluates durability plus discoverability; it does not claim StorekeeperDB is an agent-memory or orchestration framework.

## What is magic?

StorekeeperDB treats source state and derived lookup structures differently.

```text
source state JSON       = source of truth, do not silently delete
projection / lookup     = derived information, can be evicted and rebuilt
magic log / metadata    = debug surface, can be compacted
```

When `find()` or `liveFind()` uses a supported scalar path, StorekeeperDB may create a SQLite-backed projection. The original state remains stored as source JSON rows.

StorekeeperDB does not compile arbitrary JavaScript predicates into SQL:

```ts
const local = tasks.filter((task) => task.priority === "high");
const projected = sk.find<Task>("tasks", { priority: "high" });
```

## Demo and benchmark

```bash
npm run demo
npm run benchmark
```

The benchmark is observational and does not define production latency guarantees. See [Benchmarks](./docs/BENCHMARKS.md).

## Current alpha scope

Included:

- mutable list-of-object state;
- row-per-item SQLite persistence;
- common array mutators: `push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`;
- nested object/array mutation persistence;
- durable item handles from `state()` and `find()`;
- stable detached reactive snapshots from `liveFind()`;
- scalar-path lookup projections;
- source-preserving projection eviction/rebuild and opt-in derived decay;
- metadata compaction;
- `signal()` / `liveFind()` local realtime flows;
- React `useSyncExternalStore` adapter verification;
- experimental async write-behind boundary model;
- inspectable `status`, `inspect`, `explain`, and `debug()` APIs;
- executable scenarios, benchmark, consumer smoke, and release checks.

Known gaps:

- Root `state()` is currently an array-of-objects API, not arbitrary root values.
- Full browser adapter is not implemented.
- API is alpha and not frozen.
- Compatible JSON-field evolution does not eliminate incompatible-schema migration problems.
- Time-based lifecycle decay and richer metadata scoring are deferred research.
- The experimental async runtime is a durability-boundary model, not a production browser backend.
- The durable-session bootstrap convention does not solve checkpoint policy, trust, multi-agent coordination, or context selection.

## Requirements

- Node.js `>=22.5`
- Run Node with `--experimental-sqlite`

```bash
npm install
npm run build
npm test
npm run gate
npm run demo
npm run scenario:issue-tracker
npm run experiment:durable-session
npm run benchmark
npm run release:check
```

## Package boundaries

```text
@storekeeper/db              -> default alpha runtime
@storekeeper/db/core         -> core exports
@storekeeper/db/node         -> Node-local runtime export
@storekeeper/db/react        -> useSyncExternalStore-compatible adapter
@storekeeper/db/experimental -> experimental async write-behind boundary
```

## Documentation

Start with the [documentation index](./docs/README.md).

Primary documents:

- [Manual](./docs/MANUAL.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [`find()` semantics evaluation](./docs/FIND_SEMANTICS_EVALUATION.md)
- [Alpha evaluation loop](./docs/EVALUATION_LOOP.md)
- [Issue tracker evaluation](./docs/ISSUE_TRACKER_EVALUATION.md)
- [Next work](./docs/NEXT_WORK.md)
- [Benchmarks](./docs/BENCHMARKS.md)
- [Alpha release decision](./docs/ALPHA_RELEASE_DECISION.md)
- [Release checklist](./docs/RELEASE.md)

## Release boundary

Publishing remains manual. If the alpha is published, use the `alpha` npm dist-tag and follow [Alpha release decision](./docs/ALPHA_RELEASE_DECISION.md) and [Release checklist](./docs/RELEASE.md). Do not publish as `latest`.

## License

MIT
