# Agent persistence decision-burden experiment

Status: **CANDIDATE PASS in CI #147, with conservative classification.**

Issue: #46. PR: #47.

## Product question

StorekeeperDB is being evaluated as an **agent-oriented durable programming model** for rapid TypeScript prototypes.

The target is stronger than shorter database code:

> Persistence should normally not enter the coding agent's planning loop.

A user should be able to describe product behavior, while the coding agent spends as little implementation effort as possible deciding storage layout, serialization, schema bootstrap, migration plumbing, write SQL, and other persistence mechanics.

This experiment does **not** inspect or claim access to model chain-of-thought. It measures an auditable proxy: persistence-specific design obligations that are concretely embodied in working source code.

## H — hypothesis

For the same local prototype request, StorekeeperDB will require fewer explicit persistence-specific decisions than minimal direct SQLite implementations while preserving restart durability, querying, and compatible model evolution.

A secondary hypothesis is deliberately unfavorable to StorekeeperDB: the current list-only root contract will remain visible as a `singleton-list-adaptation` decision for project settings.

## T — experiment

The same user-level request was implemented three ways:

1. relational Node SQLite;
2. direct JSON-blob Node SQLite;
3. StorekeeperDB through the public package contract.

Scenario:

```text
Build a small local project board.

Persist:
- a task collection;
- one project-settings object.

V1 task:
- id
- title
- status
- priority

V1 settings:
- workspace name
- compact mode

Behavior:
- add/store tasks
- mark a task done
- list urgent open tasks
- survive close/reopen

V2 evolution:
- add task labels
- add nested settings.preferences.defaultView
- close/reopen again and verify the evolved shape
```

All three implementations must pass the same observable behavior before their decision counts are compared.

## Measurement method

Persistence-related source lines are explicitly annotated:

```text
@persist
@decision:<stable-id>
```

A unique decision id represents one persistence-specific design obligation that the implementation must resolve. Examples include storage layout, schema bootstrap, serialization, query strategy, write strategy, lifecycle, compatible-evolution policy, and singleton adaptation.

Shared product/domain choices are not counted.

The strongest baseline is whichever direct-SQL implementation has the lower unique decision count. A hypothesis failure is still a valid experiment; the process exits unsuccessfully only if runtime/reopen/evolution correctness fails.

This method is intentionally inspectable, but classification remains a human modeling choice. Counts are therefore scenario evidence, not universal cognitive measurements.

## D — measured result

CI #146 initially produced:

```text
relational     8 decisions
JSON blob      8 decisions
StorekeeperDB  6 decisions
```

That result was then audited for favorable classification bias. The JSON-blob fixture counted `compatible-json-evolution`, while StorekeeperDB had not counted the analogous requirement to know that this V2 change is compatible with its persisted state model.

The Storekeeper fixture was corrected to add:

```text
compatible-state-evolution
```

CI #147 reran the complete release gate and produced the conservative result:

| implementation | persistence lines | decision count |
| --- | ---: | ---: |
| relational SQLite | 19 | 8 |
| JSON-blob SQLite | 25 | 8 |
| StorekeeperDB | **14** | **7** |

All three runtime implementations passed:

```text
urgentOpen            1
reopenedTasks         2
settingsReopened      true
evolvedShapePersisted true
```

Machine decision:

```text
CANDIDATE_PASS_FEWER_PERSISTENCE_DECISIONS
```

## Decision manifests

### Relational SQLite — 8

```text
migration-strategy
query-strategy
relational-layout
schema-bootstrap
serialization
singleton-row
sqlite-lifecycle
write-strategy
```

### JSON-blob SQLite — 8

```text
blob-layout
compatible-json-evolution
query-strategy
schema-bootstrap
serialization
singleton-key
sqlite-lifecycle
write-strategy
```

### StorekeeperDB — 7

```text
compatible-state-evolution
durable-query
durable-state
singleton-list-adaptation
state-keying
storekeeper-lifecycle
storekeeper-runtime
```

## What StorekeeperDB removed in this scenario

Relative to the direct SQLite implementations, the coding surface no longer had to separately solve:

- SQLite schema/bootstrap DDL;
- explicit JSON serialization/deserialization plumbing;
- explicit SQL write/update strategy;
- relational migration DDL;
- a physical storage-layout choice at the application callsite.

Those concerns have not ceased to exist. StorekeeperDB moved them behind the durable-state abstraction.

This is the relevant product effect for an agent-oriented runtime: **reduce the number of persistence architecture choices that each generated prototype must actively carry.**

## What is still exposed

The result is only 7 vs 8, not 0 vs 8. StorekeeperDB still requires the agent to account for:

```text
storekeeper-runtime
storekeeper-lifecycle
state-keying
durable-state
durable-query
compatible-state-evolution
singleton-list-adaptation
```

`singleton-list-adaptation` is especially important because it is accidental persistence-shape ceremony: the domain concept is one project-settings object, but the current public state model requires a one-item list.

The previous singleton-surface experiment (#44) showed that simply adding `objectState()` / `objectSignal()` is not yet justified. Therefore this result should not be converted directly into a new public method.

## C — competing explanations

1. The decision taxonomy may merge or split obligations differently; the 7 vs 8 difference is small.
2. A different direct-SQL implementation may choose a different architecture and therefore a different decision manifest.
3. StorekeeperDB-specific concepts may replace some SQLite concepts rather than eliminate them.
4. The scenario combines one collection and one singleton object; another workload may produce a different result.
5. Decision count does not measure model reasoning tokens, latency, implementation success rate, or repair loops.

## U — uncertainty

- replication across different prototype domains;
- whether decision categories should eventually be weighted rather than counted equally;
- whether runtime construction/close should remain explicit for agent-generated prototypes;
- whether state keys should be application decisions or discoverable project state;
- whether singleton/root adaptation can be removed without creating larger public-API or identity complexity;
- where incompatible evolution should intentionally force persistence concerns back into view.

## Product implication

The next optimization target should not be source-character count.

It should be:

> **Reduce agent-visible persistence decisions without hiding hard persistence failures.**

A useful next experiment is to test conventions or a thin agent-facing project runtime that can remove repeated lifecycle, key-discovery, and singleton-shape decisions while preserving the existing StorekeeperDB core invariants.

Do not treat this as permission to make incompatible migration, concurrency, corruption, or durability boundaries invisible.

## Run

```bash
npm run experiment:agent-decision-burden
```

The output is machine-readable JSON and includes the complete decision manifest for each candidate.
