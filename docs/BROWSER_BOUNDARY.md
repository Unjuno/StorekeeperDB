# Browser storage boundary

StorekeeperDB's current public alpha targets local synchronous SQLite on Node.js.

Browser-style storage is intentionally not presented as equivalent to the Node runtime.

## Why this boundary exists

Ordinary JavaScript mutation is synchronous:

```ts
tasks[0]!.priority = "urgent";
tasks.push({ title: "Fix login", done: false });
```

A synchronous setter or array mutator cannot `await` IndexedDB, OPFS async APIs, or remote storage. Treating async durability as if it were the same as synchronous SQLite durability would be misleading.

## Current rule

| Runtime | Mutation return means | Status |
| --- | --- | --- |
| Node local SQLite | durable before returning | alpha baseline |
| Browser-style async storage | memory changed; durability must be flushed | experimental boundary model |
| Remote storage | network durability uncertain until acknowledged | not implemented |

## Experimental boundary model

The `@storekeeper/db/experimental` entrypoint now includes an intentionally small write-behind model:

```ts
import {
  AsyncMemoryStorage,
  ExperimentalAsyncWriteBehindRuntime,
} from "@storekeeper/db/experimental";

type Task = { title: string; done: boolean };

const storage = new AsyncMemoryStorage();
const sk = new ExperimentalAsyncWriteBehindRuntime(storage);
const tasks = await sk.state<Task[]>("tasks", []);

tasks.push({ title: "Draft", done: false });

sk.status();
// { durability: "dirty", pendingWrites: 1, ... }

await sk.flush();

sk.status();
// { durability: "clean", pendingWrites: 0, ... }
```

The important distinction is:

```text
ordinary mutation return
  = memory changed

flush resolved
  = async storage accepted the write
```

A failed `flush()` leaves the runtime in `failed` status with pending writes intact, so the app can retry or surface the error. It does not pretend the write was durable.

## Public language

Use this wording:

> StorekeeperDB currently targets local synchronous SQLite. Browser-style async storage has different durability semantics and is intentionally separated behind an experimental write-behind boundary where `flush()` is the durability barrier.

Avoid this wording:

> StorekeeperDB works the same in the browser.

## What this is not

The experimental boundary model is not a full browser adapter. It does not implement IndexedDB, OPFS, Service Worker sync, multi-tab coordination, or conflict resolution.

It exists to keep the semantics honest before a real browser storage backend is introduced.
