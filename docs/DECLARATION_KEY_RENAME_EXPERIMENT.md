# Declaration property rename and durable identity experiment

Issue: #50

Status: **CANDIDATE PASS in CI #168.**

This experiment follows the agent-facing project convention from Issue #48 / PR #49. That convention reduced routine per-prototype persistence decisions by deriving durable state keys from declaration property names. The unresolved question was whether a normal code refactor such as `settings -> preferences` would silently change durable identity.

The experiment is intentionally about an **incompatible persistence boundary**. It does not claim that state-key rename should be migration-free or automatic.

## H — hypotheses

### H1 — naive property rename is unsafe

If the durable key is derived directly from the declaration property name, renaming:

```ts
settings -> preferences
```

must not be treated as equivalent durable state unless explicit identity information exists.

### H2 — one explicit rename decision may be enough

A reusable project layer may keep routine compatible code free of explicit durable-key bookkeeping while requiring one explicit alias at the actual incompatible rename boundary.

Target shape:

```text
compatible path -> no explicit durable key decision
rename boundary -> one explicit alias decision
later reopen    -> alias no longer required
```

### H3 — stable ids may be too expensive on the ordinary path

A permanent stable id can preserve rename semantics, but if every state declaration needs one from V1 then it reintroduces the `state-keying` decision that the project convention was intended to remove.

## T — test

The same project-board topology was used on four separate temporary SQLite databases:

- task collection, unchanged across the refactor;
- singleton project settings with non-default persisted values;
- close/reopen before rename to establish durability;
- declaration property rename `settings -> preferences`;
- another reopen after the rename strategy.

Direct SQLite inspection is used **only as experiment instrumentation** to verify physical `state_key` duplication. Application behavior uses the public StorekeeperDB contract or experiment-only project-layer helpers.

The persisted pre-rename values are intentionally distinguishable from initial defaults so a silent reset is observable.

## Candidates

### A — naive property-derived key

No identity metadata is provided. V1 uses:

```ts
settings: object(initialSettings())
```

V2 changes only the declaration property name:

```ts
preferences: object(initialSettings())
```

This is the negative control.

### B — fail-loudly declaration identity manifest

An experiment-only durable identity manifest stores the previously known declaration names and state kinds. An unexplained declaration identity change is rejected before new state is initialized.

This candidate does not migrate the rename. It tests whether silent reset can be prevented without an explicit per-prototype rename decision.

### C — explicit previous-name alias + durable logical/physical binding

At the incompatible boundary only:

```ts
preferences: renameObject(initialSettings(), { from: "settings" })
```

The experiment-only manifest then records:

```text
logical declaration: preferences
physical StorekeeperDB key: settings
```

On the next reopen, the alias is omitted:

```ts
preferences: renameObject(initialSettings())
```

The persisted manifest is expected to retain the logical-to-physical binding.

### D — stable durable id declared up front

V1:

```ts
settings: renameObject(initialSettings(), { id: "project-settings" })
```

V2:

```ts
preferences: renameObject(initialSettings(), { id: "project-settings" })
```

This tests a clean identity model at the cost of requiring explicit durable identity on the compatible path from the beginning.

## D — observed result

CI #167 first established that all four runtime probes behaved as designed. A subsequent source-marker audit found that A and B were incorrectly labeled as per-prototype decisions even though neither requires an explicit application choice at the rename point. Those markers were reclassified as observations. CI #168 reran the complete `release:check` with the corrected taxonomy and passed.

### Runtime behavior

| Candidate | Old value preserved | Silent fresh init | Duplicate physical state | Reopen stable | Behavior |
| --- | --- | --- | --- | --- | --- |
| A naive rename | **No** | **Yes** | **Yes** | Yes, but on the wrong logical state | Unsafe negative control |
| B fail loudly | N/A | No | No | Old declaration remains valid | Safe rejection only |
| C explicit alias | **Yes** | No | No | **Yes, alias omitted** | Candidate |
| D stable id | **Yes** | No | No | **Yes** | Correct but upfront ceremony |

### A — negative control confirmed

Observed physical keys:

```text
preferences
settings
tasks
```

The new `preferences` declaration loaded a fresh initial value while the old persisted `settings` state remained in the database.

