# Durable variable / session bootstrap experiment

Status: draft experiment.

## H — hypothesis

A new process can recover the previous process's working state using only:

- the StorekeeperDB database path; and
- one known bootstrap state key (`__workspace`).

The new process should not need the previous process's in-memory objects, conversation history, or a hard-coded list of application state keys.

## T — minimum test

Use two separate Node processes against one temporary SQLite file.

Writer process:

1. opens StorekeeperDB;
2. writes one `__workspace` manifest;
3. writes `decisions` and `findings` states;
4. records those state names in the manifest;
5. closes and exits.

Reader process:

1. starts with only the database path and bootstrap key;
2. opens StorekeeperDB;
3. reads the manifest;
4. discovers `decisions` and `findings` from `importantStateKeys`;
5. opens those states dynamically;
6. verifies current goal, active task, checkpoint, and discovered state counts;
7. closes and exits.

Environment:

- Node >= 22.5;
- `--experimental-sqlite`;
- one temporary local SQLite database;
- two independent Node processes.

## D — decision

PASS when:

- reader process reconstructs the expected goal and active task;
- reader discovers durable states from the manifest rather than a hard-coded list;
- decision/finding rows survive the writer process exit;
- no internal SQLite access or StorekeeperDB internal import is required by the scenario logic;
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

## C — competing explanations

1. The experiment may only prove that a manually curated manifest works, not that agent memory is solved.
2. `__workspace` may simply move schema design into a different JSON object.
3. A single-process parent that launches two subprocesses still controls the protocol; a real autonomous agent may not know when or how to checkpoint.
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

## Expected architectural consequence

If the experiment passes, the narrow conclusion is:

> StorekeeperDB can provide session-spanning durable variables, and discoverability can be prototyped above the core with a bootstrap manifest.

It does **not** prove that StorekeeperDB should implement agent memory, orchestration, summarization, or conflict resolution.
