# Collection rename with active projection experiment

Issue: #52  
PR: #53  
Initial runtime CI: #175 PASS

## Question

Does the one-shot logical rename alias selected by the declaration-key experiment remain coherent when the renamed state is a queried collection that already owns StorekeeperDB projection and derivation metadata?

The critical distinction is:

```text
logical declaration name
        !=
physical StorekeeperDB state key
```

The experiment tests whether keeping physical identity stable makes a collection rename a declaration-layer change rather than a physical projection migration.

## H — falsifiable hypothesis

Given a collection physically stored as `tasks`, after a `priority` projection already exists:

```text
tasks -> workItems
```

with one explicit `from: "tasks"` alias should preserve source rows, projection rows, path observations, derivation metadata, query semantics, and durable-handle mutation without creating any physical `workItems` state.

The hypothesis fails if any application query routes to `workItems`, any duplicate source/derived state appears, a returned query item stops behaving as a durable handle, or reopen without the alias loses the binding.

## T — minimal verification

The experiment uses one temporary SQLite database.

1. Open the project with a `tasks` list containing two items.
2. Query `{ priority: "urgent" }` so StorekeeperDB creates the `tasks:priority` projection.
3. Close the store.
4. Verify two projection cells plus path/derivation metadata under physical key `tasks`.
5. Reopen with logical declaration `workItems` and `from: "tasks"`.
6. Query through the renamed project surface.
7. Confirm the query result item is the same durable handle as the source-list item and the result array remains local.
8. Mutate the projected `priority` field through that query handle from `urgent` to `high`.
9. Verify the existing physical projection updates correctly.
10. Inspect SQLite and reject any source/projection/path/derivation rows under `workItems`.
11. Close and reopen with `workItems` but without `from`.
12. Query again and verify the mutation and logical-to-physical binding persisted.

Direct SQLite reads are experiment instrumentation only. Application state/query/mutation behavior goes through the experiment project wrapper over public StorekeeperDB APIs.

## D — observed result

CI #175 passed the full `npm run release:check` gate.

```text
logical before                         tasks
logical after                          workItems
physical before                        tasks
physical after                         tasks

projection cells before rename         2
projection cells after rename          2
source items under physical tasks      2
source items under logical workItems   0
```

All checks passed:

```text
projection created before rename              PASS
derived metadata existed before rename        PASS
renamed value preserved                       PASS
renamed query returns durable handle           PASS
query result array remains local               PASS
projected-field handle mutation updates index  PASS
no duplicate physical source state             PASS
no logical-name metadata leak                  PASS
existing projection remains under tasks        PASS
manifest binds workItems -> tasks              PASS
reopen without alias preserves mutation        PASS
no late logical-name duplication               PASS
```

Machine decision:

```text
CANDIDATE_PASS_LOGICAL_RENAME_PRESERVES_PHYSICAL_DERIVED_STATE
```

## Interpretation

The experiment does **not** show successful migration of projection metadata from `tasks` to `workItems`.

It shows that such a migration was unnecessary because physical durable identity did not change:

```text
application declaration
workItems
    |
    v
identity manifest
    |
    v
physical StorekeeperDB identity
tasks
    |
    +-- __sk_items
    +-- __sk_paths
    +-- __sk_projection
    +-- __sk_derivations
```

The query wrapper resolves the list reference to its physical key before calling `StorekeeperDB.find()`. Consequently, source and derived persistence state continue to use one physical namespace.

This strengthens the candidate architecture:

> A declaration rename can be explicit at the incompatible boundary while leaving physical durable identity stable.

It also reduces the amount of migration machinery the candidate would require: no projection/path/derivation rewrite is needed merely to make the application property name prettier.

## C — competing explanations / ways this can still break

1. The scenario is one rename, one collection, and one scalar projection. More complex project topologies may expose ambiguity.
2. A multi-step rename may reveal that the manifest is only a one-rename workaround rather than a coherent durable identity layer.
3. Physical-key compaction/renaming was not tested. The current candidate deliberately accepts old physical names as durable implementation identity.
4. Concurrent processes opening different declaration versions during a rename were not tested.
5. `liveFind()` routing through a future project wrapper was not exercised here; the core `liveFind()` snapshot semantics are independently tested elsewhere.
6. No public API surface is authorized by this result.

## U — uncertainty

Still unknown:

- multi-step rename chain behavior;
- conflicting or reversed aliases;
- declaration split/merge semantics;
- concurrent-open behavior during incompatible evolution;
- whether physical-key compaction is ever worth its added migration complexity.

## Next experiment

Highest priority:

```text
settings -> preferences -> configuration
```

Use one explicit alias at each rename boundary, omit aliases on normal subsequent reopens, and verify there remains exactly one physical state plus one current logical binding.

The key self-check is:

> Is the manifest a minimal logical-to-physical identity layer, or is it gradually becoming a schema registry?
