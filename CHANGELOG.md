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
- Release checks run the cross-process durable-session experiment and realistic issue-tracker scenario.
- Release checks install the generated tarball into a temporary consumer project and verify public subpath imports.
- Release checks inspect key alpha wording and documented semantic boundaries before packaging.
- README and next-work documentation prioritize realistic evaluation over promotion or speculative feature growth.

### Evaluation decisions

- The initial issue-tracker evaluation showed that compatible optional JSON-field additions can evolve without a repository layer, direct SQL, or a manual table migration in that scenario.
- The same scenario exposed detached `find()` results as a least-surprise problem.
- A focused A/B/C experiment rejected snapshot-only `find()` as the preferred contract and did not justify adding a second public snapshot-query API.
- The selected hybrid contract is:

```text
state() item             -> durable handle
find() result item       -> durable handle
find() result array      -> ordinary local array
liveFind() result values -> detached stable snapshots
```

- Two blockers were fixed before changing `find()`: removed-handle invalidation and reactive snapshot separation.
- The next product experiment is persistence-specific change amplification against a minimal direct-SQL baseline.

### Boundaries

- This is an alpha baseline, not the full pre-repo experiment history.
- Root `state()` is currently an array-of-objects API, not arbitrary root values.
- Durable item handles are writable only while their item id remains a member of the current loaded state generation.
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
