# Magic lifecycle

StorekeeperDB's public alpha now includes the first re-imported piece of the pre-repo v20-v22 magic lifecycle work.

The rule remains:

> Source state is not silently deleted. Rebuildable derived structures may be removed and rebuilt.

## What is covered

The initial lifecycle pass covers SQLite-backed scalar lookup projections created by `find()` / `liveFind()`.

```text
source state rows
  -> scalar path projection
  -> hot / cold lifecycle state
  -> debug garbage collection
  -> rebuild from source state
```

## Debug API

```ts
const debug = sk.debug();

debug.derivations("tasks");
debug.markCold("tasks", ["priority"]);
debug.collectGarbage({ stateKey: "tasks" });
debug.collectGarbage({ stateKey: "tasks", maxDerivations: 2 });
debug.evict("tasks", ["priority"]);
debug.rebuild("tasks", ["priority"]);
```

## Lifecycle states

| State | Meaning |
| --- | --- |
| `hot` | Projection is materialized and recently used. |
| `cold` | Projection is materialized but marked collectible. |
| evicted | Projection cells and derivation row are removed; source rows remain. |

The current alpha does not keep `evicted` derivation rows in `__sk_derivations`, because lookup planning treats an existing derivation row as active. Eviction is therefore represented by the absence of the projection derivation.

## Garbage collection options

```ts
sk.debug().collectGarbage({ stateKey: "tasks" });
```

Evicts cold derived projections for a state.

```ts
sk.debug().collectGarbage({ stateKey: "tasks", force: true });
```

Evicts all matching derived projections immediately.

```ts
sk.debug().collectGarbage({ stateKey: "tasks", maxDerivations: 2 });
```

Keeps at most two active projection derivations. Candidates are sorted so cold, low-use, and larger projections are removed first.

```ts
sk.debug().collectGarbage({ stateKey: "tasks", markCold: true });
```

Marks remaining active projections as cold without deleting source rows.

## What is not covered yet

This pass intentionally does not re-import every v22 feature.

Still pending:

- automatic time-based decay
- automatic periodic GC
- metadata score decay
- projection-cell storage budgets
- persistent `evicted` lifecycle records

Those should be added in smaller follow-up PRs rather than forcing all v22 machinery into one public-alpha change.
