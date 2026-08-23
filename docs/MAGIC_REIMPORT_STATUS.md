# Magic lifecycle re-import status

This document records the public-alpha stopping point for issue #6.

The pre-repo v20-v22 experiments validated a richer magic lifecycle for StorekeeperDB: derived projection lifecycle, hot/cold state, eviction, rebuild, derived storage budgets, automatic decay, and metadata compaction.

The public alpha now re-imports the conservative subset that can be explained and tested without overclaiming production database behavior.

## Implemented in public alpha

### Manual derived lifecycle

Implemented:

- `debug().derivations(stateKey)`
- `debug().markCold(stateKey, paths)`
- `debug().collectGarbage(options)`
- `debug().evict(stateKey, paths)`
- `debug().rebuild(stateKey, paths)`

Meaning:

- Projection rows are derived information.
- Derived projections can be marked cold.
- Cold or budget-excess projections can be evicted.
- Evicted projections can be rebuilt from source rows.
- Source rows are not deleted by derived lifecycle GC.

### Opt-in automatic derived decay

Implemented:

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

Meaning:

- Automatic decay is off by default.
- When enabled, it runs synchronously after configured `find()` intervals.
- It only touches rebuildable derived projection state.
- The current lookup path is protected during the same GC pass.
- Source rows are not deleted.

### Metadata / observation compaction

Implemented:

```ts
sk.debug().compactMetadata({
  maxMagicLogEntries: 500,
  pathCountDecayFactor: 0.5,
  dropPathStatsBelow: 1,
  stateKey: "tasks",
});
```

Meaning:

- Magic logs can be trimmed to the latest N entries.
- Path observation counts can be decayed.
- Low-value non-projection observations can be deleted.
- Projection-backed observations are preserved.
- Source rows and projection cells are not removed by metadata compaction.

## Issue #6 acceptance status

Issue #6 asked for gradual re-import of:

1. derivation state transitions
2. debug-visible eviction / rebuild metadata
3. derived storage budget
4. automatic derived eviction
5. magic log and observation metadata compaction

Public alpha coverage:

| Requirement | Status |
|---|---|
| derivation state transitions | implemented |
| debug-visible eviction / rebuild metadata | implemented |
| derived storage budget | implemented through `maxDerivations` |
| automatic derived eviction | implemented through opt-in lookup-count decay |
| magic log and observation metadata compaction | implemented through `debug().compactMetadata()` |

## Explicitly deferred

The following are not part of issue #6 closure and are tracked separately:

- Time-based lifecycle decay: #16
- Richer metadata scoring policy: #17

These are intentionally separate because they require more policy design. The public alpha should not silently introduce background behavior or scoring heuristics that are difficult to explain.

## Product boundary

The current rule remains:

```text
source state rows      = source of truth, do not silently delete
projection rows        = derived, can be evicted and rebuilt
observation metadata   = debug/planning metadata, can be compacted
magic log              = recent debug trace, can be trimmed
```

This is the public-alpha boundary for StorekeeperDB's magic lifecycle re-import.
