# Changelog

All notable changes to StorekeeperDB will be tracked here.

## 0.1.0-alpha.0 - unreleased

Initial public alpha baseline plus iterative hardening from realistic evaluation.

### Added

- `StorekeeperDB` local synchronous SQLite runtime.
- Ordinary mutable array/object state persistence for list-of-object root state.
- Magic scalar-path lookup projections through `find()` / `liveFind()`.
- Durable item handles returned by both `state()` and `find()`.
- `signal()` and `liveFind()` for local realtime prototype flows.
- Stable detached snapshot semantics owned independently by `liveFind()`.
- Debug surface: `status()`, `inspect()`, `explain()`, and `debug()` lifecycle/metadata helpers.
- Derived projection lifecycle: mark cold, collect garbage, evict, rebuild, and opt-in automatic lookup-count-based decay.
- Metadata compaction for bounded magic logs and non-projection observations.
- Persistent handling for common array mutators: `push`, `pop`, `shift`, `unshift`, `splice`, `sort`, and `reverse`.
- Nested object and array mutation persistence.
- Loaded-memory rollback for failed outer `batch()` calls.
- Public manual, architecture notes, evaluation loop, realistic issue-tracker scenario, durable-session experiment, benchmark documentation, and alpha release notes.
- Cross-process durable-variable/bootstrap experiment through `npm run experiment:durable-session`.
- Realistic issue-tracker evolution scenario through `npm run scenario:issue-tracker`.
- Persistence-specific change-amplification experiment against minimal relational and JSON-blob SQLite baselines.
- CLI metadata replication exposing the `singleton-list-boundary` concept cost.
- Root-state semantics experiment comparing list-only, singleton/object, and explicit cell directions without changing the public runtime API.
- Consumer install smoke test through `npm run consumer:smoke`.
- Real React verification using `useSyncExternalStore` and `react-test-renderer`.
- Experimental async write-behind durability-boundary model through `@storekeeper/db/experimental`.
- GitHub Actions CI running the complete release gate.

### Hardened

- Failed outer `batch()` calls invalidate item and nested handles captured from the old loaded generation.
- Removed item handles can still be read as detached JavaScript references but cannot write deleted rows back into persistence.
- Nested handles captured from removed items obey the same root-membership write rule.
- Reorder preserves durable item-handle identity inside the current loaded generation.
- `find()` returns a new local result array containing durable item handles; modifying result-array membership does not modify durable source membership.
- `liveFind()` explicitly clones/stores detached snapshots so prior snapshots do not alias mutable durable handles and suppress content-change notifications.
- React external-store snapshot identity remains stable between changes and advances only when reactive content changes.
- Projection cells are removed when a scalar path disappears.
- Supported array mutators are covered by projection and reopen tests.
- Nested object/array mutation persistence is covered by reopen tests.
- Signal subscribers receive one notification after an outer batch commit.
- Derived projections can be cold-marked, garbage-collected, budget-limited, automatically budget-collected, and rebuilt from source rows.
- Automatic derived GC protects the lookup path used by the current `find()` call from the same collection pass.
- Metadata compaction preserves source rows, projection cells, and projection-backed observations.
- Benchmark script performs semantic pass/fail checks while keeping latency observational.
- Release checks run the cross-process durable-session experiment, change-amplification experiments, root-state semantics probes, and realistic issue-tracker scenario.
- Release checks install the generated tarball into a temporary consumer project and verify public subpath imports.
- Release checks inspect key alpha wording and documented semantic boundaries before packaging.
- README and next-work documentation prioritize realistic evaluation over promotion or speculative feature growth.

### Evaluation decisions

- Compatible issue-model evolution passed without a repository layer, direct SQL, or a manual table migration in that scenario.
- Detached `find()` results were rejected as the preferred command/query contract. The selected hybrid contract is:

```text
state() item             -> durable handle
find() result item       -> durable handle
find() result array      -> ordinary local array
liveFind() result values -> detached stable snapshots
```

- Removed-handle invalidation and reactive snapshot separation were fixed before changing `find()`.
- First change-amplification experiment: StorekeeperDB persistence-specific changed lines were 8 vs 14 for the strongest JSON-blob baseline; concept count was tied 4 vs 4. This is candidate evidence, not a general benchmark.
- CLI metadata replication: StorekeeperDB persistence-specific changed lines were 8 vs 12 for JSON-blob SQLite, but concept count was worse 5 vs 4 because one logical record required the `singleton-list-boundary`.
- Root-state semantics experiment CI #128 selected `PREFER_NARROW_SINGLETON_OBJECT_PROTOTYPE` as the current candidate direction. A public API has not been added.
- The same root-state experiment rejected broad raw arbitrary-root `state()` generalization as unjustified: JavaScript primitive values cannot provide mutation-by-reference durability without an explicit cell/get-set/replacement model.
- Root-state replacement probing exposed #42: a displaced old item proxy can currently remain writable when direct replacement reuses its durable id, causing loaded-memory/durable divergence. Runtime hardening takes priority over new root APIs.

### Boundaries

- This is an alpha baseline, not the full pre-repo experiment history.
- Root `state()` is currently an array-of-objects API, not arbitrary root values.
- Current durable item writability combines loaded generation and durable-id membership; #42 demonstrates that direct replacement also requires exact current-proxy invalidation semantics.
- Close/reopen preserves durable data, not JavaScript proxy identity.
- Compatible optional-field evolution is separate from incompatible schema migration semantics.
- Durable-session `__workspace` is an experiment convention, not a reserved core API.
- The durable-variable experiment does not implement agent memory, checkpoint policy, trust, context selection, or multi-agent coordination.
- Full browser adapter is not implemented.
- Browser-style async storage is modeled as write-behind; mutation return means memory changed, while `flush()` is the durability barrier.
- Automatic derived decay is opt-in and currently lookup-count-based, not wall-clock-time-based.
- Benchmark timings are observational and intentionally outside hard release latency gates.
- Alpha publishing remains manual and should use the `alpha` npm dist-tag only.
- Consumer smoke verifies local tarball install behavior, not npm registry behavior.
- Time-based decay and richer metadata scoring remain deferred unless realistic product evaluation demonstrates they block the core value proposition.
- API is not frozen.
