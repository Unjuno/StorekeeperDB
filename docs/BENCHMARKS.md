# Benchmarks

StorekeeperDB's public alpha now includes an executable benchmark script.

The benchmark is not a synthetic database leaderboard. It is a repeatable product-runtime check for the behaviors this package claims:

- ordinary TypeScript array/object mutation
- row-per-item SQLite persistence
- scalar lookup projection creation through `find()`
- repeated projected lookup
- `liveFind()` update behavior
- metadata compaction
- reopen and lookup from persisted source rows

## Run

```bash
npm run benchmark
```

The script builds the package and runs:

```bash
node --experimental-sqlite dist/scripts/benchmark.js
```

CI runs the same script through:

```bash
npm run benchmark:check
```

`benchmark:check` does not enforce speed thresholds. It enforces semantic invariants and prints timings.

## Output shape

The script prints JSON.

Important fields:

```json
{
  "benchmark": "storekeeperdb-alpha-runtime",
  "node": "...",
  "n": 3000,
  "timingsMs": {
    "insertBatch": 0,
    "firstPriorityLookup": 0,
    "repeatedPriorityLookup": 0,
    "compactMetadata": 0,
    "reopenPriorityLookup": 0
  },
  "counts": {
    "initialUrgent": 30,
    "liveRenders": 1,
    "reopenedLength": 3000
  },
  "storage": {
    "priorityBeforeClose": "projection"
  },
  "pass": true
}
```

## How to read the numbers

### `insertBatch`

Measures inserting ordinary JavaScript objects through `tasks.push(...)` inside one outer `batch()`.

This is the write path StorekeeperDB optimizes for local prototype loops: app code mutates ordinary state, while the runtime persists row-per-item source state behind the scenes.

### `firstPriorityLookup`

Measures the first supported scalar lookup:

```ts
sk.find<Task>("tasks", { priority: "urgent" });
```

This includes the cost of creating the projection for the `priority` path if it does not already exist.

### `repeatedPriorityLookup`

Measures repeated supported lookups after projection exists.

This is the intended hot lookup path. It should not be interpreted as arbitrary JavaScript predicate performance.

### `liveRenders`

Confirms `liveFind()` emits once for a relevant mutation and does not emit for an unrelated mutation in the benchmark scenario.

### `compactMetadata`

Measures debug/planning metadata compaction:

```ts
sk.debug().compactMetadata({
  maxMagicLogEntries: 25,
  pathCountDecayFactor: 0.5,
  dropPathStatsBelow: -1,
});
```

This is not source-data GC and not projection GC.

### `reopenPriorityLookup`

Confirms source rows survived close/reopen and that lookup remains correct after reopening the SQLite file.

## What this benchmark does not claim

It does not claim:

- production database performance
- browser storage performance
- remote synchronization performance
- arbitrary JavaScript predicate compilation
- stable cross-machine latency numbers

It is a regression-facing alpha benchmark. The useful signal is the trend over time on the same machine or in the same CI environment.

## Current CI posture

CI runs the benchmark as part of `release:check`.

The benchmark fails CI only when semantic invariants fail, for example:

- source rows are not preserved
- projected lookup returns the wrong count
- `liveFind()` emits the wrong number of updates
- reopen lookup is incorrect

Latency is printed but not used as a hard release gate yet.
