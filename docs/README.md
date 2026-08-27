# StorekeeperDB documentation

StorekeeperDB is a public alpha candidate. The current priority is product refinement: use realistic scenarios, find rough edges, make the smallest justified fix, and re-verify behavior.

The current product direction is agent-oriented: reduce the persistence-specific decisions a coding agent must carry while building fast-changing TypeScript prototypes, without pretending hard persistence problems do not exist.

## Start here

- [Manual](./MANUAL.md) — current public alpha API and usage boundaries.
- [Architecture](./ARCHITECTURE.md) — runtime layers, durable-variable model, and architectural boundaries.
- [Evaluation loop](./EVALUATION_LOOP.md) — how to evaluate and refine the product during alpha.
- [Next work](./NEXT_WORK.md) — current priorities and deferred research.
- [Agent decision-burden experiment](./AGENT_DECISION_BURDEN_EXPERIMENT.md) — auditable comparison of persistence-specific implementation decisions for agent-driven prototyping.
- [Agent project convention experiment](./AGENT_PROJECT_CONVENTION_EXPERIMENT.md) — reusable declaration-layer experiment that reduces per-prototype state-key/singleton decisions in two scenarios.
- [Declaration key rename experiment](./DECLARATION_KEY_RENAME_EXPERIMENT.md) — incompatible property-rename probe comparing silent reset, fail-loudly identity tracking, one-shot aliasing, and stable ids.
- [Collection rename + projection experiment](./COLLECTION_RENAME_PROJECTION_EXPERIMENT.md) — verifies that a logical collection rename can retain one physical source/projection namespace.
- [Multi-step declaration rename experiment](./MULTI_STEP_DECLARATION_RENAME_EXPERIMENT.md) — verifies repeated logical renames retain one physical identity without accumulating rename history.
- [State split migration boundary experiment](./STATE_SPLIT_MERGE_BOUNDARY_EXPERIMENT.md) — confirms one-to-many split requires explicit value transformation, atomicity, source retirement, and metadata cleanup.
- [State merge migration boundary experiment](./STATE_MERGE_BOUNDARY_EXPERIMENT.md) — confirms many-to-one merge requires an explicit transactional transform and conflict policy when sources disagree.
- [Scalar-to-object value evolution experiment](./SCALAR_TO_OBJECT_VALUE_EVOLUTION_EXPERIMENT.md) — confirms that a static TypeScript shape change does not migrate persisted semantic representation and that explicit transform/policy is required.
- [Issue tracker evaluation](./ISSUE_TRACKER_EVALUATION.md) — realistic compatible application-shape evolution and query-to-update scenario.
- [`find()` semantics evaluation](./FIND_SEMANTICS_EVALUATION.md) — durable-handle vs snapshot decision record.
- [Change amplification experiment](./CHANGE_AMPLIFICATION_EXPERIMENT.md) — first direct-SQL comparison for compatible model evolution.
- [CLI metadata replication](./CLI_METADATA_CHANGE_AMPLIFICATION_EXPERIMENT.md) — second change-amplification scenario exposing singleton-root concept cost.
- [Root-state semantics evaluation](./ROOT_STATE_SEMANTICS_EVALUATION.md) — list-only vs singleton/object vs arbitrary-root experiment and replacement-lifetime finding.
- [Benchmarks](./BENCHMARKS.md) — reproducible observations; timings are not release guarantees.
- [Demo](./DEMO.md) — executable runtime walkthrough.

## Product and safety boundaries

- [Alpha release decision](./ALPHA_RELEASE_DECISION.md)
- [Transaction model](./TRANSACTION_MODEL.md)
- [Browser storage boundary](./BROWSER_BOUNDARY.md)
- [Release checklist](./RELEASE.md)
- [0.1.0-alpha.0 release notes](./RELEASE_NOTES_0.1.0-alpha.0.md)

## Runtime and experiments

These documents record experimental evidence and narrower runtime behavior. They are useful for understanding why a contract exists and where it has not yet generalized.

- [Agent decision-burden experiment](./AGENT_DECISION_BURDEN_EXPERIMENT.md)
- [Agent project convention experiment](./AGENT_PROJECT_CONVENTION_EXPERIMENT.md)
- [Declaration key rename experiment](./DECLARATION_KEY_RENAME_EXPERIMENT.md)
- [Collection rename + projection experiment](./COLLECTION_RENAME_PROJECTION_EXPERIMENT.md)
- [Multi-step declaration rename experiment](./MULTI_STEP_DECLARATION_RENAME_EXPERIMENT.md)
- [State split migration boundary experiment](./STATE_SPLIT_MERGE_BOUNDARY_EXPERIMENT.md)
- [State merge migration boundary experiment](./STATE_MERGE_BOUNDARY_EXPERIMENT.md)
- [Scalar-to-object value evolution experiment](./SCALAR_TO_OBJECT_VALUE_EVOLUTION_EXPERIMENT.md)
- [Change amplification experiment](./CHANGE_AMPLIFICATION_EXPERIMENT.md)
- [CLI metadata replication](./CLI_METADATA_CHANGE_AMPLIFICATION_EXPERIMENT.md)
- [Root-state semantics evaluation](./ROOT_STATE_SEMANTICS_EVALUATION.md)
- [Durable variable / session bootstrap experiment](./DURABLE_VARIABLE_EXPERIMENT.md)
- [`find()` semantics evaluation](./FIND_SEMANTICS_EVALUATION.md)
- [Magic lifecycle](./MAGIC_LIFECYCLE.md)
- [Magic re-import status](./MAGIC_REIMPORT_STATUS.md)
- [Automatic derived decay](./DECAY.md)
- [Metadata compaction](./METADATA_COMPACTION.md)
- [React verification](./REACT_VERIFICATION.md)
- [Runtime hardening](./RUNTIME_HARDENING.md)
- [Experiment summary](./EXPERIMENT_SUMMARY.md)
- [Audit notes](./AUDIT.md)

## Repository policy during alpha

Prefer small pull requests that close one observed product gap. A change should normally be justified by a realistic scenario, a failing test, a documented ambiguity, or reproducible performance evidence.

Avoid:

- presenting the alpha as production-ready;
- adding features without a demonstrated scenario;
- treating benchmark timings, decision counts, or small application experiments as general guarantees;
- implying that source annotations measure hidden model reasoning or chain-of-thought;
- implying that the experimental async boundary is a complete browser adapter;
- growing the public API when a convention, simplification, or removal would solve the same problem.

The default loop is:

1. choose a realistic usage scenario;
2. use the public API only;
3. record friction, surprise, failure, persistence-specific decision burden, documentation gaps, and performance roughness;
4. make the smallest runtime, API, test, convention, or documentation change that addresses the finding;
5. run `npm run release:check` and any scenario-specific checks;
6. record the result and uncertainty in the PR;
7. update [Next work](./NEXT_WORK.md) before generalizing the result.
