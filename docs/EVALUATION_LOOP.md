# Alpha evaluation loop

StorekeeperDB is in an alpha hardening / product refinement phase. The goal is not to maximize feature count or polish promotional language. The goal is to expose and remove friction in realistic use.

## Product hypothesis

StorekeeperDB should reduce the amount of persistence-specific design work required while an application is changing quickly.

A successful scenario should let application code evolve without forcing the developer to design tables, columns, repository layers, migrations, or indexes before those concerns are actually needed.

This does not mean storage complexity disappears. Transaction semantics, schema evolution, durability, concurrency, indexing, recovery, and unsupported shape changes must remain explicit when they matter.

The design rule is:

> Simple persistence should feel automatic. Hard persistence problems must remain observable and controllable.

## Evaluation loop

For each iteration:

1. Choose one realistic usage scenario.
2. Implement it with the documented public API only.
3. Record every rough edge before fixing it.
4. Classify each finding.
5. Make the smallest justified runtime, API, test, or documentation change.
6. Re-run the scenario and regression checks.
7. Record what changed, what remains uncertain, and what should be evaluated next.

Do not add speculative features merely because a scenario could use them. Prefer simplification, clearer naming, earlier failure, or better documentation when those solve the observed problem.

## Finding taxonomy

### API friction

The task is possible, but the public API requires unnecessary ceremony, repeated arguments, awkward type assertions, or knowledge of internal structure.

Default response: simplify or consolidate before adding another API.

### Surprise

Observed behavior differs from what the public API name, type, or documentation reasonably suggests.

Default response: treat as high priority. Either change the behavior or make the boundary explicit.

### Missing guard

Invalid or unsupported input fails late, fails unclearly, or produces partially applied state.

Default response: fail earlier and add a regression test.

### Documentation gap

A normal user must read implementation code or historical PRs to understand supported behavior.

Default response: improve the manual or boundary documentation.

### Test gap

A realistic supported flow is not protected by regression coverage.

Default response: add the smallest test that captures the contract.

### Performance roughness

A plausible workload shows unexpectedly high cost.

Default response: reproduce under controlled conditions before optimizing. Benchmark observations are evidence, not guarantees.

### Scope ambiguity

It is unclear whether a behavior belongs to the supported alpha surface, an experimental surface, or future work.

Default response: clarify the boundary before implementation.

## Scenario rules

A scenario should:

- represent a plausible small application rather than a synthetic API showcase;
- use public package entrypoints only;
- include persistence across reopen when durability is part of the scenario;
- include at least one application-shape change or non-happy-path operation when relevant;
- avoid internal imports and scenario-specific workarounds;
- stay small enough that friction is attributable to StorekeeperDB rather than application complexity.

Good initial scenarios include:

- an issue tracker whose item shape evolves during implementation;
- local CLI metadata with reopen and update flows;
- a prototype cache with indexed scalar lookup needs;
- a small application that changes nested state shape between iterations.

## Evidence to record

For each scenario, record at least:

- StorekeeperDB version / commit;
- Node version and required runtime flags;
- scenario description;
- public APIs used;
- persistence-specific files or code introduced;
- workarounds or internal knowledge required;
- runtime failures or surprising behavior;
- documentation gaps;
- tests added or changed;
- validation commands and results.

When comparing design alternatives, also record touched files and persistence-specific change size. The purpose is to measure change amplification, not merely total source lines.

## Hypothesis and decision template

### H — hypothesis

State a falsifiable product claim for the scenario.

Example:

> A small issue tracker can change its persisted item shape without introducing a separate repository layer or undocumented migration workaround.

### T — minimum test

Define the minimum environment and data needed to exercise the claim. Keep it small enough to run repeatedly.

Typical baseline:

- clean install;
- `npm run build`;
- relevant tests;
- executable realistic scenario;
- `npm run consumer:smoke` when package boundaries are involved;
- `npm run release:check` before merge.

Run benchmarks only when the finding is performance-related or the change plausibly affects benchmarked behavior.

### D — decision

PASS when the scenario completes through documented public behavior, regression checks pass, and observed rough edges are either fixed or explicitly documented.

FAIL when the scenario requires internal imports, silent corruption, undocumented recovery steps, or behavior that contradicts the public contract.

UNCERTAIN when the evidence cannot separate StorekeeperDB behavior from environment noise, backend-specific behavior, or scenario bias.

### C — competing explanation

Always record at least one plausible alternative explanation.

Examples:

- the scenario is too tailored to StorekeeperDB;
- the comparison implementation is over-engineered;
- the apparent API improvement only moves complexity into hidden runtime behavior;
- a performance difference is caused by SQLite warmup, filesystem state, or test sizing rather than the change.

### U — uncertainty

List major uncertainty sources. For timing work, include hardware, Node version, SQLite backend/flag, dataset size, warmup, repetitions, and summary statistic. Do not present a single local timing as a performance guarantee.

## Merge standard

An alpha refinement PR should normally satisfy all of the following:

- one observed problem or one tightly related group of problems;
- a scenario, failing test, documented ambiguity, or reproducible measurement that justifies the change;
- no unnecessary public API growth;
- regression coverage for changed behavior;
- documentation updated when the public boundary changes;
- `npm run release:check` passes on the final head;
- the PR description states what was learned, not only what code was changed.

## Current direction

The next evaluation work should prioritize realistic application evolution over lifecycle feature expansion. Time-based decay and richer metadata scoring remain valid research topics, but they should not displace product-friction work unless a realistic scenario demonstrates that they are blocking the core value proposition.
