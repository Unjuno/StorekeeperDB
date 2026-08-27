# Root-state semantics evaluation

Status: **CANDIDATE B — prefer a narrow singleton/object direction; arbitrary raw-root `state()` is not justified.**

Issue: #40. First measured run: CI #128.

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

An arbitrary root is therefore not just a TypeScript signature change.

## Candidate results — CI #128

```text
A — current list-only
  nested mutation persists                    PASS
  singleton list ceremony remains             YES
  whole-item replacement exists               YES
  old handle write after replacement          ACCEPTED
  memory/durable divergence after old write   YES
  scalar root                                 NO

B — narrow singleton/object helper
  nested mutation persists                    PASS
  singleton list hidden at callsite           YES
  rollback invalidates old handle              PASS
  signal notifications                        3
  signal snapshot version advances            PASS
  whole-root replacement exposed              NO, intentionally
  scalar root                                 NO

C — explicit root cell
  scalar cell persistence                      PASS
  object nested mutation                       PASS
  signal notification/version                  PASS
  primitive mutation requires `.value`         YES
  raw primitive mutable-reference model        IMPOSSIBLE
  old nested write after value replacement     ACCEPTED
  old nested write changes current root        NO
```

Machine decision:

```text
PREFER_NARROW_SINGLETON_OBJECT_PROTOTYPE
```

## Finding 1 — candidate A exposes an existing replacement correctness defect

The experiment tested:

```ts
const metadata = sk.state<ProjectMeta[]>("project", [initial]);
const old = metadata[0]!;

metadata[0] = replacement;
old.cwd = "/stale-overwrite";
```

The replacement reuses the durable item id. The old proxy remains in the same loaded generation, and current writability checks only require that an item with the same durable id is still a member.

Observed in CI #128:

```text
oldHandleWriteAcceptedAfterReplacement       true
memoryDurableDivergenceAfterOldHandleWrite   true
```

The loaded list still points at the replacement object, while the old proxy can persist its old root payload. Reopen then observes data different from current loaded memory.

This is not a root-API preference issue. It is a runtime correctness defect tracked separately in #42 and should be fixed before adding new singleton/root surface.

Required stronger invariant:

```text
active current proxy                    writable
reordered current proxy                 writable
removed proxy                           write rejected
rollback old-generation proxy           rejected
replaced old proxy with reused id       rejected
new replacement proxy                   writable
```

## Finding 2 — candidate B removes the measured ceremony without a new storage/lifetime model

Prototype:

```ts
const project = singletonObjectState(sk, "project", initial);
project.preferences.verbose = true;
```

The helper is implemented only over current public `state()` / `signal()` behavior.

Observed:

- nested mutation persisted after reopen;
- rollback restored durable/loaded state;
- the pre-rollback object handle became stale and rejected writes;
- re-reading through the helper returned the fresh object handle;
- a singleton signal could map the current one-item list dynamically without exposing the list at the callsite;
- notifications/version progression remained available;
- whole-root replacement was deliberately not invented.

This matters because B removes the observed `singleton-list-boundary` ceremony while preserving the existing durable-item mental model.

The current evidence supports only an **object singleton** direction. It does not justify scalar roots or automatic root replacement.

## Finding 3 — candidate C proves scalar persistence is possible only with explicit replacement/cell semantics

A raw JavaScript primitive cannot behave as a mutable persistent reference:

```ts
let count = sk.state("count", 0);
count++;
```

`count++` rebinds the local variable. No runtime can intercept that primitive-variable assignment through the returned number.

The executable C prototype therefore uses:

```ts
const count = rootCell(sk, "count", 0);
count.value++;
```

This persisted and signaled correctly, but changes the abstraction from “ordinary value” to an explicit mutable cell.

So a generalized signature like:

```ts
state("count", 0): number
```

cannot honestly provide mutation-by-reference durability. A generic root API would need one of:

- a cell/value wrapper;
- explicit `get()` / `set()` replacement semantics;
- inconsistent overloads where objects and primitives behave differently.

None is justified merely to remove singleton-list syntax.

## Finding 4 — cell object replacement creates another stale-handle ambiguity

The C prototype also tested:

```ts
const project = rootCell(sk, "project", initial);
const oldValue = project.value;

project.value = replacement;
oldValue.cwd = "/stale-write";
```

The old nested proxy write was accepted, but it did not modify the current root or the reopened replacement value.

That is safer than A's memory/durable divergence, but still semantically poor: a write to a detached old root appears to succeed while having no effect on the current durable value and may still trigger persistence/notification work.

Therefore C still lacks a clear replacement-lifetime contract.

## Decision matrix

| Criterion | A list-only | B singleton/object | C arbitrary/cell |
| --- | --- | --- | --- |
| removes singleton list ceremony | no | **yes** | yes, but adds cell ceremony |
| reuses durable-item identity model | yes | **yes** | partially |
| nested object mutation | pass | **pass** | pass |
| rollback old-handle semantics | existing | **pass** | inherited holder semantics |
| raw scalar root | no | no | **not coherent without wrapper** |
| whole-root replacement clarity | **unsafe today (#42)** | explicitly out of scope | ambiguous old nested handles |
| query/projection fit | native | native underlying item | not naturally universal |
| implementation/storage expansion | none | **small wrapper surface** | larger semantic expansion |
| current decision | reject as singleton UX answer | **preferred direction** | do not generalize yet |

## H — result

The hypothesis that B can remove the measured singleton ceremony while reusing current lifecycle semantics is **supported by the first executable prototype**.

The stronger hypothesis that `state()` should generalize directly to arbitrary JSON roots is **not supported**. Primitive reference semantics are impossible without changing the API model, and root replacement lifetime remains ambiguous.

## D — decision

Current candidate direction:

> Prefer a narrow singleton/object abstraction over broad arbitrary-root `state()` generalization.

But do not add the public API in this experiment PR.

Sequence:

1. fix #42 replacement-handle invalidation;
2. re-run this experiment with the stronger replacement invariant;
3. only then open a focused singleton/object API implementation issue;
4. keep scalar/cell support separate until a real scalar-root scenario demonstrates value beyond syntax.

## C — counter-hypotheses still alive

1. Singleton-list ceremony may still be too small to justify permanent public API surface.
2. A singleton helper could create discoverability/naming cost despite runtime simplicity.
3. A future explicit `cell()` abstraction could be valuable for scalar checkpoints/config, but that is a separate product hypothesis.
4. Root replacement might eventually deserve first-class semantics, but it must have explicit invalidation before being surfaced.

## U — uncertainty

- prevalence of singleton object state across realistic users;
- final public name, if any, for a singleton/object API;
- whether singleton signals belong as a separate API or can be derived ergonomically;
- whether object replacement should be unsupported, explicit, or identity-invalidating;
- whether scalar cells belong in core;
- browser/async implications.

## Run

```bash
npm run experiment:root-state-semantics
```

The output is machine-readable JSON. This PR records experimental evidence only; StorekeeperDB runtime/public API behavior is unchanged.
