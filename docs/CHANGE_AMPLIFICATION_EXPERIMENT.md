# Persistence-specific change amplification experiment

Status: **experiment implemented; result pending CI execution.**

Issue: #36.

## Goal

Test the product hypothesis that StorekeeperDB reduces persistence-specific change amplification while an application model is evolving.

This is not a total-LOC contest. The target variable is the edit/concept surface introduced specifically because application state must persist.

## Scenario

Apply the same compatible model evolution:

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

Every implementation must:

1. create two V1 issues;
2. close persistence;
3. reopen with V2 code;
4. add priority, labels, and one comment to ISSUE-1;
5. set ISSUE-1 status to closed;
6. close/reopen;
7. verify evolved fields, status, and row count.

## Compared implementations

### A. Minimal relational SQLite

Node `node:sqlite` with explicit scalar columns for V1. V2 adds three columns (`priority`, `labels_json`, `comments_json`) with direct `ALTER TABLE` statements. Labels/comments use JSON text to avoid introducing extra relational tables that would inflate the baseline.

This is intentionally a small conventional relational baseline: no repository, ORM, or migration framework.

### B. Minimal JSON-blob SQLite

Node `node:sqlite` with:

```text
issues(id PRIMARY KEY, value_json TEXT)
```

This baseline is deliberately strong against StorekeeperDB's hypothesis because compatible V2 fields require no SQL schema migration. Application code performs explicit JSON parse/stringify and SQL select/update.

If StorekeeperDB only beats the relational baseline but not this JSON-blob baseline, the result must say so.

### C. StorekeeperDB

Public/core StorekeeperDB state/query semantics only. V2 mutates the item returned by `find()` and verifies persistence after reopen.

No runtime modification is allowed merely to make this experiment pass.

## Measurement

Fixture source lines that exist specifically for persistence are explicitly annotated:

```text
// @persist
```

Persistence concepts are annotated on those lines:

```text
@concept:<name>
```

Examples include:

- `schema-ddl`;
- `migration-ddl`;
- `migration-inspection`;
- `query-sql`;
- `serialization`;
- `sqlite-lifecycle`;
- `durable-state`;
- `durable-query`.

The measurement script reports both:

1. annotated persistence-specific line diff;
2. raw all-source line diff.

This prevents the annotated result from hiding the underlying fixture size/change surface.

### Changed-line calculation

For each V1/V2 pair:

1. trim lines;
2. remove blank lines;
3. compute longest common subsequence (LCS);
4. count deletions + additions as changed lines.

The same algorithm is used for all three implementations.

## H — hypothesis

For this compatible model change, StorekeeperDB should require fewer persistence-specific line edits than both minimal direct-SQL baselines while using no greater V2 persistence-concept surface than the strongest baseline.

## D — deterministic candidate decision

The script reports `CANDIDATE_PASS` only when:

- all three runtime/reopen scenarios pass;
- StorekeeperDB persistence-specific changed lines are lower than the better (lower) of the two SQLite baselines;
- StorekeeperDB V2 persistence-concept count is no greater than the better baseline.

Otherwise the script returns a non-zero exit code and reports `FAIL_OR_UNCERTAIN`.

This automated candidate decision is not sufficient for a product claim; annotation sensitivity and baseline fairness must still be reviewed.

## C — counter-hypotheses

1. The relational baseline could make StorekeeperDB look good because schema changes require DDL. The JSON-blob baseline exists specifically to challenge that explanation.
2. StorekeeperDB may hide complexity in the runtime rather than eliminate it. This experiment measures application change amplification only; runtime complexity remains visible in separate hardening/architecture work.
3. `@persist` classification is subjective. Raw all-source diffs and source fixtures remain available for audit.
4. Optional fields are favorable to JSON-style storage. Incompatible-change behavior requires a later experiment.

## U — uncertainty

Major uncertainty:

- persistence-line annotation sensitivity;
- one issue-tracker workload;
- no implementation-time measurement in this first pass;
- no multi-process writer or browser backend;
- compatible optional-field evolution only.

## Run

```bash
npm run experiment:change-amplification
```

The output is machine-readable JSON containing runtime verification, line-diff profiles, concept sets, comparison metrics, and candidate decision.
