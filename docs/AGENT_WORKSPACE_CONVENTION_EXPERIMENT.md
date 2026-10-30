# Agent workspace checkpoint convention experiment

Status: **MIXED in CI #312; experiment-only.**

```text
MIXED_CONVENTION_REDUCES_DECISIONS_BUT_CHECKPOINT_ATOMICITY_GAP
```

Issue: #84  
PR: #85  
Runtime in CI #312: Node 22.23.4 with `--experimental-sqlite`, Ubuntu 26.04 GitHub-hosted runner.

## Goal

Test the existing generic project convention in a third topology that is directly relevant to agent work: durable workspace discovery, task/decision recovery, and checkpoint resume across separate Node processes.

The experiment reuses `scripts/agent_project_convention/convention.ts` unchanged. It does not authorize a public workspace, memory, or migration API.

## H — falsifiable hypothesis

The generic project convention should remove repeated per-prototype persistence decisions such as explicit state-key wiring and singleton-list adaptation while preserving:

- durable source state;
- compatible optional task metadata;
- writer/reader process boundaries;
- bootstrap discovery from DB path plus one explicit bootstrap key;
- query correctness;
- no second persistent registry.

A separate hard boundary is allowed to surface: an atomic checkpoint spanning multiple durable states may still require an explicit transaction surface.

## T — minimum controlled test

Two candidates use separate SQLite databases.

### Explicit-current candidate

Uses public `StorekeeperDB` directly for:

- `__workspace` singleton-list state;
- `tasks`;
- `decisions`;
- explicit state keys;
- `find()`;
- `batch()` for a task + checkpoint durability unit.

### Unchanged project-convention candidate

Uses the existing:

- `openProjectStore()`;
- `list()`;
- `object()`;
- project-owned `find()`.

The helper itself is not modified for this topology.

For both candidates:

1. a writer process seeds workspace/task/decision state;
2. the task is reopened with compatible optional `tags` metadata;
3. failure is injected after task mutation but before checkpoint advancement;
4. final coherent state is established;
5. the writer exits;
6. a fresh reader process receives only DB path + `__workspace`;
7. the reader discovers `tasks` and `decisions` from the workspace manifest;
8. task and decision queries are checked;
9. test-only SQLite inspection lists physical state keys and registry-like keys;
10. candidate source is measured with auditable `@persist` and `@decision:<id>` markers.

The marker metric measures source obligations only. It does not inspect or claim access to model chain-of-thought.

## Observed result — CI #312

### Runtime/discovery

Both candidates passed the fresh-process reader.

```text
discovered durable states:
tasks
decisions

checkpoint sequence:
2

physical state keys:
__workspace
decisions
tasks

registry-like durable state keys:
__workspace
```

For both candidates:

- writer final state coherent: **YES**
- reader process PASS: **YES**
- compatible optional task metadata preserved: **YES**
- second persistent registry observed: **NO**

### Persistence-decision profile

| candidate | persistence-marked lines | unique decision categories |
|---|---:|---:|
| explicit current | 24 | 9 |
| unchanged project convention | 14 | 7 |

Observed reduction:

```text
decision categories: 9 -> 7
persistence lines:   24 -> 14
```

The convention candidate removed the per-prototype categories:

```text
state-keying
singleton-list-adaptation
```

The explicit bootstrap-key decision remained visible in both candidates.

The reused framework still reports its existing two public concepts separately:

```text
project-store
shape-descriptor
```

This experiment does not count those shared framework concepts as zero; it reports them separately from per-prototype candidate decisions.

## Atomic checkpoint boundary

This is the reason the result is **MIXED**, not a clean PASS.

### Explicit-current candidate

The injected failure occurred after task mutation but before checkpoint advancement inside `StorekeeperDB.batch()`.

Observed after rollback:

- task status returned to the pre-checkpoint value;
- checkpoint remained at sequence 1;
- compatible optional metadata remained;
- later successful `batch()` committed task + checkpoint together.

```text
atomicRollbackPreserved = true
```

### Project-convention candidate

The unchanged `AgentProjectStore` surface does not expose `batch()`.

The same logical failure point produced a durable split:

```text
task.status       = done
checkpoint.sequence = 1
```

A subsequent reopen observed that split before explicit repair.

```text
splitDurableStateObserved = true
```

The experiment then advanced the checkpoint explicitly so the final independent reader could resume from coherent sequence 2.

Therefore:

> The convention reduces routine persistence decisions in a third topology, but multi-state checkpoint atomicity correctly re-enters the implementation plan as a hard persistence boundary.

## D — decision

```text
MIXED_CONVENTION_REDUCES_DECISIONS_BUT_CHECKPOINT_ATOMICITY_GAP
```

The evidence supports all of the following simultaneously:

1. the same generic helper works unchanged in a third topology;
2. per-prototype persistence decision count decreases;
3. cross-process discovery works with DB path + one explicit bootstrap key;
4. no second durable registry was observed;
5. checkpoint atomicity is not provided by the current project-convention surface.

No public API change is authorized by this experiment alone.

## C — competing explanations / ways this can break

- The explicit-current baseline may still contain ceremony that another direct StorekeeperDB style could reduce.
- Marker counts are auditable source obligations, not cognitive-load measurements or hidden reasoning traces.
- The workspace fixture has only two discovered list states plus one bootstrap object.
- A convention-level transaction wrapper might close the atomicity gap without requiring a StorekeeperDB core API.
- Co-locating checkpoint and task state could avoid this exact multi-state transaction need, but that would change the application model rather than prove a generic solution.
- A thrown exception is not equivalent to process kill or power loss.

## U — uncertainty

Not established here:

- process termination at controlled durability boundaries;
- power-loss behavior;
- concurrent writers;
- old/new process version skew;
- incompatible migrations;
- browser/remote backends;
- generalized agent-memory policy;
- trust, summarization, or context-selection policy.

## Next experiment

Do **not** add a workspace API.

The next narrow question is:

> What is the smallest project-level transaction escape hatch that preserves the convention's decision reduction without hiding the hard multi-state checkpoint boundary?

Compare at least:

1. keep the convention unchanged and require raw StorekeeperDB for atomic checkpoints;
2. expose a thin project-level `batch()` delegation;
3. use a transaction callback at project-open time only if it reduces decisions without adding a second runtime/lifecycle concept.

Any runtime or API change should be a separate observed-finding PR.
