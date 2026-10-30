# Project checkpoint atomicity escape-hatch experiment

Status: **CANDIDATE in CI #323; experiment-only.**

```text
CANDIDATE_PREFER_THIN_PROJECT_BATCH_ESCAPE_HATCH
```

Issue: #87  
PR: #88  
Source finding: #84 / CI #312

## Goal

The agent-workspace experiment showed that the existing project convention reduces routine persistence decisions, but its current surface cannot make a task update and checkpoint advancement one durability unit.

This experiment compares two explicit responses to that hard boundary without changing StorekeeperDB core or public exports.

## H — falsifiable hypothesis

A thin project-level `batch()` delegation can restore exact multi-state rollback while preserving the project convention's routine decision reduction, with fewer per-prototype persistence obligations than dropping back to raw StorekeeperDB for every atomic checkpoint.

## T — controlled candidates

Both candidates reuse the same workspace/task/decision model and the same failure point:

```text
task mutation
-> injected failure
-> checkpoint advancement would have followed
```

Both must:

- preserve compatible optional task metadata;
- roll back task + checkpoint exactly under the injected failure;
- later commit task + checkpoint together;
- close the writer;
- recover from a fresh reader process;
- start the reader from DB path + explicit `__workspace`;
- discover `tasks` and `decisions`;
- query the done task and accepted decision;
- retain no second registry-like durable state.

### A — unchanged convention + raw StorekeeperDB fallback

Normal application state uses the existing project convention.

At the atomic checkpoint boundary, the candidate closes the project store and explicitly re-enters raw StorekeeperDB:

- opens another runtime;
- names `__workspace` and `tasks` physical state keys;
- adapts the workspace object through the root list contract;
- calls `batch()`;
- manages raw runtime lifecycle.

All of those obligations are counted.

### B — experiment-only thin project batch delegation

An experiment-only project-store variant keeps the same declaration/query model but adds one delegated method:

```ts
project.batch(() => {
  // durable state mutations
});
```

The method delegates directly to the same underlying `StorekeeperDB.batch()`.

This experiment does not modify StorekeeperDB core or package exports.

## Observed runtime — CI #323

Both candidates passed:

```text
atomicRollbackPreserved = true
writer final state       = coherent
fresh reader             = PASS
checkpoint sequence      = 2
done task count          = 1
accepted decision count  = 1
second registry          = absent
```

Therefore the choice is not about correctness in this controlled thrown-failure scenario. Both restored the hard atomicity boundary.

## Persistence-decision profile

| candidate | persistence-marked lines | unique decision categories |
|---|---:|---:|
| raw StorekeeperDB fallback | 22 | 11 |
| thin project batch | 15 | 7 |

Measured difference:

```text
decision reduction:      4
persistence-line reduction: 7
```

The raw fallback reintroduced:

```text
raw-storekeeper-fallback
raw-runtime-lifecycle
state-keying
singleton-list-adaptation
```

The project-batch candidate retained `multi-state-atomicity` as an explicit decision. It did **not** make atomicity invisible.

## Framework cost

The base project convention already reports:

```text
project-store
shape-descriptor
```

The experiment-only transaction variant adds exactly one incremental framework concept:

```text
project-batch
```

The candidate therefore does not treat framework machinery as free.

## D — decision

```text
CANDIDATE_PREFER_THIN_PROJECT_BATCH_ESCAPE_HATCH
```

Interpretation:

> Both candidates repaired the checkpoint atomicity gap. Raw fallback also reintroduced the persistence decisions that the project convention was meant to remove. A one-method transaction delegation kept the hard transaction choice explicit while avoiding those repeated state-key/singleton/runtime obligations.

This is a **candidate architecture result**, not authorization for a public API.

No public `project.batch()`, workspace API, memory API, or StorekeeperDB core change is approved by this experiment.

## C — competing explanations / ways this can break

- The raw fallback candidate may be more ceremonial than another hand-written escape-hatch style.
- A batch method could move StorekeeperDB knowledge into framework internals rather than remove a true conceptual cost.
- The measurement counts auditable source obligations, not hidden model reasoning.
- A thrown exception is weaker than process termination or power loss.
- The experiment uses one workspace object plus two list states; larger project shapes may expose different ergonomic costs.
- The callback/lifecycle candidate from Issue #87 was not needed to distinguish A and B, so it remains untested.

## U — uncertainty

Not established:

- process termination while the transaction is open;
- power loss;
- concurrent writers;
- old/new process version skew;
- incompatible migration during checkpointing;
- browser/remote storage;
- whether `batch` is the right eventual public name or surface;
- whether the existing project convention itself should ever become public.

## Next work

Before authorizing a public transaction surface, test the stronger durability boundary:

> If the writer process terminates after the task write but before checkpoint advancement inside the delegated batch, does the fresh reader observe the pre-transaction state with no partial checkpoint?

That experiment should compare raw `StorekeeperDB.batch()` and the thin project delegation under the same forced process-exit point. It must distinguish process termination from power-loss guarantees.
