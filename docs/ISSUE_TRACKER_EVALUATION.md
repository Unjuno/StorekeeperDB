# Realistic issue tracker evaluation

Status: scenario implemented; validation pending on the experiment branch.

Issue: #24.

## Goal

Use StorekeeperDB as a normal application developer would while the persisted application model evolves.

This is not a showcase scenario. It deliberately exercises a semantic boundary that may be surprising: objects returned by `find()` are detached snapshots rather than persistent mutation handles.

## H — hypothesis

A small issue tracker can evolve its persisted item shape without introducing:

- a repository/DAO layer;
- direct SQL;
- a table migration for compatible optional JSON fields;
- an internal StorekeeperDB import;
- a scenario-specific persistence workaround.

## T — minimum test

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

### Iteration 2 — evolved model

Reopen the same database as:

```ts
type IssueV2 = IssueV1 & {
  priority?: "low" | "high" | "urgent";
  labels?: string[];
  comments?: Array<{ author: string; body: string }>;
};
```

Then:

- confirm existing rows load with the new fields absent;
- add `priority`, nested `labels`, and nested `comments` through the state proxy;
- perform a real scalar `find()` lookup;
- deliberately mutate the `find()` result and observe whether it changes durable state;
- perform the actual status mutation through the state proxy;
- query by `priority` and verify a projection is created;
- close the database.

### Iteration 3 — reopen verification

Reopen again and verify:

- added nested fields survived;
- durable status mutation survived;
- issue count remained stable.

Run:

```bash
npm run scenario:issue-tracker
```

## D — decision

PASS for the product hypothesis when:

- compatible shape evolution works without direct SQL or repository code;
- nested fields persist after reopen;
- scalar lookup remains correct;
- durable mutation through the state proxy survives reopen;
- no internal package import is needed.

A scenario may still PASS while exposing a rough edge. Findings are recorded separately from the hypothesis decision.

FAIL when:

- compatible optional-field evolution requires a manual migration/workaround;
- nested state is lost after reopen;
- documented public behavior is contradicted;
- direct SQL or internal runtime knowledge is required.

UNCERTAIN when:

- one issue-tracker shape is insufficient to distinguish a general design property from scenario bias;
- a finding is semantic rather than clearly defective and needs a product decision.

## Findings to observe

### F1 — compatible shape evolution

Expected classification: positive evidence if optional JSON fields can be added through ordinary mutation after reopen.

### F2 — `find()` result mutation semantics

Current implementation returns cloned values. The scenario deliberately checks that:

```ts
const issue = sk.find<IssueV2>("issues", { id: "ISSUE-1" })[0]!;
issue.status = "closed";
```

does **not** mutate the durable state proxy.

If confirmed, classify this as a **surprise / API-semantics finding**, not silently as success. The product question is whether `find()` should remain an explicit snapshot API or return durable handles.

Do not change runtime behavior in the same PR that first records this finding.

### F3 — root-state boundary

The issue tracker naturally fits the current list-of-objects `state()` API. This scenario therefore does not validate arbitrary root object/scalar durable variables.

## C — competing explanations

1. Shape evolution may look easy only because new fields are optional and backward-compatible JSON additions.
2. The issue tracker may be unusually well matched to a list-of-objects data model.
3. The absence of a migration layer may move incompatible-schema risk into application runtime checks.
4. `find()` snapshot semantics may be acceptable if made explicit, rather than requiring a runtime behavior change.

## U — uncertainty

Major uncertainty after this scenario:

- incompatible type changes;
- field deletion/renaming across long-lived data;
- validation policy;
- whether query results should be snapshots or durable handles;
- arbitrary root durable values;
- multi-process writers;
- representative workloads beyond an issue list.

## Follow-up rule

Record the scenario result first. Any behavioral fix should be a separate small PR with its own regression test and product decision.
