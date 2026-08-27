# Realistic issue tracker evaluation

Status: **PASS — compatible shape evolution and durable query-to-update both verified.**

Issue: #24. Query-semantics follow-up: #29.

## Goal

Use StorekeeperDB as a normal application developer would while the persisted application model evolves. The scenario is not a showcase; it is intended to expose persistence-specific friction and semantic surprises.

## H — hypothesis

A small issue tracker can evolve its persisted item shape and perform query-to-update without introducing:

- a repository/DAO layer;
- direct SQL;
- a table migration for compatible optional JSON fields;
- an internal StorekeeperDB import;
- a second lookup solely to turn a query result into a writable object;
- scenario-specific persistence workarounds.

## T — scenario

Three application iterations use the public `@storekeeper/db` entrypoint against one temporary SQLite file.

### Iteration 1 — initial model

```ts
type IssueV1 = {
  id: string;
  title: string;
  status: "open" | "closed";
};
```

Create two issues and close the database.

### Iteration 2 — evolve the model

Reopen the same database as:

```ts
type IssueV2 = IssueV1 & {
  priority?: "low" | "high" | "urgent";
  labels?: string[];
  comments?: Array<{ author: string; body: string }>;
};
```

Then:

- confirm existing rows load with new fields absent;
- add `priority`, nested `labels`, and nested `comments` through durable handles;
- perform a scalar `find()` lookup by issue id;
- mutate `status` directly through the item returned by `find()`;
- mutate the query-result array and confirm source membership is unchanged;
- query by `priority` and verify a projection is created;
- close the database.

### Iteration 3 — reopen verification

Reopen again and verify:

- added nested fields survived;
- the status mutation made through `find()` survived;
- issue count remained stable;
- query-result array mutation did not change durable source membership.

Run:

```bash
npm run scenario:issue-tracker
```

## D — decision

PASS when:

- compatible shape evolution works without direct SQL or repository code;
- nested fields persist after reopen;
- scalar lookup remains correct;
- `find()` result items are durable handles;
- result-array membership remains local;
- no internal package import is needed.

FAIL when:

- compatible optional-field evolution requires manual migration/workaround;
- nested state is lost after reopen;
- query-to-update requires internal runtime knowledge;
- modifying a local query-result array changes source membership;
- documented handle lifetime is contradicted.

UNCERTAIN when one issue-tracker shape is insufficient to generalize a behavior beyond this application class.

## Result history

The original scenario passed compatible optional-field evolution but exposed a semantic surprise: `find()` returned detached clones. That observation became #29 rather than being silently fixed inside the first evaluation PR.

The focused semantics experiments then compared snapshot and durable-handle designs, identified two blockers, and fixed them independently:

- #31 / PR #33: removed handles cannot write deleted rows back into persistence;
- #32 / PR #34: `liveFind()` owns detached stable snapshots independently of `find()`.

PR #35 then changed `find()` itself to durable item handles. CI #103 passed the full `npm run release:check` gate before documentation synchronization.

## Current observed contract

```text
compatible optional-field evolution      PASS
nested evolved shape persists            PASS
scalar projection creation               PASS
find() result item is a durable handle   PASS
find() mutation persists after reopen    PASS
find() result array remains local         PASS
liveFind() remains detached snapshots     PASS
```

### `find()` result mutation semantics

The current contract is intentionally asymmetric between the array and its elements:

```ts
const result = sk.find<IssueV2>("issues", { id: "ISSUE-1" });
const issue = result[0]!;

issue.status = "closed"; // durable
result.pop();             // local array only
```

This aligns query-to-update with the durable-variable mental model while avoiding accidental source-list membership changes from temporary result arrays.

## Findings

### F1 — compatible shape evolution: positive evidence

Existing `IssueV1` rows reopened as `IssueV2`; optional fields were absent as expected; `priority`, `labels`, and `comments` were added without direct SQL, a repository layer, or a manual table migration.

Scope: compatible optional JSON-field evolution only. Field renames, incompatible type changes, validation policy, and long-lived migration remain unresolved persistence concerns.

### F2 — query semantics: surprise converted into invariant

The original detached-query behavior was a genuine least-surprise problem. Experimentation showed that durable query handles were viable only after handle-lifetime and reactive-snapshot boundaries were made explicit.

Current invariant:

```text
state() / find() -> command-capable durable item handles
liveFind()       -> stable detached read snapshots
```

### F3 — root-state boundary

The issue tracker naturally fits the current list-of-objects `state()` API. This scenario does not validate arbitrary root object/scalar durable variables.

## C — competing explanations

1. Shape evolution may look easy because the changes are backward-compatible optional JSON additions.
2. The issue tracker is especially well matched to list-of-objects state.
3. Avoiding a migration layer may move incompatible-schema risk into application validation.
4. Durable query handles are cheap in the current loaded-state Node runtime; a different backend may change that cost model.

## U — uncertainty

Remaining uncertainty includes:

- incompatible type changes and field renames;
- arbitrary root durable values;
- async/browser handle identity;
- multi-process writers;
- workloads beyond an issue list;
- whether an explicit one-shot snapshot query is ever needed.

## Follow-up

The next evaluation should no longer re-litigate the solved detached-query surprise. It should test the broader product hypothesis: **does StorekeeperDB reduce persistence-specific change amplification when a realistic model changes?**
