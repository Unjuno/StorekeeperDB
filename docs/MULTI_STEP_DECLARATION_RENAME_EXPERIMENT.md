# Multi-step declaration rename identity experiment

Issue: #54  
PR: #55  
Status: **CANDIDATE PASS in CI #183; experiment-only.**

## Question

Can the declaration-layer identity manifest support repeated incompatible property renames while remaining a narrow current logical-name -> physical-key binding rather than growing into a historical schema registry?

Tested chain:

```text
settings -> preferences -> configuration
```

The intended model is:

```text
ordinary compatible path
  no explicit durable-key decision

rename boundary
  one alias from the immediately previous logical name

ordinary reopen
  alias omitted
```

## H — falsifiable hypothesis

Each rename can consume only the current logical binding, transfer that binding to the new logical name, and retain the original physical StorekeeperDB identity.

After two renames, the manifest should be exactly:

```text
configuration -> physical settings
```

not a history such as:

```text
settings -> settings
preferences -> settings
configuration -> settings
```

The hypothesis fails if the second rename needs knowledge of the original name, if old aliases remain valid as rename sources, if rejected renames partially mutate the manifest, or if extra physical state keys appear.

## T — verification

One temporary SQLite database is used throughout.

### Positive path

1. Persist non-default V1 state under logical `settings`.
2. Rename to `preferences` using `from: "settings"`.
3. Mutate the value in V2.
4. Reopen `preferences` without an alias.
5. Rename to `configuration` using only `from: "preferences"`.
6. Mutate the value in V3.
7. Reopen `configuration` without an alias.
8. Verify the physical StorekeeperDB state key remains `settings`.
9. Verify the final manifest contains only `configuration -> settings`.

### Negative controls

While `preferences` is current, attempt:

- `configuration` with no alias;
- `configuration` with stale original `from: "settings"`;
- `configuration` with nonexistent `from: "does-not-exist"`;
- list `configuration` from object `preferences` to force a kind mismatch.

After every rejected attempt, reopen `preferences` normally and verify both data and manifest are unchanged.

After the valid second rename, attempt a new rename from expired logical source `preferences`; it must fail and leave `configuration` intact.

Direct SQLite inspection is used only for physical-key counts and manifest verification. Application state mutation/reopen behavior uses the experiment project wrapper over public StorekeeperDB APIs.

## D — observed result

CI #183 passed the full `npm run release:check` gate.

Final physical state:

```text
__project_identity  1 row
settings            1 row
preferences         0 rows
configuration       0 rows
```

Final manifest:

```json
{
  "configuration": {
    "physicalKey": "settings",
    "kind": "object"
  }
}
```

Negative controls all failed loudly:

```text
missing alias
  New durable declaration configuration is ambiguous with removed state preferences; provide an explicit rename alias.

stale original alias
  Rename source settings does not exist.

nonexistent alias
  Rename source does-not-exist does not exist.

kind mismatch
  Rename source kind mismatch for preferences -> configuration.

expired prior logical alias after V3
  Rename source preferences does not exist.
```

All post-failure integrity checks passed. Rejected rename attempts did not alter the current binding or stored value.

Machine decision:

```text
CANDIDATE_PASS_MULTI_STEP_RENAME_RETAINS_SINGLE_PHYSICAL_IDENTITY
```

## Interpretation

The tested manifest behaves as a **current identity binding**, not a rename-history registry.

Each successful rename performs this conceptual operation:

```text
before
preferences -> settings

rename boundary
configuration from preferences

result
configuration -> settings
```

The previous logical name is consumed. The original physical key is preserved but does not need to be supplied by application code on later renames.

This matters for agent-facing decision burden:

```text
V1 compatible work      no durable id decision
first rename            1 explicit alias
ordinary V2 reopen      0 alias decisions
second rename           1 explicit alias to immediate prior name
ordinary V3 reopen      0 alias decisions
```

The application does not carry the complete persistence history.

## C — competing explanations / ways this can still break

1. This is a one-state rename chain. Multiple simultaneous adds/removes may make alias resolution ambiguous.
2. State split/merge cannot be represented by one old logical identity -> one new logical identity and likely requires explicit migration semantics.
3. Concurrent processes using different declaration versions were not tested.
4. Physical-key compaction is still intentionally absent. Keeping historical physical keys may eventually become an operational concern, but no evidence currently justifies that complexity.
5. The manifest still stores type-kind metadata; broader schema metadata should not be added without a demonstrated incompatible-evolution need.
6. No public project-store or rename API is authorized by this result.

## U — uncertainty

Still untested:

- declaration split and merge;
- deletion without replacement;
- incompatible value transformation;
- concurrent version skew during rename;
- long-lived operational cost of historical physical names.

## Next experiment

The strongest next challenge is a **declared-state split/merge boundary**, because one-to-one alias semantics cannot safely infer it.

Example:

```text
profile
  ->
account + preferences
```

or the reverse.

The expected safe behavior is fail-loudly unless an explicit migration operation owns value transformation and atomicity.

Self-check:

> Have we found the boundary where a narrow identity alias stops being sufficient and real migration semantics must re-enter the planning loop?
