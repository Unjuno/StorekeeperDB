# Persistence-specific change amplification experiment

Status: **CANDIDATE PASS in CI #116, with important limits.**

Issue: #36.

## Goal

Test the product hypothesis that StorekeeperDB reduces persistence-specific change amplification while an application model is evolving.

This is not a total-LOC contest. The target variable is the edit/concept surface introduced specifically because application state must persist.

## Scenario

The same compatible model evolution was applied to three implementations:

```text
Issue V1
- id
- title
- status

        ↓

Issue V2
- id
- title
- status
- priority
- labels[]
- comments[]
```

Every implementation created two V1 issues, closed persistence, reopened with V2 code, evolved ISSUE-1, set it closed, reopened again, and verified evolved fields/status/row count.

## Compared implementations

### A. Minimal relational SQLite

Direct `node:sqlite` with scalar V1 columns. V2 adds `priority`, `labels_json`, and `comments_json` using three `ALTER TABLE` statements. No repository, ORM, or migration framework is used.

### B. Minimal JSON-blob SQLite

Direct `node:sqlite` with:

```text
issues(id PRIMARY KEY, value_json TEXT)
```

This is the stronger counter-baseline because compatible V2 fields require no SQL schema migration. The application explicitly performs SQL select/update plus JSON parse/stringify.

### C. StorekeeperDB

StorekeeperDB state/query semantics only. V2 mutates the durable item returned by `find()` and verifies persistence after reopen. No runtime change was made to obtain the result.

## Measurement

Persistence-specific fixture lines are annotated with `// @persist`; concepts are annotated with `@concept:<name>`.

The script reports both annotated persistence-specific diffs and raw all-source diffs. Changed lines are additions + deletions after LCS over trimmed non-blank lines.

The annotation is explicit and auditable, but it remains a classification choice. Therefore the raw source diff is retained alongside the annotated metric.

## H — hypothesis

For this compatible model change, StorekeeperDB should require fewer persistence-specific line edits than both minimal direct-SQL baselines while using no greater V2 persistence-concept surface than the strongest baseline.

## Result — CI #116

All three runtime/reopen scenarios passed.

| Metric | Relational SQLite | JSON-blob SQLite | StorekeeperDB |
| --- | ---: | ---: | ---: |
| Persistence-specific V1 lines | 8 | 8 | 4 |
| Persistence-specific V2 lines | 16 | 10 | 8 |
| Persistence-specific changed lines | 20 | 14 | **8** |
| Raw all-source changed lines | 54 | 40 | **34** |
| V2 persistence concepts | 6 | **4** | **4** |
| Added persistence concepts V1 -> V2 | 3 | **0** | 1 |
| Runtime/reopen verification | PASS | PASS | PASS |

The strongest baseline was JSON-blob SQLite.

Against that baseline:

```text
persistence-specific changed lines: 14 -> 8
reduction:                        ~42.9%

raw all-source changed lines:      40 -> 34
reduction:                        15.0%

V2 persistence concepts:            4 -> 4
concept-count advantage:          none

new persistence concepts:           0 -> 1
StorekeeperDB added:              durable-query
```

Against the relational baseline, persistence-specific changed lines were 20 -> 8, a 60% reduction in this fixture.

The deterministic script therefore returned:

```text
CANDIDATE_PASS
```

## D — interpretation

### What passed

The tested compatible model change required a smaller explicitly persistence-specific edit surface with StorekeeperDB than with either direct-SQL baseline.

The result also survived the stronger JSON-blob counter-baseline, so it cannot be explained only by avoiding relational `ALTER TABLE` work.

### What did not pass as a stronger claim

The experiment does **not** show that StorekeeperDB always requires fewer persistence concepts.

Against JSON-blob SQLite, V2 concept count was equal at 4 vs 4, and JSON-blob introduced no new persistence concept while StorekeeperDB introduced `durable-query`.

Therefore the evidence supports this narrower claim:

> StorekeeperDB reduced explicit persistence edit surface for this compatible prototype evolution, but conceptual complexity was not lower than a deliberately minimal JSON-blob SQLite design.

That is materially weaker—and more defensible—than “database complexity disappears.”

## C — counter-hypotheses

1. **Relational strawman:** rejected as the sole explanation because StorekeeperDB also beat the JSON-blob baseline on annotated and raw edit surface.
2. **Runtime complexity is merely hidden:** not tested here. This experiment measures application change amplification only. Runtime complexity must remain visible in architecture/hardening work.
3. **Annotation bias:** still plausible. `@persist` classification is subjective. The raw all-source result is directionally consistent but the advantage vs JSON-blob is much smaller: 34 vs 40 changed lines.
4. **Favorable optional-field scenario:** still plausible. JSON-style storage is naturally strong here; incompatible evolution may materially change the result.

## U — uncertainty

Major uncertainty remains:

- one issue-tracker workload;
- persistence-line annotation sensitivity;
- no controlled implementation-time measurement;
- compatible optional fields only;
- no browser/async backend;
- no multi-process writer case;
- no long-lived validation/migration policy.

The result should be treated as **candidate evidence**, not a general benchmark or marketing claim.

## Product consequence

The product thesis should be phrased in terms of reducing persistence ceremony/change amplification rather than eliminating persistence concepts:

> StorekeeperDB aims to keep explicit storage mechanics out of the early application-change loop. It may not reduce the number of concepts below a carefully chosen JSON-blob design, but it can reduce the amount of persistence-specific code that must be edited as the model evolves.

## Next falsification step

Replicate the same measurement method on a second scenario before generalizing. A small CLI/project-metadata state is preferable because it differs structurally from an issue list.

After replication, run one incompatible evolution scenario to identify where explicit migration/validation must re-enter the architecture.

## Run

```bash
npm run experiment:change-amplification
```

The output is machine-readable JSON containing runtime verification, line-diff profiles, concept sets, comparison metrics, and candidate decision.
