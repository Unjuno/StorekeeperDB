# Runtime hardening

This document records the first runtime-hardening pass after the public alpha baseline.

## Scope

The goal is not to import the full pre-repo v22 lifecycle yet. The goal is to make the current public alpha harder to misuse.

Changes in this pass:

- Failed outer `batch()` calls restore loaded list state.
- Item and nested proxies captured before a failed `batch()` are invalidated after rollback.
- Projection cells are removed when a scalar path disappears.
- Supported array mutators are covered by projection and reopen tests.
- Nested object and nested array mutations are covered by reopen tests.
- Signal subscribers receive one notification after an outer batch commit.
- Magic log actions use clearer names: `project_create`, `project_touch`, `project_evict`, `project_rebuild`.

## Stale proxy rule

After a failed batch, re-read objects from the state list.

```ts
const tasks = sk.state<Task[]>("tasks", []);
const item = tasks[0]!;

try {
  sk.batch(() => {
    item.priority = "urgent";
    throw new Error("abort");
  });
} catch {}

// Correct alpha usage: re-read from the list.
const current = tasks[0]!;
```

Old item proxies throw a `Stale Storekeeper proxy after rollback` error after rollback. This is intentional. It is safer than silently mutating a detached object.

## Remaining alpha limits

- Transaction-scoped handles are not implemented.
- Browser async storage is still outside the local SQLite runtime.
- Full v20-v22 derived lifecycle policy is not yet re-imported.
