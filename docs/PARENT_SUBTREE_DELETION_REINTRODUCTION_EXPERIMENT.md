# Parent/subtree deletion and reintroduction experiment

Issue: [#80](https://github.com/Unjuno/StorekeeperDB/issues/80)  
PR: [#81](https://github.com/Unjuno/StorekeeperDB/pull/81)  
Status: **MIXED in CI #287; experiment only.** No runtime or public API change is included in this experiment PR.

## H — falsifiable hypothesis

Deleting an entire nested parent with two active descendant projections is expected to remove both current cells, preserve a prefix-neighbor subtree, survive rollback and reopen, and permit coherent reintroduction. A child handle captured before the parent deletion should reject subsequent writes; accepting detached writes is a separate lifetime-contract failure even if the deleted subtree is not resurrected.

## T — controlled replication

```text
routing:       { queue: "critical", legacyTag: "legacy-one" }
routingBackup: { queue: "backup" }
  -> activate three projections
  -> inject failure after delete routing (rollback control)
  -> delete routing
  -> attempt staleRouting.queue = "stale-resurrection-attempt"
  -> inspect SQLite physical state BEFORE find()
  -> close/reopen
  -> reintroduce routing: { queue: "normal", legacyTag: "legacy-two" }
  -> inspect physical state BEFORE find()
  -> close/reopen
```

Application mutation uses the public `state()`, `find()`, and `batch()` surfaces. Test-only SQLite queries and triggers observe source, paths, derivations, and projection-row DELETE/INSERT operations.

## D — observed result

```text
MIXED_PARENT_SUBTREE_CURRENT_STATE_CORRECT_BUT_STALE_CHILD_WRITE_ACCEPTED
```

Observed in **CI #287**:

| Check | Observed |
| --- | --- |
| Initial topology, active projections, injected failure | PASS |
| Physical rollback including paths, derivations, projections | PASS |
| Parent source/descendant projection removal before subsequent queries | PASS |
| `routingBackup.queue` prefix-neighbor preserved | PASS |
| Deleted-value queries, item identity, first reopen | PASS |
| Parent reintroduction, new-value queries, second reopen | PASS |
| No duplicate or stale descendant projection cells | PASS |
| Stale child write rejected | **NO** |
| Detached child target locally mutated | **YES** |
| Deleted subtree resurrected in durable source | **NO** |
| Stale write caused redundant projection persistence operations | **YES** |

The captured child proxy retains the live owner-item proxy and therefore passes the current owner-generation/identity checks even after its own parent property was deleted. The detached value can be changed; an unrelated current projection is unnecessarily re-written even though the persisted source subtree remains deleted. This is **not current-state corruption**, but it violates the intended command-handle lifetime model and can produce misleading successful writes.

The initial experiment also incorrectly expected six audited row operations upon reintroduction. In fact two descendant cells were already absent, so their SQL DELETE statements match zero rows and produce **no trigger events**. Only four actual row operations occur: INSERT for each descendant plus DELETE/INSERT for the unchanged prefix-neighbor. The experiment expectation was corrected independently of the runtime finding.

After these corrections, the experiment must be guarded with the **exact MIXED decision** and explicit physical-state, rollback, and handle checks. A green exit based solely on membership in a PASS/MIXED/FAIL set is insufficient.

## C — competing explanations and tests

- A post-delete `find()` could repair stale projection storage; snapshots are taken **before** queries.
- Prefix matching could remove `routingBackup`; its source/projection/query are explicitly checked.
- Accepted stale child writes could silently resurrect `routing`; physical snapshots exclude that possibility in this fixture.
- Extra projection writes could be a broken write-shape prediction rather than a runtime regression; compare actual triggered rows with old-row membership and do not count zero-row DELETE statements.
- Retained path/derivation rows are history, not stale current cells.

## Follow-up correction — #82 / PR #83

Status: **FIXED in CI #300; full `npm run release:check` PASS (34 tests).**

```text
REPLICATION_PASS_PARENT_SUBTREE_DELETE_REINTRODUCTION_COHERENT
```

The nested proxy now checks both its owner-item lifetime and captured parent/child identity links before any mutation. Deleting or replacing an ancestor invalidates all captured descendant writes, while detached values remain readable. The previously accepted stale child write is now rejected; its local target stays unchanged and no source/projection/path/derivation/magic-log writes or trigger events occur. Live nested objects, nested arrays, projection queries, and reopen remain valid. The original CI #287 MIXED result is retained above as the falsifying baseline.

## U — remaining uncertainty

The tested fixture has one source item, two projected descendants, one prefix-neighbor projection, and one synchronous SQLite writer. Multi-row parent deletion, nested arrays, old/new process overlap, cross-process concurrency, and crash recovery are not established. The runtime fix must be evaluated separately; this PR does not authorize a new API.

**Next step:** Add subtree-membership/identity invalidation to nested proxy writes, with dedicated tests that an active child still writes durably, a displaced child fails loudly, and no stale write triggers source/projection/observation changes. Run the existing leaf, rollback, and projection regression suites after the fix.
