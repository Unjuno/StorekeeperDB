# CLI project metadata change-amplification replication

Status: **replication implemented; result pending CI execution.**

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

The same `// @persist`, `@concept:<name>`, and LCS additions+deletions measurement convention from #36 is reused.

StorekeeperDB's state access is explicitly annotated with:

```text
@concept:singleton-list-boundary
```

so the known collection-shape ceremony contributes to concept count.

## Experimental validity vs product result

This replication separates experiment validity from the product hypothesis.

- runtime/reopen failure => invalid experiment, non-zero exit;
- valid runtime with weaker StorekeeperDB metrics => `MIXED`/`FAIL` result in JSON, but the experiment itself remains executable.

This avoids turning a falsifiable product hypothesis into a CI test that is only allowed to pass when StorekeeperDB wins.

## H — hypothesis

StorekeeperDB again requires a lower persistence-specific V1 -> V2 edit surface than the strongest SQLite baseline without undocumented workarounds.

## D — interpretation

- `REPLICATION_PASS`: lower persistence edit surface and no larger persistence-concept surface.
- `MIXED_EDIT_ADVANTAGE_WITH_CONCEPT_COST`: lower edit surface, but StorekeeperDB uses more persistence concepts.
- `MIXED_OR_FAIL_NO_EDIT_ADVANTAGE`: runtime works but the previous edit-surface advantage does not replicate.
- `INVALID_EXPERIMENT`: one or more runtime/reopen implementations fail.

The singleton-list boundary is documented, so its presence is not itself a runtime failure; it is a product-friction observation.

## C — counter-hypotheses

1. The first issue-list result may have benefited from matching StorekeeperDB's root data model.
2. JSON-blob SQLite may be especially competitive for one-record metadata.
3. StorekeeperDB can reduce SQL/serialization edits while increasing conceptual ceremony due to one-item list state.

## U — uncertainty

This remains compatible JSON-style evolution under Node SQLite. It does not test arbitrary root-state support, incompatible migration, browser storage, or multi-process writers.

## Run

```bash
npm run experiment:cli-change-amplification
```
