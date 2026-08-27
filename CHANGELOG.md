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
- Singleton-object surface experiment comparing current list syntax, paired object state/signal helpers, and a combined handle without changing exports.
- Agent persistence decision-burden experiment comparing relational SQLite, JSON-blob SQLite, and StorekeeperDB through auditable `@decision` markers.
- Agent-facing project-convention experiment reusing one generic declaration layer across project-board and editor/workspace scenarios without changing public exports.
- Declaration-property rename experiment comparing naive property-derived keys, fail-loudly identity tracking, one-shot rename aliasing, and stable durable ids without changing public exports.
- Collection-rename projection experiment verifying logical list rename while retaining one physical source/projection namespace.
- Multi-step declaration-rename experiment verifying repeated logical renames retain one physical identity and one current manifest binding.
- Consumer install smoke test through `npm run consumer:smoke`.
- Real React verification using `useSyncExternalStore` and `react-test-renderer`.
- Experimental async write-behind durability-boundary model through `@storekeeper/db/experimental`.
- GitHub Actions CI running the complete release gate.

### Hardened

- Failed outer `batch()` calls invalidate item and nested handles captured from the old loaded generation.
- Removed item handles can still be read as detached JavaScript references but cannot write deleted rows back into persistence.
- Direct item replacement now invalidates the displaced item proxy and nested handles even when the replacement intentionally reuses the same durable row id.
- Writable handles now require current loaded generation, current durable-id membership, and exact current proxy identity.
- Reorder preserves durable item-handle identity because it moves the same proxy rather than replacing it.
- Replacement regression verifies the new proxy remains writable while loaded memory and reopened SQLite state stay identical.
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
- Release checks run the cross-process durable-session experiment, change-amplification experiments, root-state/singleton probes, agent decision-burden experiment, agent project-convention experiment, declaration-key rename experiment, collection-rename projection experiment, multi-step declaration-rename experiment, and realistic issue-tracker scenario.
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
- Root-state semantics experiment CI #128 selected `PREFER_NARROW_SINGLETON_OBJECT_PROTOTYPE` as the current candidate direction. Broad raw arbitrary-root `state()` generalization was not supported.
- Root-state replacement probing exposed #42. PR #43 hardened exact proxy identity; CI #136 revalidated the root-state experiment with old replacement-handle writes rejected and memory/durable divergence removed.
- Singleton-object surface experiment CI #144 produced `NO_CLEAR_WINNER` and `NO_API_CHANGE_FROM_THIS_EXPERIMENT`: removing `[0]` ceremony alone did not justify permanent public methods.
- Product evaluation focus was therefore moved from source-character minimization toward **agent-visible persistence decision burden**.
- Agent decision-burden experiment CI #147 conservatively measured 8 decisions for relational SQLite, 8 for JSON-blob SQLite, and 7 for StorekeeperDB; persistence-marked source lines were 19, 25, and 14 respectively.
- The Storekeeper count was deliberately corrected upward from an initial 6 to 7 by adding `compatible-state-evolution`, avoiding a favorable classification mismatch with the JSON-blob baseline.
- The agent decision result is candidate evidence that StorekeeperDB can move some schema/bootstrap/serialization/write-plumbing choices behind the runtime. It is not a measurement of hidden chain-of-thought or a general productivity guarantee.
- `singleton-list-adaptation` remained an explicit StorekeeperDB decision cost after #46.
- Agent project-convention experiment CI #159 reused one generic helper unchanged across project-board and editor/workspace scenarios and reduced per-prototype decisions from 7 to 5 in both; persistence-marked lines changed from 14 to 8 in both.
- PR #49 was finalized by CI #165 and squash-merged as `881782341562ce070e65a300beb51a90784434a8`.
- The reusable convention reports two agent-facing concepts (`project-store`, `shape-descriptor`) and four internal mechanisms separately; helper implementation cost is not treated as free.
- The convention candidate removes feature-level `state-keying` and `singleton-list-adaptation` by deriving keys from declaration property names and adapting singleton objects internally.
- The exact `openProjectStore/list/object` API is **not** authorized for export. The result supports a project-level architecture direction only.
- Property-name-derived durable keys make declaration-property rename persistence-significant. The rename experiment confirmed this is a real hard boundary rather than a documentation concern.
- Declaration-key rename negative control CI #168 confirmed that naive `settings -> preferences` silently initializes fresh `preferences` state while leaving old physical `settings` state behind, producing duplicate physical state identities.
- Fail-loudly identity-manifest candidate rejected the unexplained rename before new state creation and preserved the old declaration state.
- One-shot explicit rename-alias candidate preserved the old value, avoided duplicate physical source state, persisted the logical `preferences -> physical "settings"` binding, and reopened later without repeating the alias.
- Stable durable-id candidate also preserved state but requires one explicit identity decision on the ordinary compatible path from V1.
- After correcting an A/B decision-marker classification mismatch, CI #168 selected `CANDIDATE_PREFER_EXPLICIT_RENAME_ALIAS_WITH_IDENTITY_MANIFEST`.
- Candidate rename alias is an incompatible-boundary decision, not evidence for automatic migration. The alias does not physically rename the StorekeeperDB state key.
- Collection rename with active `priority` projection passed in CI #175: logical `tasks -> workItems` retained physical key `tasks`, projection cells stayed 2 -> 2, no `workItems` source/path/projection/derivation rows appeared, and post-rename projected-field mutation remained durable and index-consistent.
- CI #175 selected `CANDIDATE_PASS_LOGICAL_RENAME_PRESERVES_PHYSICAL_DERIVED_STATE`; final synchronized gate CI #181 passed and PR #53 merged as `338c3897b92defd20e1335809ba4785bf14ded68`.
- The collection result shows projection migration was unnecessary when physical identity remained stable; it does not authorize physical key renaming or compaction.
- Multi-step rename chain CI #183 passed `settings -> preferences -> configuration` while retaining physical key `settings` and a final manifest containing only `configuration -> settings`.
- Missing alias, stale original alias, nonexistent alias source, object/list kind mismatch, and an expired previous logical source all failed loudly in CI #183; after each rejected attempt the current value and manifest remained intact.
- CI #183 selected `CANDIDATE_PASS_MULTI_STEP_RENAME_RETAINS_SINGLE_PHYSICAL_IDENTITY`.
- The multi-step result supports the identity manifest as a current logical-to-physical binding rather than a rename-history registry for the tested one-state chain.
- Split/merge and incompatible value transformation remain outside the one-to-one alias result and are the next hard migration boundary to test.
- The convention's query wrapper was explicitly narrowed to StorekeeperDB's existing scalar-predicate `find()` contract after CI #158 exposed an overly broad prototype type.

