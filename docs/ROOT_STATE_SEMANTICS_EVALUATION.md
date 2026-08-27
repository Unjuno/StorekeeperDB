# Root-state semantics evaluation

Status: **experiment implemented; result pending CI execution.**

Issue: #40.

## Goal

Evaluate whether StorekeeperDB should keep list-only root state, add a narrow singleton/object abstraction, or generalize toward arbitrary JSON root values.

This experiment is motivated by measured product friction, not feature-count growth. The CLI metadata replication (#38) showed lower persistence edit surface but one extra persistence concept: `singleton-list-boundary`.

## Current runtime facts

The current runtime is organized around durable list items:

```text
state<T extends object[]>(key, initial)
loaded state = list of durable item proxies
storage      = row per item
rollback     = replace loaded rows + increment generation
writable     = current generation + current durable item id membership
find()       = query durable items
liveFind()   = detached read snapshots
```

These facts matter because an arbitrary root is not just a TypeScript signature change.

## Candidates

### A — keep list-only state

```ts
const metadata = sk.state<ProjectMeta[]>("project", [initial]);
const project = metadata[0]!;
```

This keeps every current lifecycle rule, but preserves collection ceremony for a single logical value.

The experiment also probes whole-item replacement:

```ts
const old = metadata[0]!;
metadata[0] = replacement;
old.cwd = "/stale-write";
```

The result is important because replacement reuses the durable item id today.

### B — narrow singleton/object helper

Prototype only outside the runtime:

```ts
const project = singletonObjectState(sk, "project", initial);
```

The helper is built only on public `state()` / `signal()` behavior. It hides the collection at the callsite while deliberately not adding scalar roots or a second storage model.

Required checks:

- nested mutation persists;
- rollback invalidates the previously returned object handle;
- re-reading returns the fresh handle;
- signal version/subscription behavior can be mapped without exposing the list;
- whole-root replacement is not silently invented by the helper.

### C — arbitrary-root/cell prototype

A raw primitive cannot behave as a persistent mutable reference in JavaScript:

```ts
let count = sk.state("count", 0);
count++;
```

`count++` only rebinds the local variable; a primitive value cannot intercept that assignment.

Therefore the executable prototype uses an explicit cell:

```ts
const count = rootCell(sk, "count", 0);
count.value++;
```

The same cell can contain an object:

```ts
const project = rootCell(sk, "project", initial);
project.value.cwd = "/next";
project.value = replacement;
```

This makes scalar replacement executable, but introduces a wrapper concept and creates a second lifetime question: what should happen to an old nested object handle after `cell.value = replacement`?

## H — hypothesis

Candidate B should be preferable if it removes the observed singleton-list ceremony while reusing current durable-item rollback, identity, and notification semantics.

Candidate C should only advance if raw object/array/scalar roots can have one coherent contract. A shorter signature is insufficient when primitives require explicit replacement/cell semantics or root replacement leaves ambiguous old handles.

## T — executable probes

`scripts/root_state_semantics_experiment.ts` runs isolated SQLite files for A, B, and C.

### A probes

- nested mutation;
- whole-item replacement;
- old-handle write after replacement;
- memory vs reopened durable value.

### B probes

- singleton helper nested mutation;
- failed batch rollback;
- old-handle rejection after rollback;
- re-read fresh object;
- singleton signal notification/version behavior;
- reopen verification.

### C probes

- scalar cell `value++` persistence;
- cell signal notification/version behavior;
- object nested mutation;
- whole-cell value replacement;
- old nested handle write after replacement;
- whether that old write changes the current/reopened root.

## D — decision rules

### Prefer A

Only if B/C fail to remove enough ceremony or introduce worse lifecycle semantics.

### Prefer B

When:

- object singleton use works through current public behavior;
- rollback/stale semantics stay aligned with durable item handles;
- reactive wrapping is straightforward;
- no scalar/reference fiction is introduced;
- whole-root replacement can remain explicitly out of scope.

### Continue C

Only when:

- scalar semantics are explicit and acceptable;
- object/root replacement has a clear stale-handle rule;
- one coherent reactive model can cover object and scalar roots;
- storage/rollback implementation growth is justified by scenarios beyond singleton cosmetics.

### UNCERTAIN

When raw primitive semantics or replacement lifetime remain unresolved.

## C — counter-hypotheses

1. Singleton-list ceremony may be tolerable and not justify a permanent API.
2. A singleton helper may only rename the list boundary rather than remove meaningful complexity.
3. A generic `state()` signature may be syntactically attractive but impossible to honor uniformly for primitive mutation.
4. A `cell.value` design may solve primitives but add roughly the same ceremony under a different name.
5. Root replacement can invalidate or detach handles in ways not currently encoded by membership-by-id alone.

## U — uncertainty

- whether singleton object state is common enough for public API surface;
- whether replacement should be supported at all for object-state handles;
- whether primitive durable values belong in core or a separate cell/value abstraction;
- migration/storage compatibility if a future root representation is not row-per-item;
- behavior with browser/async backends.

## Run

```bash
npm run experiment:root-state-semantics
```

The output is machine-readable JSON. Product comparison results do not themselves modify runtime behavior in this PR.
