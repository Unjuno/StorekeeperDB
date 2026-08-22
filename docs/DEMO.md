# Demo

StorekeeperDB needs a demonstration that shows the product rule directly:

> Magic by default. Explainable on demand. Source state is never silently deleted.

Run the executable demo:

```bash
npm run demo
```

The demo creates a temporary SQLite database, mutates ordinary TypeScript state, then prints each stage as JSON.

## What it demonstrates

1. Ordinary source state is created as array/object state.
2. `find()` starts with JSON source rows and automatically creates a scalar lookup projection.
3. `liveFind()` updates after an ordinary mutation.
4. `debug().evict()` removes a derived projection.
5. Another `find()` rebuilds the projection.
6. Source state remains present the whole time.

## Expected shape

The exact timings are not part of the contract. The important shape is:

```json
{
  "step": "1_source_state_created",
  "itemCount": 250,
  "priorityStorage": "json_only"
}
```

```json
{
  "step": "2_find_created_projection",
  "urgentCount": 10,
  "priorityStorage": "projection"
}
```

```json
{
  "step": "4_debug_evict_removed_projection",
  "priorityStorage": "json_only",
  "sourceItemsStillThere": 251
}
```

```json
{
  "step": "5_find_rebuilt_projection",
  "urgentCount": 11,
  "priorityStorage": "projection",
  "sourceItemsStillThere": 251
}
```

The final summary should end with:

```json
{
  "step": "6_summary",
  "pass": true
}
```

## Why this demo exists

README examples show how the API looks. This demo shows the actual runtime behavior:

```text
ordinary TypeScript mutation
  -> SQLite source state
  -> automatic projection
  -> live lookup update
  -> debug eviction
  -> rebuild from source state
```

This is intentionally local and synchronous. Browser storage has a separate durability boundary and is not demonstrated here.
