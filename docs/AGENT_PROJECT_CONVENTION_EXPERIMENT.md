# Agent-facing durable project convention experiment

Status: **CANDIDATE PASS in CI #159. Experiment-only; no public API authorized.**

Issue: #48. PR: #49.

## Goal

Issue #46 measured seven persistence-specific implementation decisions for direct StorekeeperDB usage in one project-board prototype:

```text
compatible-state-evolution
durable-query
durable-state
singleton-list-adaptation
state-keying
storekeeper-lifecycle
storekeeper-runtime
```

This experiment asks whether a reusable project-level convention can remove repeated agent-visible persistence decisions without changing StorekeeperDB core semantics or hiding scenario-specific persistence logic inside a helper.

The target is agent-oriented:

> Persistence should normally not enter the coding agent's planning loop.

The experiment measures auditable implementation obligations. It does not inspect or claim access to hidden model chain-of-thought.

## Candidate convention

The placeholder experiment API is:

```ts
const project = openProjectStore(path, {
  tasks: list(initialTasks()),
  settings: object(initialSettings()),
});

project.state.tasks[0]!.status = "done";
project.state.settings.compactMode = true;
```

The names are not public API proposals.

The convention does four important things internally:

1. derives durable state keys from declaration property names;
2. adapts singleton objects to StorekeeperDB's one-item-list root model;
3. owns StorekeeperDB runtime construction;
4. maps a list-state reference back to its durable key for `find()`.

It deliberately keeps one explicit project lifecycle boundary through `close()`.

## Reuse requirement

The exact same generic helper was reused without modification in two different workloads:

### Scenario 1 — project board

- task collection;
- singleton project settings;
- restart/reopen;
- compatible V2 evolution;
- urgent-open query.

### Scenario 2 — editor/workspace

- revision collection;
- singleton document metadata;
- restart/reopen;
- compatible V2 evolution;
- autosave query.

The editor scenario exists to prevent a helper designed only around the board fixture from being counted as generic infrastructure.

## Type-system findings before the passing run

### CI #155 — V1/V2 lexical type reuse was invalid

The first prototype reused one `let project` variable across V1 and V2 declarations. TypeScript correctly retained the V1 inferred shape, so V2-only fields failed compilation.

The fixture was corrected to model version/process phases as separate typed handles:

```ts
const projectV1 = openProjectStore(...V1...);
const projectV2 = openProjectStore(...V2...);
const reopened = openProjectStore(...V2...);
```

This is not extra persistence machinery. V1 and V2 represent different program versions and naturally have different static types.

### CI #158 — the wrapper initially widened `find()` incorrectly

The helper initially accepted `Partial<T>` for queries. StorekeeperDB's actual contract is narrower: `find()` accepts scalar predicates only.

The convention was corrected to preserve the core contract:

```ts
type ScalarWhere<T extends Dict> =
  Partial<Record<keyof T & string, JsonScalar>>;
```

An agent-facing layer must not make the core abstraction appear more capable than it is.

## Measurement model

Per-prototype implementation decisions use:

```text
@decision:<stable-id>
```

Reusable convention cost is reported separately:

```text
@framework-public:<stable-id>
@framework-internal:<stable-id>
```

This prevents helper implementation cost from disappearing from the analysis.

### Framework concepts

Agent-facing concepts:

```text
project-store
shape-descriptor
```

Count: **2**.

The `shape-descriptor` concept covers `list(...)` vs `object(...)`. It is not added again as a per-prototype persistence decision because collection vs singleton is already part of the domain/state shape the agent must represent. The persistence-specific one-item-list adaptation is hidden internally.

Internal mechanisms:

```text
derived-state-keys
runtime-ownership
singleton-adaptation
state-reference-query
```

Count: **4**.

These are implementation machinery, not claimed to be free. They are reported separately because they are written once and reused across prototypes rather than re-decided in each generated feature.

## D — CI #159 result

All four runtime paths passed:

```text
board/current      PASS
board/convention   PASS
editor/current     PASS
editor/convention  PASS
```

