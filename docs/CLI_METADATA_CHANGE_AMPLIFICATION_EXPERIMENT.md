# CLI project metadata change-amplification replication

Status: **MIXED in CI #122 — edit-surface advantage replicated, concept surface worsened.**

Issue: #38.

## Goal

Replicate the persistence-specific change-amplification experiment on a structurally different workload and expose StorekeeperDB's current singleton-root friction instead of hiding it.

## Scenario

```text
ProjectMeta V1
- id
- cwd
- active

        ↓

ProjectMeta V2
- id
- cwd
- active
- recentFiles[]
- lastCommand { name, args[] }
- preferences { profile, verbose }
```

Unlike the issue tracker, this is one logical metadata record. StorekeeperDB currently represents it as a one-item durable list because root `state()` is list-of-objects only.

## Compared implementations

- minimal relational `node:sqlite`;
- minimal JSON-blob `node:sqlite`;
- StorekeeperDB.

The same `// @persist`, `@concept:<name>`, and LCS additions+deletions measurement convention from #36 was reused.

StorekeeperDB's state access explicitly counts:

```text
@concept:singleton-list-boundary
```

so the known collection-shape ceremony is not hidden from concept count.

## Experimental validity vs product result

The replication separates experiment validity from the product hypothesis.

- runtime/reopen failure => invalid experiment, non-zero exit;
- valid runtime with weaker StorekeeperDB metrics => `MIXED`/`FAIL` result in JSON without invalidating the experiment.

CI #122 passed because all three runtime/reopen implementations were valid, even though the product result was mixed.

## H — hypothesis

StorekeeperDB again requires a lower persistence-specific V1 -> V2 edit surface than the strongest SQLite baseline without undocumented workarounds.

## Result — CI #122

All three runtime/reopen cases passed.

| Metric | Relational SQLite | JSON-blob SQLite | StorekeeperDB |
| --- | ---: | ---: | ---: |
| Persistence-specific V1 lines | 7 | 6 | 4 |
| Persistence-specific V2 lines | 16 | 10 | 8 |
| Persistence-specific changed lines | 19 | 12 | **8** |
| Raw all-source changed lines | 53 | 35 | **30** |
| V2 persistence concepts | 6 | **4** | 5 |
| Added concepts V1 -> V2 | 3 | **0** | 1 |
| Runtime/reopen | PASS | PASS | PASS |

The strongest baseline was again JSON-blob SQLite.

Against that baseline:

```text
persistence-specific changed lines: 12 -> 8
reduction:                        ~33.3%

raw all-source changed lines:      35 -> 30
reduction:                        ~14.3%

V2 persistence concepts:            4 -> 5
StorekeeperDB concept cost:         +1
```

StorekeeperDB's V2 concepts were:

```text
durable-query
durable-state
singleton-list-boundary
storekeeper-api
storekeeper-lifecycle
```

The experiment returned:

```text
MIXED_EDIT_ADVANTAGE_WITH_CONCEPT_COST
```

## D — interpretation

### Replicated evidence

The direction of the edit-surface result replicated on a second workload:

- issue tracker: JSON blob 14 -> StorekeeperDB 8 persistence-specific changed lines;
- CLI metadata: JSON blob 12 -> StorekeeperDB 8 persistence-specific changed lines.

Raw all-source changes were also lower in both experiments, but by a smaller margin.

This makes “reduced explicit persistence edit surface in compatible JSON-style evolution” more credible than after one scenario, although two small scenarios are still not enough for a general claim.

### Failed stronger claim

The conceptual-complexity result worsened.

JSON-blob SQLite used four V2 persistence concepts; StorekeeperDB used five because the one logical metadata record had to be represented through a list root.

Therefore:

> The current list-only root contract is not merely a documentation oddity. It creates observable conceptual ceremony in a realistic singleton-state scenario.

Do not hide this by omitting `singleton-list-boundary`, and do not infer that arbitrary-root support must be implemented immediately. The evidence justifies a focused API evaluation first.

## C — counter-hypotheses

1. **Issue-list model bias:** partially supported. The edit-surface advantage survived, but conceptual cost became worse when the scenario did not naturally match a list root.
2. **JSON-blob baseline is nearly equivalent:** partly supported. JSON blob remains conceptually smaller for singleton metadata, though it still required more explicit persistence edits in this fixture.
3. **StorekeeperDB only moves complexity:** still unresolved. Runtime complexity is not measured by this application-level experiment.
4. **Annotation bias:** still possible. Raw source diffs point in the same direction but with modest margins: 35 vs 30 in the strongest comparison.

## U — uncertainty

- only two small compatible-evolution scenarios;
- explicit persistence annotations remain a classification choice;
- no controlled implementation-time measurement;
- no incompatible migration case;
- no arbitrary-root StorekeeperDB alternative has been evaluated;
- Node SQLite only.

## Product consequence

The current evidence suggests two separate product properties:

1. StorekeeperDB can reduce explicit persistence edit amplification during compatible model evolution.
2. The list-of-objects root restriction can add conceptual friction for singleton state.

These should not be conflated. The first has now shown directionally consistent evidence in two scenarios; the second is a concrete rough edge requiring its own A/B/C evaluation.

## Next falsification step

Evaluate root-state semantics without immediately adding a feature. Compare at least:

- keep list-only state and document singleton convention;
- add a first-class singleton/object state surface;
- generalize `state()` to arbitrary JSON roots.

Measure API size, mutation semantics, rollback/identity behavior, migration implications, and implementation complexity before choosing.

After that decision, run an incompatible model-evolution scenario to locate the explicit migration/validation boundary.

## Run

```bash
npm run experiment:cli-change-amplification
```
