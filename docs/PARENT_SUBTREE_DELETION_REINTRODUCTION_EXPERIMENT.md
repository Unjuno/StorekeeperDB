# Parent subtree deletion and reintroduction experiment

Issue: #80

Status: **ACTIVE EXPERIMENT — result not yet fixed.**

This probe tests whether the nested projected-leaf lifecycle established by #78 generalizes when the entire projected parent object is deleted, reopened, and later reintroduced.

The controlled topology activates projections for:

- `routing.queue`
- `routing.legacyTag`
- `routingBackup.queue` as an explicit prefix-neighbor control

The experiment inspects physical projection state before post-mutation queries so lazy query repair cannot hide stale descendant cells. It also captures a `routing` child proxy before parent deletion and attempts a write after deletion to distinguish three cases:

1. stale child write is rejected;
2. stale child write is accepted but cannot alter durable source/projections;
3. stale child write resurrects or corrupts current durable state.

Candidate decisions:

```text
REPLICATION_PASS_PARENT_SUBTREE_DELETE_REINTRODUCTION_COHERENT
MIXED_PARENT_SUBTREE_CURRENT_STATE_CORRECT_BUT_STALE_CHILD_WRITE_ACCEPTED
FAIL_PARENT_SUBTREE_DELETE_OR_STALE_HANDLE_CORRUPTS_CURRENT_STATE
INVALID_EXPERIMENT
```

No runtime or public API change is authorized until the first controlled CI result is recovered.
