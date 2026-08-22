# Automatic derived decay

StorekeeperDB separates source state from rebuildable derived structures.

The public alpha now supports a small automatic decay policy for derived projection storage. This is intentionally narrower than the full pre-repo v21/v22 experiment: it only runs after `find()` calls and only touches derived projections.

## Source state is not garbage-collected

Automatic decay does not delete source rows in `__sk_items`.

It may remove:

- projection cells in `__sk_projection`
- projection lifecycle rows in `__sk_derivations`
- related debug magic log entries are still retained unless compacted separately

The next supported `find()` can rebuild an evicted projection from source rows.

## API shape

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

Options:

| Option | Meaning |
| --- | --- |
| `enabled` | Turns automatic derived GC on. Defaults to `false` in the public alpha. |
| `collectEveryFinds` | Runs derived GC after every N `find()` calls. |
| `maxDerivations` | Keeps at most this many active projection derivations for the state being queried. |
| `markCold` | Marks surviving projection derivations `cold` after collection. |

## Current lookup protection

Automatic decay protects the path used by the current `find()` call from the same GC pass.

This avoids the confusing case where a lookup creates or touches a projection and immediately evicts that exact projection before the caller can inspect it.

## What this is not

This is not yet the full v22 lifecycle system.

Still follow-up work:

- time-based decay
- periodic background GC
- projection cell budget by estimated storage cost
- observation metadata compaction
- richer lifecycle scoring

## Debug interop

Automatic decay uses the same lifecycle machinery as manual debug APIs:

```ts
sk.debug().derivations("tasks");
sk.debug().markCold("tasks", ["priority"]);
sk.debug().collectGarbage({ stateKey: "tasks", maxDerivations: 2 });
```

The core rule remains:

```text
source state rows are durable
projection rows are derived and rebuildable
```