Both scenarios preserved compatible evolution, restart durability, singleton state, and query behavior.

### Per-prototype decisions

| scenario | current StorekeeperDB | project convention | reduction |
| --- | ---: | ---: | ---: |
| project board | 7 | **5** | 2 |
| editor/workspace | 7 | **5** | 2 |

Persistence-marked source lines also changed from 14 to 8 in both scenarios, but source size is secondary to decision burden.

Convention decision manifest in both scenarios:

```text
compatible-state-evolution
durable-declaration
durable-query
project-lifecycle
project-runtime
```

Removed from feature-level planning:

```text
state-keying
singleton-list-adaptation
```

Aggregate per-prototype reduction across the two independent scenarios is 4 decision occurrences, while the reusable convention introduces 2 public framework concepts.

Machine result:

```text
CANDIDATE_PASS_REUSABLE_PROJECT_CONVENTION
```

## What the result means

The evidence supports a **project-level convention direction**, not the exact helper API.

The useful architectural move is that a declaration can become the durable-state namespace:

```text
property name
    ↓
derived durable key

natural object
    ↓
internal singleton adaptation
```

For an agent generating many prototypes, those mechanics can be learned once as framework behavior instead of being redesigned in every prototype.

## Critical boundary — property rename is now persistence-significant

Deriving a durable key from the declaration property removes explicit key bookkeeping, but it does not make durable identity disappear.

For example:

```ts
{
  settings: object(...)
}
```

changing to:

```ts
{
  preferences: object(...)
}
```

currently implies a durable key change from `settings` to `preferences`.

That can make old state undiscoverable unless migration/alias semantics are explicit.

Therefore:

> **State-keying is removed from the normal compatible-prototype path, but key rename becomes an explicit incompatible-evolution boundary.**

This is not a reason to reject the convention. It is a reason not to claim that key identity has ceased to exist.

A property-rename experiment is required before any public project-store surface is considered.

## Other boundaries

- The convention still exposes `project-runtime` and `project-lifecycle`; lifecycle was simplified, not erased.
- `compatible-state-evolution` remains a decision because the agent/runtime still needs to know whether a change is safe without migration.
- `durable-query` remains explicit.
- `list()` / `object()` describe natural state topology but add a reusable framework vocabulary.
- Scalar roots remain out of scope.
- `find()` remains scalar-predicate-only.
- Close/reopen preserves durable data, not JavaScript object identity.
- The experiment does not address concurrent writers, corruption, remote synchronization, or browser durability.

## H — result

Hypothesis:

> A fixed project convention can reduce per-prototype persistence decisions in two structurally different scenarios without changing StorekeeperDB core behavior.

Decision: **supported as a candidate direction.**

The stronger hypothesis that the exact `openProjectStore/list/object` API should be exported is **not tested and not authorized**.

## C — competing explanations

1. The two public framework concepts may still be too much vocabulary for the saved decisions in small projects.
2. State-keying may be deferred rather than eliminated because property renames expose it again.
3. The declaration may become a schema registry in disguise as more features are added.
4. Runtime/lifecycle ownership may become harder with multiple project stores or async/browser storage.
5. A third state topology may expose helper assumptions not seen in board/editor workloads.

## U — uncertainty

- property rename and state alias/migration semantics;
- deletion of a declaration property;
- splitting or merging one declared state into multiple states;
- whether declaration discovery should integrate with the durable-session bootstrap manifest;
- whether the eventual layer belongs in core, a subpath, generated scaffold, or a separate agent-oriented package;
- whether lifecycle should stay explicit at generated feature boundaries or move to an application host.

## Next experiment

Deliberately rename a declaration property across versions and measure what breaks.

The goal is not to make rename magically migration-free. The goal is to determine the smallest explicit boundary that preserves durable state while keeping ordinary compatible prototyping free from state-key bookkeeping.

## Run

```bash
npm run experiment:agent-project-convention
```

The output is machine-readable JSON and reports prototype decisions, public convention concepts, and internal convention mechanisms separately.
