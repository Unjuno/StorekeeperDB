# Identity-manifest-only workspace bootstrap experiment

Status: **CANDIDATE PASS observed in CI #331**. This is an experimental convention result, not an authorized public discovery or agent-memory API.

Issue #89. PR #90.

## H — falsifiable hypothesis

The already-persisted declaration identity manifest can double as the single bootstrap/discovery registry. Given a DB path and a known `__project_identity` key, a reader process can recover **current logical names**, original physical keys, a workspace checkpoint, and projected task state **after an explicit declaration rename**, without a parallel `__workspace.importantStateKeys` registry.

This does **not** infer application semantics or guarantee atomic multi-state checkpoint commits.

## T — minimum experiment

Two Node processes (writer and reader), one file SQLite database, public StorekeeperDB runtime, and the existing, unchanged `scripts/declaration_key_rename/convention_candidates.ts` helper.

1. V1 declares `workspace` (object), `tasks` (list), and `decisions` (list) through `openAliasRenameProjectStore`.
2. A scalar `status` query establishes a SQLite-backed task projection.
3. V2 renames `tasks -> workItems` using the **one-shot explicit `from: "tasks"` alias**, preserves the existing two task objects, adds compatible optional task metadata, and commits checkpoint sequence 2.
4. V3 reopens the same logical declarations **without the alias**. An attempted obsolete declaration named `tasks` must reject.
5. A **fresh reader process receives only DB path + `__project_identity`**. It reads the existing logical/physical bindings, opens the referenced physical state, recognizes task/decision/workspace roles from source contents, and queries completed tasks.
6. Test-only SQLite inspection verifies the original projection is under physical `tasks` and there are no source/projection rows under physical `workItems`, nor a second `__workspace` registry.
7. Wrong-bootstrap negative control must reject and leave the **entire physical source-row snapshot unchanged**.

Runtime measured in CI #331: GitHub Actions Linux, Node 22.23.4, built-in synchronous `node:sqlite` with `--experimental-sqlite`.

## Observations — CI #331

| Check | Observation |
| --- | --- |
| Initial V1 projected query | 2 open tasks |
| Query after alias rename | 1 completed task |
| V3 reopen without alias | PASS |
| Obsolete logical declaration rejected | PASS |
| Compatible optional field recovered | PASS |
| Fresh-process workspace checkpoint | sequence 2 |
| Accepted decisions | 1 |
| Existing scalar projection retained | PASS |
| Wrong bootstrap rejected | PASS |
| Extra `__workspace` registry | absent |

Manifest binding read by the new process:

```json
{
  "decisions": { "physicalKey": "decisions", "kind": "list" },
  "workspace": { "physicalKey": "workspace", "kind": "object" },
  "workItems": { "physicalKey": "tasks", "kind": "list" }
}
```

Physical source keys remain:

```text
__project_identity
decisions
tasks
workspace
```

Current logical name `workItems` does **not** create a second physical collection. The status projection is still stored under physical `tasks`.

Machine result:

```text
CANDIDATE_PASS_IDENTITY_MANIFEST_REPLACES_PARALLEL_DISCOVERY_REGISTRY
```

## D — decision

**Candidate PASS** within this controlled file-SQLite process-restart scenario: a single existing durable identity manifest can supply both current logical declaration binding and bootstrap discoverability. The previous `__workspace` key-list registry is unnecessary when the application already uses the identity manifest.

This is **reuse of one registry**, not elimination of the bootstrap problem. The reader still needs one known durable bootstrap key, the application still chooses what counts as a workspace and a completed checkpoint, and the manifest format remains an experimental convention.

## C — competing explanations

The reader identifies application roles by inspecting values (`kind` / `id`), so domain-policy and validation responsibilities are not removed. A one-to-one logical rename with stable physical identity is a favorable case; split/merge, conflicting manifest versions, and durable corruption would require explicit handling. This experiment does not prove that the manifest contains enough semantics to auto-migrate state.

## U — remaining uncertainty

Not tested: multi-writer/version-skew, simultaneous readers during rename, semantic migration, process interruption during checkpoint advancement, hard power loss, external autonomous agents, browser backends, damaged manifest recovery, manifest format compatibility, or cross-project state namespaces.

The atomic task + checkpoint boundary is being evaluated independently in #87 / PR #88. The successful sequential checkpoint here must **not** be presented as crash-atomic.

## Reproduce

```sh
npm run experiment:identity-manifest-bootstrap
npm run release:check
```

The self-gating experiment requires the exact candidate-PASS label, current/physical binding invariants, complete fresh-reader recovery, a rejected obsolete declaration, and an unchanged source snapshot after the wrong-bootstrap control. No runtime or public API change is included.
