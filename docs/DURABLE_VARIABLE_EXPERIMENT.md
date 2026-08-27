# Durable variable / session bootstrap experiment

Status: initial cross-process experiment PASS on CI #83. Generalization is still uncertain.

Issue: #26.

## H — hypothesis

A new process can recover the previous process's working state using only:

- the StorekeeperDB database path; and
- one known bootstrap state key (`__workspace`).

The new process should not need the previous process's in-memory objects, conversation history, or a hard-coded list of application state keys.

## T — minimum test

Use two separate Node processes against one temporary SQLite file.

Writer process:

1. opens StorekeeperDB through the public `@storekeeper/db` entrypoint;
2. writes one `__workspace` manifest;
3. writes `decisions` and `findings` states;
4. records those state names in the manifest;
5. updates nested checkpoint state;
6. closes and exits.

Reader process:

1. starts with only the database path and bootstrap key;
2. opens StorekeeperDB through the public package entrypoint;
3. reads the manifest;
4. discovers additional state names from `importantStateKeys`;
5. opens those states dynamically rather than through a hard-coded reader list;
6. verifies current goal, active task, checkpoint, and discovered state counts;
7. closes and exits.

Environment:

- Node >= 22.5;
- `--experimental-sqlite`;
- one temporary local SQLite database;
- two independent Node processes.

Run:

```bash
npm run experiment:durable-session
```

The deterministic check is also included in:

```bash
npm run release:check
```

## D — decision

PASS when:

- reader process reconstructs the expected goal and active task;
- reader discovers durable states from the manifest rather than a hard-coded list;
- decision/finding rows survive the writer process exit;
- nested checkpoint updates survive the process boundary;
- no direct SQLite access or StorekeeperDB internal import is required by the scenario logic;
- the experiment exits successfully.

FAIL when:

- reader needs writer-process memory or object identity;
- a state key must be supplied outside the manifest to recover required work state;
- close/reopen loses source state;
- scenario requires direct SQL or internal runtime knowledge.

UNCERTAIN when:

- persistence works but the bootstrap convention is too application-specific to generalize;
- a single manifest becomes a hidden coordination bottleneck;
- multi-writer behavior is required to judge the design.

## Initial result

CI #83 ran the full `npm run release:check` gate successfully, including `experiment:durable-session:check`.

Observed decision for this experiment:

```text
Durability across process boundary        PASS
Nested checkpoint persistence             PASS
Reader bootstrap from __workspace         PASS
Dynamic discovery of additional states    PASS
Public package entrypoint only             PASS
General workspace/agent API justification UNCERTAIN
```

The experiment therefore supports the narrow architecture claim:

> durable state + a small bootstrap manifest is sufficient for this cross-process recovery scenario.

It does not establish that the bootstrap convention is general enough to become a reserved StorekeeperDB API.

## C — competing explanations

1. The experiment may only prove that a manually curated manifest works, not that agent memory is solved.
2. `__workspace` may simply move schema design into a different JSON object.
3. A parent process still launches both subprocesses and controls the protocol; a real autonomous agent may not know when or how to checkpoint.
4. Discovery can succeed while stale or malicious stored instructions still make continuation unsafe.

## U — uncertainty

Major unresolved areas:

- checkpoint policy;
- stale manifest detection;
- concurrent writers / agents;
- authorization and trust of persisted instructions;
- manifest evolution;
- how much durable state should be loaded into an agent context;
- whether a reserved bootstrap key belongs in StorekeeperDB core or should remain an application convention.

## Architectural interpretation

The experiment separates three responsibilities:

```text
durability
  = StorekeeperDB core persists source state

discoverability
  = bootstrap manifest points to relevant durable states

interpretation / coordination
  = application or agent layer decides what to do with that state
```

The current conclusion is:

> StorekeeperDB can provide session-spanning durable variables, and discoverability can be prototyped above the core with a bootstrap manifest.

It does **not** prove that StorekeeperDB should implement agent memory, orchestration, summarization, autonomous checkpointing, or conflict resolution.

## Follow-up decision

Do not add a reserved `__workspace` API after one passing scenario. Reuse the same convention in at least one additional application or agent-like scenario first. If the convention remains stable and repeatedly removes user-side boilerplate, then evaluate whether a first-class bootstrap/workspace API is justified.
