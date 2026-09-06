# Nested field deletion and reintroduction experiment

Issue #78 / PR #79 test the lifecycle of a nested projected scalar that disappears and later returns while its sibling projection remains active.

This is experiment-only evidence. It does not add or authorize a new runtime or public API.

## H — hypothesis

For one durable item with active `routing.queue` and `routing.legacyTag` projections, deleting `routing.legacyTag`, reopening, and later reintroducing it should preserve current source/query/projection correctness, item identity, rollback behavior, and reopen behavior without stale or duplicate projection cells.

## T — minimum test

Scenario:

```text
routing.legacyTag = "legacy-one"
        |
        v
delete routing.legacyTag
        |
        v
close / reopen
        |
        v
routing.legacyTag = "legacy-two"
        |
        v
close / reopen
```

The fixture keeps `routing.queue = "critical"` throughout and activates both scalar projections before deletion.

The experiment verifies:

- an injected nested-delete failure restores source, projection, metadata, loaded memory, and trigger audit state;
- successful delete removes only the nested source field while retaining `routing.queue`;
- physical projection state is inspected before queries, so a later query cannot hide a stale-cell defect by repairing it first;
- old-value lookup excludes the deleted value;
- close/reopen preserves absence;
- reintroduction restores the new value before query execution;
- projection cell counts remain singular, with no stale/duplicate `routing.legacyTag` cells;
- close/reopen preserves the reintroduced value;
- the durable item id and position remain stable across the tested lifecycle;
- existing derivation/path metadata remains coherent and reusable;
- projection writes follow the already-measured changed-item rebuild model.

## D — observed decision

CI #280 on PR head `9d7e41147a11290a58625e97bf0889d9071707e5` passed the tightened regression gate with:

```text
REPLICATION_PASS_NESTED_DELETE_REINTRODUCTION_COHERENT
```

The regression test now requires that exact decision. It no longer accepts PASS, MIXED, and FAIL as equivalent valid outcomes.

The gate also requires the expected values of the major checks:

```text
initial topology                    PASS
failure injection reached delete    PASS
exact physical rollback             PASS
loaded-memory rollback              PASS
rollback removed audit writes       PASS
source correct after delete         PASS
projection correct after delete     PASS
queries correct after delete        PASS
item identity stable                PASS
first reopen correct                PASS
source correct after reintroduction PASS
projection correct after reintro    PASS
no duplicate projection cells       PASS
queries correct after reintro       PASS
second reopen correct               PASS
metadata lifecycle coherent         PASS
expected item-local write shape     PASS
```

Expected non-error conditions are also asserted:

```text
deleteSuccessRejected       false
reintroductionRejected      false
```

## Projection-write observation

The nested lifecycle preserved correctness but did not become cell-diff maintenance.

Delete phase:

```text
routing.queue      DELETE + INSERT
routing.legacyTag  DELETE
```

Reintroduction phase:

```text
routing.queue      DELETE + INSERT
routing.legacyTag  INSERT
```

This is consistent with the existing changed-item projection rebuild model. It is not evidence that incremental cell maintenance is needed.

## C — competing explanations / how this can still break

- The fixture deletes one nested scalar leaf, not the parent object.
- A query is prevented from hiding stale storage in the tested checkpoints, but other lifecycle paths may still behave differently.
- Parent/subtree removal could invalidate multiple descendant paths at once and expose a different bug.
- Nested arrays are not covered.
- Multiple writers and concurrent old/new application versions are not covered.
- Metadata decay/compaction may interact differently with a deleted-then-reintroduced path.

## U — uncertainty

The following remain unproven:

```text
parent object deletion
nested array element deletion
concurrent old/new process access
multiple writers
automatic metadata decay interaction
product significance of projection write amplification
```

## Interpretation

The tested nested leaf lifecycle does not expose a stale-cell boundary. Ordinary durable mutation plus current projection maintenance is mechanically coherent for:

```text
nested scalar present
-> delete
-> reopen
-> reintroduce
-> reopen
```

The result should not be generalized to subtree deletion yet. The next correctness falsification target is deleting the projected parent object so multiple descendant projections disappear together, then testing rollback, reopen, reintroduction, and stale descendant handles.
