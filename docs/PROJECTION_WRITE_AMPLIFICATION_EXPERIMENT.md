# Projection-maintenance write amplification experiment

Status: **MEASURED in CI #258; experiment-only.**

Issue: #76  
PR: #77

This experiment follows the partial-row field-deletion result from #74. That experiment established that projection maintenance stays correct and isolated to the changed durable item, but it also exposed an item-local projection rebuild. This experiment measures the rebuild directly as active projected-path count grows.

No runtime optimization or public API change is authorized by this result.

## H — falsifiable hypothesis

Let:

| Variable | Meaning | Unit |
|---|---|---|
| `P` | active projected scalar paths on the changed item | paths/item |
| `D(P)` | projection-row deletes caused by one item mutation | deletes/op |
| `I(P)` | projection-row inserts caused by one item mutation | inserts/op |
| `U(P)` | projection-row updates caused by one item mutation | updates/op |
| `W(P)` | total projection-row writes caused by one item mutation | writes/op |
| `t(P)` | mutation wall time | ms/op |

If StorekeeperDB rebuilds every active projection cell for the changed item, then for a one-field replacement where all projected scalar paths remain present:

```text
D(P) = P
I(P) = P
U(P) = 0
W(P) = D(P) + I(P) + U(P) = 2P
```

A cell-selective implementation would instead require `O(1)` projection-row writes for a one-field mutation.

## T — controlled experiment

Measured projected-path counts:

```text
P = 1, 4, 16, 64
```

For each `P`, the experiment uses two fresh databases.

### Deterministic write-count plane

1. create one durable item with at least `P` independent scalar fields;
2. activate exactly `P` projections using normal `find()` calls;
3. install experiment-only SQLite triggers on `__sk_projection` after setup;
4. replace one scalar field through the normal durable item handle;
5. count projection DELETE / INSERT / UPDATE operations;
6. verify source state, projection values, query result, and close/reopen correctness.

### Observational timing plane

A separate fresh database is used without audit triggers:

1. activate the same `P` projections;
2. perform 20 warmup mutations;
3. perform 80 timed mutations using `process.hrtime.bigint()`;
4. report min / median / p90 / max.

Timing is observational only. No latency value is a release threshold.

## D — observed result

CI #258 selected:

```text
MEASURED_LINEAR_ITEM_REBUILD_WRITES_TIMING_OBSERVATIONAL
```

Deterministic checks:

```text
deterministicCorrectness       true
exactTwoWritesPerProjectedPath true
constantWriteRatio             true
validExperiment                true
```

### Projection-row writes

| `P` paths/item | deletes/op | inserts/op | updates/op | `W(P)` writes/op |
|---:|---:|---:|---:|---:|
| 1 | 1 | 1 | 0 | 2 |
| 4 | 4 | 4 | 0 | 8 |
| 16 | 16 | 16 | 0 | 32 |
| 64 | 64 | 64 | 0 | 128 |

The measured relation is exactly:

```text
W(P) = 2P
```

in this scenario.

Numerical example:

```text
P = 16 paths/item
D = 16 deletes/op
I = 16 inserts/op
U = 0 updates/op
W = 16 + 16 + 0 = 32 writes/op
```

Unit check:

```text
paths/item × projection-row operations/path
= projection-row operations/item mutation
= writes/op
```

This also explains the previous partial-row deletion observation. If one of `P` projected fields is deleted rather than replaced, that removed path has no reinsertion, so the current implementation signature is:

```text
W_delete(P) = P + (P - 1) = 2P - 1
```

For #74, `P = 2`:

```text
W_delete(2) = 2×2 - 1 = 3 writes/op
```

which matches `queue DELETE + INSERT` plus `legacyTag DELETE`.

### Timing observations from CI #258

Environment: GitHub Actions runner used by CI #258. Audit triggers were **not** installed in the timing databases.

| `P` | min ms/op | median ms/op | p90 ms/op | max ms/op |
|---:|---:|---:|---:|---:|
| 1 | 0.057057 | 0.069854 | 0.072518 | 0.164740 |
| 4 | 0.102011 | 0.107198 | 0.116408 | 0.124949 |
| 16 | 0.323317 | 0.332356 | 0.348787 | 0.526591 |
| 64 | 1.218089 | 1.328050 | 1.354407 | 1.381908 |

These measurements are useful only as observations under this environment and workload. They do not establish a production latency guarantee or a universal cost threshold.

## Interpretation

The deterministic result is strong:

> For the tested one-field replacement, current projection maintenance performs an item-local rebuild whose projection-row write count grows exactly linearly with the number of active projected paths: `W(P) = 2P`.

The performance conclusion is intentionally narrower:

> CI #258 observed increasing mutation time as `P` increased, with a median of about `1.33 ms/op` at `P = 64`, but one CI environment is insufficient to classify that absolute cost as product-significant.

Therefore this experiment does **not** justify immediately replacing the current rebuild with a cell-diff algorithm. Incremental maintenance would reduce deterministic write amplification, but it would also create more state-transition branches around stale-cell cleanup, field deletion, rollback, and projection consistency.

## C — competing explanations

- SQLite trigger audit adds overhead, so trigger-backed measurements are used for deterministic write counts, not timing.
- Local SQLite transaction behavior, filesystem behavior, runtime warmup, and CI-host variance can influence `t(P)`.
- A linear internal write count does not imply linear user-visible latency in every workload.
- The current rebuild may be intentionally simple and robust; a cell-selective implementation could reduce writes while increasing correctness risk.
- `P = 64` is a synthetic projection-heavy item. It is not evidence that typical StorekeeperDB prototypes maintain 64 active projections per changed item.

## U — uncertainty

Not established here:

- concurrent-writer behavior;
- production-scale workloads;
- browser behavior;
- nested projection update behavior;
- field deletion and reintroduction across nested paths;
- realistic distributions of active projected-path count;
- whether a cell-diff implementation would preserve current rollback/query/reopen invariants with less total product complexity.

## Decision

Keep the current runtime unchanged for now.

The measured rough edge is real and now quantified, but optimization requires evidence that the absolute cost matters in a realistic StorekeeperDB workload. Do not trade a simple item-local rebuild for more complex incremental projection state solely because the internal asymptotic shape is `O(P)`.

Critical question:

> If eliminating `W(P) = 2P` adds stale-cell and rollback complexity, does that complexity buy meaningful product value under realistic projected-path counts, or merely optimize internal churn that is not yet a demonstrated user problem?
