# Metadata compaction

StorekeeperDB separates source state from rebuildable metadata.

```text
source rows              = durable state, never removed by metadata compaction
projection cells         = derived lookup state, not removed by metadata compaction
path observations        = debug/planning metadata, can decay or be dropped
magic log                = recent debug trace, can be trimmed
```

## Debug API

```ts
const result = sk.debug().compactMetadata({
  maxMagicLogEntries: 500,
  pathCountDecayFactor: 0.5,
  dropPathStatsBelow: 1,
  stateKey: "tasks",
});
```

Result:

```ts
type StorekeeperMetadataCompactionResult = {
  magicLogsDeleted: number;
  pathsDecayed: number;
  pathsDeleted: number;
};
```

## What can be removed

`compactMetadata()` may remove:

- older `__sk_magic_log` rows beyond `maxMagicLogEntries`
- non-projection path observations whose read/write counts fall below `dropPathStatsBelow`

It does not remove:

- `__sk_items` source rows
- `__sk_projection` cells
- path observations that are backed by active projection derivations

## Why projection-backed observations stay

A projected path still matters for query planning and debugging. Even if observation counts decay to zero, StorekeeperDB keeps the path row while a matching projection derivation exists.

## Backward-compatible shorthand

The old form still trims only the magic log:

```ts
sk.debug().compactMetadata(100);
```

This is equivalent to keeping the latest 100 magic log entries while leaving path observations untouched.

## Boundary

This is not source-data garbage collection. It is debug/planning metadata compaction. If a future policy wants to evict projections, it should use derived lifecycle GC rather than metadata compaction.
