# State split/merge migration boundary experiment

Issue: #56  
PR: #57  
Status: **BOUNDARY CONFIRMED in CI #192; experiment-only.**

## Question

Where does one-to-one durable identity aliasing stop being sufficient, requiring explicit migration semantics to re-enter the coding agent's planning loop?

Tested split:

```text
profile { displayName, compactMode }
  ->
account { displayName }
preferences { compactMode }
```

## H — falsifiable hypothesis

One-to-one rename aliasing is correct when only logical identity changes, but it is insufficient for one-to-many state transformation.

A safe split must own four things explicitly:

1. value transformation;
2. atomic target creation;
3. source retirement;
4. source-derived metadata cleanup and identity-manifest transition.

The hypothesis fails if the alias layer itself safely preserves both split values, or if public StorekeeperDB transaction/lifecycle primitives cannot make the explicit split failure-atomic.

## T — minimal verification

Three paths were run against separate temporary SQLite databases.

### A — naive remove + add

Persist non-default `profile`, then declare only fresh `account` and `preferences` without an alias.

Expected: fail before either target is accepted.

### B — one-to-one alias misuse

Attempt:

```text
account from profile
preferences fresh
```

This is intentionally attractive but semantically suspicious: `account` can inherit physical identity from `profile`, while `preferences` has no mechanism telling it to extract `compactMode` from the same source value.

### C — explicit atomic split migration

Using public `StorekeeperDB.state()`, `batch()`, query/projection behavior, and lifecycle cleanup:

1. load `profile` and the identity manifest;
2. create a `displayName` projection on `profile` so source-derived state exists;
3. transform source value into `account` and `preferences`;
4. retire the source row;
5. update the manifest;
6. evict the source projection and compact source observation metadata;
7. inject an exception after all writes;
8. verify rollback restores source, targets, manifest, projection, and metadata;
9. rerun the same migration without the injected failure;
10. reopen through the project convention and verify transformed values.

Direct SQLite inspection is used only to verify physical source/metadata state. Application values and mutation use StorekeeperDB surfaces.

## D — observed result

CI #192 passed the complete `npm run release:check` gate.

### A — safe rejection

```text
rejected             PASS
source preserved     PASS
no partial targets   PASS
manifest unchanged   PASS
```

The wrapper rejected the naive split with:

```text
New durable declaration account is ambiguous with removed state profile; provide an explicit rename alias.
```

### B — semantically unsafe alias misuse

The alias misuse was structurally valid but semantically incomplete.

Observed:

```text
open succeeded                         YES
account.displayName preserved          YES
preferences.compactMode preserved      NO
preferences silently fresh-initialized YES
reopen remained structurally stable    YES
manifest looked structurally valid     YES
```

The result was durable but wrong for the intended split: the persisted `compactMode: true` became the fresh `preferences.compactMode: false`.

Therefore:

> **One-to-one rename aliasing is not a general migration mechanism.**

A structurally valid logical-to-physical mapping is not enough to prove semantic preservation when the number or meaning of states changes.

### C — explicit migration

Before migration, `profile:displayName` had an active projection.

The injected failure was thrown after target creation, source removal, manifest mutation, projection eviction, and metadata compaction.

**The injected failure restored source, targets, manifest, and derived metadata.**

After rollback:

```text
profile source row restored                PASS
account target absent                      PASS
preferences target absent                  PASS
profile manifest binding restored          PASS
profile derivation/projection restored     PASS
```

The successful rerun then produced:

```text
physical profile rows      0
physical account rows      1
physical preferences rows  1
profile derivations        0
profile projection cells   0
```

The new manifest contained only:

```text
account     -> physical account
preferences -> physical preferences
```

Reopen preserved both transformed values, and the retired logical `profile` declaration was rejected.

**Public batch/state plus explicit lifecycle cleanup was sufficient for the tested atomic split migration.**

Machine decision:

```text
BOUNDARY_CONFIRMED_SPLIT_REQUIRES_EXPLICIT_ATOMIC_MIGRATION
```

## Architectural interpretation

The experiments now separate two different evolution classes:

```text
one-to-one logical rename
  -> identity problem
  -> explicit alias at rename boundary
  -> physical identity may remain stable

one-to-many split
  -> value transformation problem
  -> explicit transaction
  -> explicit target identities
  -> explicit source retirement
  -> explicit derived-metadata cleanup
```

This is a useful hard boundary for the agent-first model:

> Routine compatible changes and identity-only renames can keep persistence mostly out of planning. A semantic state transformation must make persistence/migration explicit.

No public migration API is authorized by this result. The experiment proves the boundary and demonstrates sufficient internal/public primitives for one scenario; it does not determine the final migration surface.

## Observed rough edge

CI #191 exposed an unrelated but concrete type-surface mismatch.

The runtime lifecycle layer and exported `StorekeeperDebugAPI` accept object-form metadata compaction options, but the concrete `StorekeeperDB.debug()` static type is narrower.

> `StorekeeperDB.debug()` concrete static typing does not expose the object-form `compactMetadata()` accepted by `StorekeeperDebugAPI`.

The experiment used an explicit cast to the already-exported public debug API type so the split test could proceed without mixing a type fix into this experiment PR.

This should be corrected separately.

## C — competing explanations / ways this can still break

1. Only the split direction was tested; many-to-one merge remains unverified.
2. Only singleton object states were transformed. Collection-to-collection or mixed topologies may expose additional identity and ordering rules.
3. Concurrent processes running different declaration/migration versions were not tested.
4. Source lifecycle cleanup was assembled from existing debug primitives; a future migration surface may need a narrower dedicated retirement operation.
5. The identity manifest itself was mutated as durable state in the same batch, but a public project-level migration abstraction has not been designed.
6. The successful migration does not imply that arbitrary transforms are reversible or automatically inferable.

## U — uncertainty

Still unknown:

- many-to-one merge transformation and conflict semantics;
- multi-source/multi-target collection migration;
- concurrent/version-skew migration behavior;
- migration idempotency/retry conventions;
- whether a dedicated migration transaction/context belongs above StorekeeperDB core;
- whether source retirement deserves a first-class lifecycle primitive.

## Next work

First fix the directly observed `debug().compactMetadata()` static type mismatch in a separate small PR.

Then test the reverse migration:

```text
account + preferences
  ->
profile
```

The merge experiment should inject failure after reading both sources and writing the target, verify rollback of all three identities plus metadata, and define what happens when multiple sources provide conflicting values for a merged field.

Self-check:

> Is `batch + state + lifecycle cleanup + manifest update` sufficient as internal migration machinery, or does migration need a dedicated transaction/context boundary before any public surface is defensible?
