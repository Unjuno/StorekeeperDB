# StorekeeperDB

**Magic persistence for fast-changing TypeScript prototypes.**

StorekeeperDB lets TypeScript apps mutate ordinary arrays and objects while SQLite quietly persists source state behind the scenes. The product goal is to delay persistence architecture decisions while an application is still changing quickly: fewer tables, repository layers, migrations, and indexes need to be designed up front.

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

const urgent = sk.find<Task>("tasks", { priority: "urgent" });
const liveUrgent = liveFind<Task>(sk, "tasks", { priority: "urgent" });
```

## Product rule

> Magic by default. Explainable on demand. Source state is never silently deleted.

StorekeeperDB is built for local prototype loops where UI and state shape change quickly. It is not a production database migration framework.

The intended abstraction is not “databases no longer exist.” It is “simple persistence should not dominate application architecture before it needs to.” Hard persistence problems such as transaction semantics, durability boundaries, incompatible shape changes, indexing cost, and recovery remain explicit when they matter.

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

## Demo

Run the executable demo:

```bash
npm run demo
```

The demo shows `json_only -> projection -> debug eviction -> rebuild`, live lookup updates, and source-state preservation. See [Demo](./docs/DEMO.md).

## Benchmark

Run the executable benchmark:

```bash
npm run benchmark
```

The benchmark prints JSON timings for insert, first projected lookup, repeated lookup, live update behavior, metadata compaction, and reopen lookup. It is an observation tool, not a hard release latency gate. See [Benchmarks](./docs/BENCHMARKS.md).

## Documentation

Start with the [documentation index](./docs/README.md).

Primary alpha documents:

- [Manual](./docs/MANUAL.md)
- [Alpha evaluation loop](./docs/EVALUATION_LOOP.md)
- [Next work](./docs/NEXT_WORK.md)
- [Benchmarks](./docs/BENCHMARKS.md)
- [Alpha release decision](./docs/ALPHA_RELEASE_DECISION.md)
- [Release checklist](./docs/RELEASE.md)
- [Transaction model](./docs/TRANSACTION_MODEL.md)
- [Browser storage boundary](./docs/BROWSER_BOUNDARY.md)
- [Changelog](./CHANGELOG.md)

Implementation and experiment notes remain available from the documentation index rather than being presented as equal-priority entry points here.

## What is magic?

StorekeeperDB treats application source state and derived lookup structures differently.

```text
source state JSON       = source of truth, do not silently delete
projection / lookup     = derived information, can be evicted and rebuilt
magic log / metadata    = debug surface, can be compacted
```

When `find()` or `liveFind()` uses a supported scalar path, StorekeeperDB may create a SQLite-backed projection. That projection is rebuildable. The original state remains stored as source JSON rows.

Ordinary in-memory JavaScript remains ordinary in-memory JavaScript:

```ts
const high = tasks.filter((task) => task.priority === "high");
```

StorekeeperDB does not claim to compile arbitrary JavaScript predicates into SQL. The supported large-list lookup path is explicit:

```ts
const high = sk.find<Task>("tasks", { priority: "high" });
```

## Current alpha scope

Included:

- ordinary mutable array/object state;
- row-per-item SQLite persistence;
- common array mutators: `push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`;
- nested object/array mutation persistence;
- scalar-path lookup projection through `find()` / `liveFind()`;
- source-preserving derived projection eviction and rebuild;
- opt-in automatic derived projection decay;
- metadata compaction for debug/planning observations;
- `signal()` / `liveFind()` for local realtime prototype flows;
- React `useSyncExternalStore` adapter verification;
- experimental async write-behind boundary model;
- inspectable debug APIs such as `status`, `inspect`, `explain`, and `debug()`;
- executable demo, benchmark, consumer smoke, and release checks.

Known gaps:

- Full browser adapter is not implemented.
- API is alpha and not frozen.
- Time-based lifecycle decay and richer metadata scoring are deferred research, not current product priorities.
- The experimental async runtime is a durability-boundary model, not a production browser backend.

## Requirements

- Node.js `>=22.5`
- Run Node with `--experimental-sqlite`

```bash
npm install
npm run build
npm test
npm run gate
npm run demo
npm run benchmark
npm run release:check
```

## Package boundaries

```text
@storekeeper/db              -> default alpha runtime
@storekeeper/db/core         -> core exports
@storekeeper/db/node         -> Node-local runtime export
@storekeeper/db/react        -> useSyncExternalStore-compatible adapter shape
@storekeeper/db/experimental -> experimental async write-behind boundary
```

## Release boundary

Publishing remains manual. If the alpha is published, use the `alpha` npm dist-tag and follow [Alpha release decision](./docs/ALPHA_RELEASE_DECISION.md) and [Release checklist](./docs/RELEASE.md). Do not publish as `latest`.

## License

MIT
