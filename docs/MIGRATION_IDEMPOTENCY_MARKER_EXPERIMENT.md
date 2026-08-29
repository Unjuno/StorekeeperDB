# Migration idempotency and crash/retry marker experiment

Status: **CANDIDATE PASS in CI #232; experiment-only.**

Issue: #70

## Goal

Determine whether a minimal durable applied-version marker is sufficient for restart-safe, idempotent incompatible migration in StorekeeperDB's local SQLite scope, without introducing a migration DSL.

The marker name and shape in this experiment are conventions only. No public API is added.

## H — falsifiable hypothesis

A single applied-version marker is sufficient only when:

1. the semantic value transform and marker commit in the same outer `batch()`; and
2. every run validates the marker/value pair before deciding to apply or skip.

A marker by itself does not prove semantic state.

## T — controlled scenario

Reuse the required-field migration:

```text
jobs / JOB-1
V1 { id: "JOB-1", queue: "bulk" }
  ->
V2 { id: "JOB-1", queue: "bulk", maxRetries: 3 }
```

Experiment-only marker:

```text
state: __migration_state
{ id: "jobs-required-maxRetries-v2", version: 1 }
```

The four durable state pairs are:

| Pair | Marker | Value | Expected action |
|---|---|---|---|
| A | absent | unmigrated | apply transform + marker atomically |
| B | present | migrated | validate and return `already-applied` |
| C | present | unmigrated | fail loudly as inconsistent |
| D | absent | migrated | fail loudly as ambiguous provenance |

The experiment also creates two deliberately unsafe split-commit controls:

```text
value commit -> simulated crash -> marker absent
marker commit -> simulated crash -> value unmigrated
```

## D — result

CI #232 passed the full `npm run release:check` and the experiment selected:

```text
CANDIDATE_MINIMAL_ATOMIC_MIGRATION_MARKER_SUFFICIENT
```

The experiment exits nonzero unless all core validity conditions below hold, so the full CI PASS establishes each condition.

### 1. Failure after value mutation

Inside one outer `batch()`:

```text
write maxRetries = 3
-> inject failure
-> marker not yet written
```

Result:

```text
failure rejected
exact physical rollback
value returned to unmigrated state
marker remained absent
```

The rollback comparison covers item rows plus path, derivation, and projection metadata for both the value state and marker state.

### 2. Failure after marker mutation

Inside one outer `batch()`:

```text
write maxRetries = 3
-> push applied marker
-> inject failure before outer commit
```

Result:

```text
failure rejected
exact physical rollback
value returned to unmigrated state
marker removed by rollback
```

Therefore the marker and semantic transform behave as one atomic durability unit when enclosed by the same outer transaction.

### 3. Successful retry after reopen

After the failed attempts, the database was closed/reopened and the migration retried.

The successful path committed:

```text
maxRetries = 3
one applied marker
status = applied
```

A later close/reopen retained both.

### 4. Idempotent rerun

After successful commit, the migration was reopened and executed again.

The PASS conditions require:

```text
status = already-applied
source item rows unchanged
path write-count total unchanged
exactly one migration marker
```

This is **write-idempotency**, not observation-neutrality.

For release-wording checks, the distinction is recorded plainly as: write-idempotency, not observation-neutrality.

The skip path still validates marker id/version and the durable value through ordinary observable reads. Those reads may advance observation/read metadata. That is intentional application observation, not a second semantic migration or durable value rewrite.

Therefore:

> `already-applied` means no semantic rewrite and no additional durable path writes; it does not mean validation reads are invisible to StorekeeperDB's observation model.

### 5. Marker present + value unmigrated

Pair C was constructed directly and then reopened.

The migration rejected with the marker/value inconsistency path and did not mutate the stranded durable state.

A marker must therefore be validated against semantic state; marker presence alone is not sufficient evidence of successful migration.

### 6. Marker absent + value migrated

Pair D was also constructed directly.

The migration rejected the state as ambiguous provenance rather than silently manufacturing marker history.

This deliberately avoids assuming that a matching value proves that this migration, this policy, or this version produced it.

### 7. Split-commit negative controls

Two unsafe implementations were tested outside one shared transaction.

#### Value first

```text
commit maxRetries = 3
-> simulated crash before marker commit
```

Reopen produced pair D:

```text
marker absent + migrated value
```

The strict runner rejected it without mutation.

#### Marker first

```text
commit marker
-> simulated crash before value commit
```

Reopen produced pair C:

```text
marker present + unmigrated value
```

The strict runner rejected it without mutation.

These controls demonstrate why `value commit` and `marker commit` cannot be separate durability units.

## Interpretation

For the tested single-process/local-SQLite scope, the smallest supported restart contract is:

```text
explicit semantic preconditions
        +
semantic value transform
        +
applied-version marker
        +
ONE outer transaction
        +
strict marker/value validation on every run
```

A narrower conclusion is justified:

> **Atomic semantic transform + applied marker + strict marker/value preconditions is sufficient for restart-safe write-idempotency in this controlled local migration.**

The experiment does **not** show that a marker alone proves semantic state. It also does not require a migration history table, lock manager, or migration DSL for this case.

## C — competing explanations

### The value itself is enough; no marker is needed

Not supported. Pair D deliberately contains the expected migrated value with no marker. The value cannot establish provenance or which migration policy produced it, so the experiment treats it as ambiguous.

### Marker presence is enough; value validation is unnecessary

Falsified by pair C. A marker can coexist with an unmigrated value if writes are split across commits or state is externally damaged. The value precondition must be checked.

### Separate commits are operationally equivalent

Falsified by both split-commit controls. Each commit order can strand one mismatch direction.

### Idempotent rerun should be observation-neutral

Not required by this result. StorekeeperDB's ordinary application reads are observable. The relevant contract here is no additional semantic/value writes; read-observation metadata is a separate concern.

## U — uncertainty

Still untested:

- concurrent old/new application processes;
- multiple writers and migration locking;
- process termination behavior outside transaction rollback guarantees;
- external/non-SQLite side effects;
- dependency ordering across multiple migrations;
- marker scope (state, project, release, or migration graph);
- recovery policy for deliberately ambiguous pair D;
- public migration API or DSL ergonomics.

No public migration API is authorized by this result.

## Next experiment

Probe explicit field deletion with an active projection. The key question is whether normal durable property deletion fully retires value-specific derived state or leaves path/derivation metadata that requires explicit migration cleanup.
