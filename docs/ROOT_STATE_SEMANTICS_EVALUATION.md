# Root-state semantics evaluation

Status: **CANDIDATE B REVALIDATED — prefer a narrow singleton/object direction; arbitrary raw-root `state()` is not justified.**

Issue: #40. First measured run: CI #128. Replacement-hardening revalidation: CI #136 / #42.

## Goal

Evaluate whether StorekeeperDB should keep list-only root state, add a narrow singleton/object abstraction, or generalize toward arbitrary JSON root values.

This experiment is motivated by measured product friction, not feature-count growth. The CLI metadata replication (#38) showed lower persistence edit surface but one extra persistence concept: `singleton-list-boundary`.

## Current runtime facts

The runtime is organized around durable list items:

```text
state<T extends object[]>(key, initial)
loaded state = list of durable item proxies
storage      = row per item
rollback     = replace loaded rows + increment generation
writable     = current generation + current durable item id membership + current proxy identity
find()       = query durable items
liveFind()   = detached read snapshots
```

The final proxy-identity clause was added by #42 after the first experiment exposed a direct-replacement stale-handle defect.

An arbitrary root is therefore not just a TypeScript signature change.

## Candidate results after #42 — CI #136

```text
A — current list-only
  nested mutation on replacement persists        PASS
  singleton list ceremony remains                 YES
  whole-item replacement exists                   YES
  old handle write after replacement              REJECTED
  memory/durable divergence after old write       NO
  lifecycle safe                                  YES
  scalar root                                     NO

B — narrow singleton/object helper
  nested mutation persists                        PASS
  singleton list hidden at callsite               YES
  rollback invalidates old handle                  PASS
  signal notifications                            3
  signal snapshot version advances                PASS
  whole-root replacement exposed                  NO, intentionally
  scalar root                                     NO

C — explicit root cell
  scalar cell persistence                          PASS
  object nested mutation                           PASS
  signal notification/version                      PASS
  primitive mutation requires `.value`             YES
  raw primitive mutable-reference model            IMPOSSIBLE
  old nested write after value replacement         ACCEPTED
  old nested write changes current root            NO
```

Machine decision remains:

```text
PREFER_NARROW_SINGLETON_OBJECT_PROTOTYPE
```

## Finding 1 — #42 removed the candidate-A correctness defect

The first CI #128 probe showed that direct replacement reused a durable item id and allowed a displaced old proxy to keep writing. That could make loaded memory and reopened durable state diverge.

#42 strengthened writability from:

```text
current generation + current durable id membership
```

to:

```text
current generation + current durable id membership + exact current proxy identity
```

CI #136 re-ran the same replacement probe and observed:

```text
oldHandleWriteAcceptedAfterReplacement       false
memoryDurableDivergenceAfterOldHandleWrite   false
candidateA.aLifecycleSafe                    true
```

The current replacement proxy remained writable, nested mutation on it persisted, and the pre-replacement nested value did not reappear after reopen.

Reorder remains valid because it moves the same proxy object. Removal still fails the id-membership check. Rollback still fails the generation check. Replacement now uniquely fails the exact-proxy check for the displaced object.

## Finding 2 — candidate B remains viable after stronger identity semantics

Prototype:

```ts
const project = singletonObjectState(sk, "project", initial);
project.preferences.verbose = true;
```

The helper is implemented only over current public `state()` / `signal()` behavior.

Both the original and post-#42 runs confirm:

- nested mutation persists after reopen;
- rollback restores durable/loaded state;
- the pre-rollback object handle becomes stale and rejects writes;
- re-reading through the helper returns the fresh object handle;
- a singleton signal can map the one-item list without exposing the list at the callsite;
- notifications/version progression remain available;
- whole-root replacement is deliberately not invented.

This matters because B removes the observed `singleton-list-boundary` ceremony while preserving the existing durable-item mental model.

The evidence supports only an **object singleton** direction. It does not justify scalar roots or automatic root replacement.

## Finding 3 — candidate C still requires explicit replacement/cell semantics

A raw JavaScript primitive cannot behave as a persistent mutable reference:

```ts
let count = sk.state("count", 0);
count++;
```

`count++` rebinds the local variable. The returned number cannot intercept that assignment.

The executable C prototype therefore uses:

```ts
const count = rootCell(sk, "count", 0);
count.value++;
```

This persists and signals correctly, but changes the abstraction from “ordinary value” to an explicit mutable cell.

A generalized signature like:

```ts
state("count", 0): number
```

cannot honestly provide mutation-by-reference durability. A generic root API would need one of:

- a cell/value wrapper;
- explicit `get()` / `set()` replacement semantics;
- inconsistent overloads where objects and primitives behave differently.

None is justified merely to remove singleton-list syntax.

## Finding 4 — nested identity below a root-cell replacement remains ambiguous

The C prototype tests:

```ts
const project = rootCell(sk, "project", initial);
const oldValue = project.value;

project.value = replacement;
oldValue.cwd = "/stale-write";
```

Even after #42, the old nested proxy write is accepted because the durable holder item proxy itself has not been replaced; only its `value` property changed. The stale nested write does not change the current root or reopened replacement value, but it appears to succeed.

This is not a defect in the current public list/item contract. It is evidence that a future generic root-cell replacement API would require a deeper nested-generation/path identity model or explicit detached-reference semantics.

Therefore C still lacks a sufficiently clean replacement-lifetime contract.

## Decision matrix

| Criterion | A list-only | B singleton/object | C arbitrary/cell |
| --- | --- | --- | --- |
| removes singleton list ceremony | no | **yes** | yes, but adds cell ceremony |
| reuses durable-item identity model | yes | **yes** | partially |
| nested object mutation | pass | **pass** | pass |
| rollback old-handle semantics | pass | **pass** | inherited holder semantics |
| direct item replacement stale handle | **pass after #42** | not exposed | different nested ambiguity |
| raw scalar root | no | no | **not coherent without wrapper** |
| query/projection fit | native | native underlying item | not naturally universal |
| implementation/storage expansion | none | **small wrapper surface** | larger semantic expansion |
| current decision | safe but retains ceremony | **preferred direction** | do not generalize yet |

## H — result

The hypothesis that B can remove measured singleton ceremony while reusing current lifecycle semantics is **supported and revalidated after #42**.

The stronger hypothesis that `state()` should generalize directly to arbitrary JSON roots remains **not supported**. Primitive reference semantics require a different API model, and root-cell replacement lifetime remains ambiguous.

## D — decision

Current candidate direction:

> Prefer a narrow singleton/object abstraction over broad arbitrary-root `state()` generalization.

#42 removes the runtime blocker that was discovered during the first experiment. The next work should therefore evaluate the **smallest permanent public surface** for candidate B rather than widening `state()`.

Constraints for that follow-up:

- object singleton only;
- reuse existing row-per-item storage and handle semantics;
- no primitive mutable-reference claim;
- no implicit whole-root replacement API;
- public naming must justify itself against simply documenting the one-item-list convention;
- signal/reactive behavior must remain consistent with existing `signal()` semantics.

## C — counter-hypotheses still alive

1. Singleton-list ceremony may still be too small to justify permanent public API surface.
2. A singleton helper could create naming/discoverability cost despite runtime simplicity.
3. A future explicit `cell()` abstraction could be valuable for scalar checkpoints/config, but that is a separate product hypothesis.
4. Supporting object replacement in a singleton API may reintroduce lifecycle complexity and should not be assumed.

## U — uncertainty

- prevalence of singleton object state across realistic users;
- final public name and package surface, if any;
- whether singleton signals belong as a separate method or a returned view;
- whether whole-object replacement should be unsupported or a separately explicit operation;
- whether scalar cells belong in core;
- browser/async implications.

## Run

```bash
npm run experiment:root-state-semantics
```

The output is machine-readable JSON. Candidate B is an evidence-backed direction, not yet a public API commitment.
