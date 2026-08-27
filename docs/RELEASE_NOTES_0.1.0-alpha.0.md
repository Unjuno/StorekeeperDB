# StorekeeperDB 0.1.0-alpha.0 release notes

StorekeeperDB is a persistent state runtime for fast local TypeScript prototype loops.

It lets application code mutate ordinary-looking arrays and objects while SQLite persists source state behind the scenes. Useful scalar lookup paths can become SQLite-backed projections when `find()` or `liveFind()` needs them.

## Highlights

- Ordinary TypeScript array/object mutation with SQLite-backed source persistence.
- Row-per-item durable source storage.
- Magic scalar lookup projections for supported `find()` calls.
- `find()` returns durable item handles in an ordinary local result array.
- `liveFind()` owns detached stable snapshots for reactive read flows.
- Removed durable handles remain readable but reject writes, preventing deleted-row resurrection.
- Failed outer batches invalidate old-generation handles after rollback.
- React adapter verified with `useSyncExternalStore` and `react-test-renderer`.
- Debug surface for explaining derived projections and lifecycle actions.
- Source-preserving projection lifecycle: mark cold, collect garbage, evict, rebuild.
- Opt-in automatic derived decay and metadata compaction.
- Experimental async write-behind durability-boundary model.
- Executable realistic scenarios, architecture experiments, demo, benchmark, and consumer smoke.

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
urgent[0]!.done = true; // durable item-handle mutation

const liveUrgent = liveFind<Task>(sk, "tasks", { priority: "urgent" });
```

## Query and reactive semantics

```text
state() item             = durable handle
find() result item       = durable handle
find() result array      = ordinary local array
liveFind() result values = detached stable snapshots
```

This means a normal query can be followed by a durable item mutation without re-querying through `state()`, while reactive consumers still receive stable previous-value snapshots.

A removed item handle is no longer writable. A handle captured before a failed outer batch is stale after rollback. Close/reopen preserves data, not JavaScript proxy identity.

## What the alpha demonstrates

```text
source state rows        = durable user data
projection rows          = derived, evictable, rebuildable
observation metadata     = compactable debug/planning metadata
```

The core rule is:

```text
Magic by default. Explainable on demand. Source state is never silently deleted.
```

The realistic issue-tracker scenario also demonstrates compatible optional JSON-field evolution without a repository layer, direct SQL, or a manual table migration in that controlled scenario. This does not eliminate incompatible-schema migration problems.

## Verification included

The release branch should pass:

```bash
npm run release:check
```

This includes build, runtime tests, deterministic scenarios/architecture experiments, export checks, documentation checks, package dry-run, and consumer install smoke.

Benchmark observations are available separately:

```bash
npm run benchmark
```

Benchmark timing output does not define production latency guarantees.

## Known gaps

- API is not frozen.
- Root `state()` is currently an array-of-objects API, not arbitrary root values.
- Full browser adapter is not implemented.
- Remote sync and distributed coordination are not implemented.
- StorekeeperDB does not compile arbitrary JavaScript predicates into SQL.
- Compatible JSON evolution does not solve incompatible type changes, field renames, or long-lived migration policy.
- Automatic decay is lookup-count-based, not wall-clock-time-based.
- Full metadata scoring policy remains follow-up research.
- The package depends on Node's experimental SQLite flag.

## Documentation

Start with:

- `README.md`
- `docs/MANUAL.md`
- `docs/ARCHITECTURE.md`
- `docs/FIND_SEMANTICS_EVALUATION.md`
- `docs/ISSUE_TRACKER_EVALUATION.md`
- `docs/EVALUATION_LOOP.md`
- `docs/BENCHMARKS.md`
- `docs/RELEASE.md`
- `docs/ALPHA_RELEASE_DECISION.md`
