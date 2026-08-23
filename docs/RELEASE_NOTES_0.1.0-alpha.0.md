# StorekeeperDB 0.1.0-alpha.0 release notes

StorekeeperDB is a persistent state runtime for fast local TypeScript prototype loops.

It lets application code mutate ordinary arrays and objects while SQLite persists source state behind the scenes. Useful scalar lookup paths can become SQLite-backed projections when `find()` or `liveFind()` needs them.

## Highlights

- Ordinary TypeScript array/object mutation with SQLite-backed source persistence.
- Row-per-item storage model instead of one giant JSON root.
- Magic scalar lookup projections for supported `find()` calls.
- Local realtime lookup through `liveFind()`.
- React adapter verified with `useSyncExternalStore` and `react-test-renderer`.
- Debug surface for explaining what the runtime created or evicted.
- Derived projection lifecycle APIs: mark cold, collect garbage, evict, rebuild.
- Opt-in automatic derived decay.
- Metadata compaction for magic logs and non-projection path observations.
- Experimental async write-behind boundary model for browser-style durability semantics.
- Executable demo and benchmark script.
- Public alpha manual.

## Install posture

This is an alpha candidate. Publish with the alpha tag only:

```bash
npm publish --tag alpha
```

Do not publish as `latest`.

## Runtime requirements

- Node.js `>=22.5`
- `--experimental-sqlite`

## Basic example

```ts
import { StorekeeperDB, liveFind } from "@storekeeper/db";

type Task = {
  title: string;
  done: boolean;
  priority?: "low" | "high" | "urgent";
};

const sk = new StorekeeperDB("app.sqlite");
const tasks = sk.state<Task[]>("tasks", []);

tasks.push({ title: "Write proposal", done: false });
tasks[0]!.priority = "urgent";

const urgent = sk.find<Task>("tasks", { priority: "urgent" });
const liveUrgent = liveFind<Task>(sk, "tasks", { priority: "urgent" });
```

## What the alpha demonstrates

The release demonstrates this boundary:

```text
source state rows        = durable user data
projection rows          = derived, evictable, rebuildable
observation metadata     = compactable debug/planning metadata
```

The core rule is:

```text
Magic by default. Explainable on demand. Source state is never silently deleted.
```

## Verification included

The release branch should pass:

```bash
npm run release:check
```

This includes build, tests, gate, demo, export checks, documentation checks, and package dry-run.

Benchmark observations are available separately:

```bash
npm run benchmark
```

The benchmark prints timing JSON but does not define production latency guarantees.

## Known alpha gaps

- API is not frozen.
- Full browser adapter is not implemented.
- Remote sync is not implemented.
- StorekeeperDB does not compile arbitrary JavaScript predicates into SQL.
- Automatic decay is lookup-count-based, not wall-clock-time-based.
- Full metadata scoring policy remains follow-up research.
- The package depends on Node's experimental SQLite flag.

## Documentation

Start with:

- `README.md`
- `docs/MANUAL.md`
- `docs/DEMO.md`
- `docs/BENCHMARKS.md`
- `docs/RELEASE.md`
- `docs/ALPHA_RELEASE_DECISION.md`