### Boundaries

- This is an alpha baseline, not the full pre-repo experiment history.
- Root `state()` is currently an array-of-objects API, not arbitrary root values.
- Durable item writability requires current loaded generation, durable-id membership, and exact current proxy identity.
- Close/reopen preserves durable data, not JavaScript proxy identity.
- Compatible optional-field evolution is separate from incompatible schema migration semantics.
- Decision-burden annotations are an auditable implementation proxy, not access to model chain-of-thought, reasoning tokens, or a universal cognitive metric.
- Reusable framework concepts and per-prototype persistence decisions are reported separately; amortization does not make framework machinery free.
- Deriving durable keys from declaration property names reduces normal key bookkeeping but makes property rename an incompatible persistence boundary unless alias/migration identity is specified.
- The identity-manifest candidate currently behaves as a narrow current logical-to-physical binding for one-to-one renames; it does not establish general schema-management semantics.
- Previous logical rename names are consumed rather than accumulated in the tested multi-step chain.
- Logical rename retains the old physical StorekeeperDB key and therefore retains source and derived metadata in that physical namespace.
- One-to-one rename evidence does not authorize state split/merge, arbitrary value transformation, or source retirement by inference.
- Automatic heuristic rename, split, or merge inference from shape, content, or declaration order is not supported.
- The agent-first direction does not authorize hiding incompatible migrations, key renames, corruption, concurrent writers, transaction failures, or durability uncertainty.
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
