# StorekeeperDB experiment summary

This document summarizes the pre-repository experiment line up to v22.

## Product rule

**Magic by default. Explainable on demand. Source state is never silently deleted.**

## Core concept

StorekeeperDB is a persistent TypeScript state runtime for fast AI prototypes:

```text
ordinary TypeScript state
  -> proxy mutation capture
  -> SQLite source state
  -> path observation
  -> magic derivation
  -> projection / live lookup
  -> decay / eviction / rebuild
  -> metadata compaction
```

The application does not design tables, columns, migrations, or indexes. It mutates ordinary arrays and objects. StorekeeperDB persists the source state and creates rebuildable derived lookup structures when useful.

## Current validated behavior

The v22 local experiment passed 42 tests in the container. The validated areas were:

- ordinary TypeScript array/object mutation
- row-per-item SQLite persistence
- reopen recovery
- nested object and array mutation
- safe loud failures for shape-breaking operations
- signal snapshots and batched notifications
- failed batch rollback for database, memory, path stats, and notifications
- live views and live lookup
- safe scalar-path automatic projection
- magic derivation lifecycle: auto create, hot, cold, evict, rebuild
- storage budget based derived projection eviction
- metadata compaction for magic logs and path observations
- inspect / explain / status debug APIs
- package boundary shape: core, node, react, experimental

## Boundaries

StorekeeperDB does not claim to compile arbitrary JavaScript predicates into SQL.

```ts
const high = tasks.filter((task) => task.priority === "high");
```

That remains in-memory JavaScript. The supported large-list lookup path is:

```ts
const high = sk.find<Task>("tasks", { priority: "high" });
```

## Not complete

- real React DOM render testing
- browser adapter
- final public API freeze
- production benchmark suite
- package publishing pipeline

## Next implementation step

Import the v22 source tree into this repository, then keep the initial implementation behind an alpha tag until React and browser boundary tests are complete.