> **Naive property rename silently initializes fresh state and leaves the old durable state behind.**

This is worse than a loud failure because the application appears to reopen successfully while logical continuity has been lost.

### B — fail-loudly behavior confirmed

Observed error:

```text
Unexplained durable declaration identity change: settings,tasks -> preferences,tasks
```

Observed physical keys:

```text
__project_identity
settings
tasks
```

No `preferences` state was silently created, and reopening the old declaration still recovered the persisted values.

### C — explicit alias behavior confirmed

The V2 rename declaration supplied exactly one explicit persistence decision:

```text
rename-alias
```

After that one reopen, a second reopen omitted `from: "settings"` and still recovered the renamed logical state.

Observed physical keys:

```text
__project_identity
settings
tasks
```

There is no duplicate `preferences` physical state. The manifest preserves the logical binding:

```text
preferences -> physical key "settings"
```

The alias does not physically rename the StorekeeperDB state key.

### D — stable-id behavior confirmed

Observed physical keys:

```text
project-settings
tasks
```

The rename preserved state correctly. However, `stable-durable-id` must already be declared in V1 and repeated later, so this strategy adds one explicit identity decision to the ordinary compatible path.

## Corrected decision profile — CI #168

```text
compatible-path extra decisions
A naive property key   0
B strict manifest      0
C rename alias         0
D stable durable id    1

rename-boundary extra decisions
A naive property key   0   (unsafe)
B strict manifest      0   (rejects only)
C rename alias         1
D stable durable id    0   (paid up front)
```

Framework concepts/mechanisms were also counted separately rather than treated as free:

```text
B
  public:   strict-declaration-identity
  internal: identity-manifest

C
  public:   rename-alias
  internal: identity-manifest
            logical-physical-binding
            rename-resolution

D
  public:   stable-durable-id
  internal: stable-id-binding
```

## Decision

Machine decision after the corrected CI #168 run:

```text
CANDIDATE_PREFER_EXPLICIT_RENAME_ALIAS_WITH_IDENTITY_MANIFEST
```

Current architectural candidate:

```text
ordinary compatible work
  declaration property name
        |
        v
  durable identity manifest
        |
        v
  stable physical StorekeeperDB state key

incompatible rename
  preferences: ... { from: "settings" }
        |
        v
  one explicit rename decision
        |
        v
  manifest updates logical binding
  preferences -> physical "settings"

later reopen
  alias omitted
  binding still resolves old physical state
```

This preserves the #48 objective: routine compatible work does not require an explicit durable key, while an incompatible rename becomes visible exactly when durable identity would otherwise be ambiguous.

## C — competing explanations and failure modes

1. **The identity manifest may be a schema registry under a smaller name.** The current prototype stores only logical name, physical key, and state kind, not domain fields or migrations. That distinction is promising but not yet sufficient evidence for a public abstraction.
2. **`from` is still migration intent.** That is acceptable if it appears only at the incompatible boundary. The product should not market this as automatic migration.
3. **Physical key retention may accumulate historical names.** Candidate C deliberately leaves the physical key as `settings`; it proves logical continuity, not physical cleanup.
4. **Projection and derived metadata behavior has not been exercised.** The renamed state in this experiment is a singleton object. A collection with active query projections may expose additional identity movement requirements.
5. **Multiple rename steps may expose alias-chain bugs.** `settings -> preferences -> configuration` has not yet been tested.
6. **Deletion and rename can be ambiguous together.** A manifest must not guess intent from shape similarity or declaration order.

## U — uncertainty

The following remain unresolved:

- whether the manifest belongs in a future project layer, generated scaffold, or another convention rather than StorekeeperDB core;
- whether logical-to-physical binding should preserve old physical names indefinitely or eventually support transactional physical rename;
- how projections, `__sk_paths`, derivations, and other metadata should behave if a physical state key is ever renamed;
- how rename identity interacts with `__workspace` discoverability/bootstrap conventions;
- whether repeated rename chains remain simple and auditable;
- whether fail-loudly detection can remain narrow without drifting into general schema management.

## Product implication

The evidence does **not** support heuristic or invisible rename migration.

It does support a narrower rule:

> **Routine compatible persistence can remain automatic; durable identity changes must become explicit at the incompatible boundary.**

No public API decision is made by this experiment.