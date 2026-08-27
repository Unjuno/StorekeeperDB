# Many-to-one declared-state merge migration boundary

Status: **BOUNDARY CONFIRMED in CI #205 — experiment-only.**

This experiment is the reverse-direction replication of the one-to-many split boundary from Issue #56. It asks whether two durable logical states can safely become one state through the one-to-one rename identity mechanism, and what additional semantics are required when source values conflict.

No public migration API is authorized by this result.

## Scenario

```text
account {
  displayName,
  locale
}

preferences {
  compactMode,
  locale
}

        ↓

profile {
  displayName,
  compactMode,
  locale
}
```

`locale` deliberately exists in both sources. A conflict-free run uses the same value in both. A conflict run uses `account.locale = "en-US"` and `preferences.locale = "ja-JP"`.

## H — hypothesis

Many-to-one merge is not an identity-only operation. It requires an explicit semantic transform and, when multiple durable sources contribute competing values to one target field, an explicit conflict-resolution policy.

A controlled merge should remain implementable with the existing runtime primitives if the complete migration unit is transactional:

```text
read sources
→ validate / resolve conflicts
→ construct target
→ retire sources
→ update identity manifest
→ clean source derived metadata
```

## T — test

Four cases were executed against independent SQLite databases.

### A. Naive remove two sources + add one target

After durable `account` and `preferences` values were established, the declaration was changed directly to only `profile`.

Expected: fail before a fresh target can be accepted.

Observed:

```text
rejected            true
sources preserved   true
profile target      absent
manifest preserved  true
```

Error:

```text
New durable declaration profile is ambiguous with removed state account,preferences; provide an explicit rename alias.
```

### B. Misuse one-to-one alias for only one merge source

Attempt:

```text
profile from account
```

while `preferences` also disappears.

Observed: the current identity wrapper rejected the declaration because the second removed source remained unexplained.

```text
Removed durable declaration requires explicit migration: preferences
```

This is safer than the split-direction misuse found in #56: the current one-to-one alias mechanism cannot silently consume only one of two removed merge sources.

### C. Explicit conflict-free atomic merge

Both source locales were `en-US`. Before migration, `locale` projections were established for both sources so rollback/source-retirement checks included derived metadata.

The experiment performed the complete migration inside one outer `StorekeeperDB.batch()`:

```text
read account + preferences
resolve locale
create profile
retire account
retire preferences
update identity manifest
retire source projections
compact source observations
```

A failure was injected after all mutations.

Rollback result:

```text
both source values restored            PASS
profile target removed                 PASS
identity manifest restored             PASS
source projections/derivations restored PASS
source observation counters exact       PASS
```

The exact source path snapshots were byte-for-byte equivalent at the structured-row level before and after the failed migration:

```text
metadataCountersExactlyRestored = true
```

The same migration was then retried without failure. After reopen:

```text
account rows      0
preferences rows  0
profile rows      1
profile.displayName  "Persisted account"
profile.compactMode  true
profile.locale       "en-US"
```

No active source projection/derivation/observation metadata remained.

### D. Conflicting source values

Input:

```text
account.locale      = "en-US"
preferences.locale  = "ja-JP"
```

Without an explicit policy, the migration rejected inside the transaction before value/identity mutation:

```text
Merge conflict for locale: account=en-US, preferences=ja-JP; explicit policy required.
```

With explicit policy:

```text
prefer-account
```

`profile.locale = "en-US"` persisted deterministically across reopen.

## Observer-effect correction discovered during the experiment

The first merge run, CI #201, reported:

```text
BOUNDARY_CONFIRMED_WITH_METADATA_COUNTER_ROLLBACK_GAP
```

There were two distinct causes that had to be separated.

First, StorekeeperDB's own `memorySnapshot()` used observable proxies while preparing outer-batch rollback state. That internal JSON cloning incremented `__sk_paths.read_count` before the SQLite transaction. Issue #62 / PR #63 fixed this by suppressing observation only during the internal snapshot. CI #202 passed the regression.

After that fix, CI #204 still showed +1 only on fields explicitly read by the merge transform. Inspection showed those source reads occurred before `batch()` in the experiment itself. They were therefore legitimate observations outside the transaction and could not be expected to roll back.

The experiment was corrected without weakening its invariant: source reads and conflict resolution were moved inside the same `batch()` as target construction and retirement. CI #205 then produced exact counter restoration.

This yields an architectural rule:

> If observation metadata is part of the behavior-driving durable runtime state, an atomic migration unit must include source reads and validation, not only its writes.

## D — decision

CI #205 selected:

```text
BOUNDARY_CONFIRMED_MERGE_REQUIRES_EXPLICIT_CONFLICT_AWARE_MIGRATION
```

All primary checks were true:

```text
naiveMergeSafelyRejected                     true
aliasMergeMisuseSafelyRejected               true
explicitConflictFreeMergeIsAtomicAndComplete true
conflictingMergeRequiresExplicitPolicy       true
metadataCountersExactlyRestored              true
```

## C — competing explanation

The tested merge could have disproved the hypothesis if a one-to-one alias plus ordinary compatible evolution preserved both durable sources and resolved duplicate fields unambiguously. It did not.

The current alias wrapper instead rejected the unexplained second source, and conflicting values required an explicit policy. This supports keeping identity rename and semantic migration as separate concepts.

## Architecture consequence

The evidence now separates three evolution classes:

```text
compatible additive/value-preserving evolution
  -> may remain automatic

one-to-one logical rename
  -> explicit identity alias
  -> stable physical identity may avoid metadata migration

split / merge / semantic transformation
  -> explicit transactional transform
  -> source reads + validation inside transaction
  -> explicit conflict policy when needed
  -> explicit source retirement
  -> explicit derived-metadata cleanup
```

The existing public runtime primitives were sufficient to implement the controlled split and merge experiments. That is evidence about capability, not evidence that application authors should manually assemble this sequence forever. A dedicated migration surface remains undecided.

## U — uncertainty

Still untested:

- incompatible field-level value transformations such as scalar → object;
- enum narrowing and required-field introduction;
- collection-to-collection merge/split;
- concurrent/version-skew migration;
- migration idempotency and crash/retry markers;
- whether an eventual migration context should encapsulate lifecycle cleanup and identity-manifest updates.

No public migration API is authorized by this result.
