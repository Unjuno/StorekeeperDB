# Agent workspace checkpoints — third convention topology

Status: **MIXED observed in CI #314**. Experiment-only; no new public workspace, agent-memory, transaction, or migration API authorized.

Issue #84. PR #86.

## H — falsifiable hypothesis

The **unchanged** generic `openProjectStore` helper from PR #49 should reduce the persistence-specific decisions required in a third, realistic agent workspace. Independent reader processes receiving only a database path and explicit bootstrap key should recover tasks, decisions, and a checkpoint without a second durable registry. The convention may still expose a **multi-state checkpoint atomicity gap**, because the existing helper has no `batch()` method.

## T — minimum controlled experiment

Environment: CI #314, GitHub Actions Linux, Node 22.23.4, built-in synchronous `node:sqlite`, `--experimental-sqlite`. Two isolated file-based SQLite databases, four independent Node processes (two writers, two readers).

- Explicit candidate uses public `StorekeeperDB.state()`, `find()`, and `batch()`. The singleton workspace requires a one-element list and explicit state keys.
- Convention candidate uses **unchanged** `scripts/agent_project_convention/convention.ts`: `openProjectStore(path, { __workspace: object(...), tasks: list(...), decisions: list(...) })`.
- Both writers persist non-default checkpoint sequence 2, a completed task, an accepted decision, and compatible optional task label metadata.
- Each reader receives **only DB path and bootstrap key**; it discovers both additional states from `__workspace.importantStateKeys`, verifies checkpoint/state coherence, and queries completed tasks.
- Negative control uses a nonexistent bootstrap key. Test-only SQLite inspection checks for a second physical source registry.
- Failure injection throws **after task mutation but before checkpoint advancement**, followed by database reopen to observe what persisted.

## Observed results — CI #314

| Audited measure | Explicit StorekeeperDB | Project convention |
| --- | ---: | ---: |
| Unique per-prototype `@decision` categories | 10 | 8 |
| Candidate writer `@persist` lines | 19 | 11 |
| Fresh-process reopen / discovered task query / optional V2 field | PASS | PASS |
| Physical source keys only `__workspace`, `tasks`, `decisions` | PASS | PASS |
| Failure-control task mutation rolled back with checkpoint unchanged | PASS | **FAIL** |
| Failure-control task changed while checkpoint remained 1 | NO | **YES** |

**Disclosed common overhead**, excluded from both writer columns: the common reader has **6 decision categories / 8 `@shared-persist` lines**; the unchanged helper exposes **2 public concepts / 4 internal mechanisms**. These source markers measure auditable implementation obligations, **not hidden agent chain-of-thought**.

```text
current:    task open -> open, checkpoint 1 -> 1; atomicRollbackPreserved=true
convention: task open -> done, checkpoint 1 -> 1; partialCommitExposed=true

MIXED_CONVENTION_REDUCES_DECISIONS_BUT_CHECKPOINT_ATOMICITY_GAP
```

Both reader processes recovered completed checkpoint 2. The wrong-key reader reported `missing or ambiguous bootstrap workspace`. Neither database had an additional `__project_identity` source state.

## D — decision

**MIXED**: the convention reduces the writer's explicit persistence categories by **2** and annotated lines by **8**, but the unchanged wrapper cannot atomically commit task/decision/checkpoint changes. The public StorekeeperDB `batch()` candidate did provide rollback. This is a **convention-surface limitation**, not evidence that the underlying SQLite runtime lacks transactions.

The application still chooses the bootstrap key, which states belong to a workspace, and when a checkpoint is considered complete. State-key derivation does not eliminate discovery policy. Counting the writer alone is insufficient for a full end-to-end cost comparison.

## C — competing explanations

The fixture is one singleton and two lists, which may favor this helper; marker category choice affects reported decision counts; a common reader can conceal bootstrap costs if excluded; and the explicit candidate intentionally uses a transaction API the helper does not expose. A minimal project-level transaction adapter may solve that specific gap without a new core API, but it requires a **separate** design test.

## U — uncertainty

Not tested: a real autonomous coding agent, concurrent processes/writers, crash timing, power loss, incompatible migration, project-identity manifest integration, automatic checkpoint repair, or browser/remote backends. The test demonstrates process restart, not crash-durability guarantees.

Next investigate reuse of existing durable identity/project declarations for discoverability **without a parallel registry**, plus the minimum transaction exposure needed by the project-level convention. No public API change is authorized from this one result.

## Reproduce

```sh
npm run experiment:agent-workspace-third-topology
npm run release:check
```

The experiment emits structured JSON. Its self-gate requires the exact observed MIXED result, rollback/partial-commit contrast, recovery, no duplicate physical registry, and audited marker counts.
