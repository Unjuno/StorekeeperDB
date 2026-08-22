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
| Browser async storage | memory changed; durability must be flushed | experimental / not public API |
| Remote storage | network durability uncertain until acknowledged | not implemented |

## Public language

Use this wording:

> StorekeeperDB currently targets local synchronous SQLite. Browser storage has different durability semantics and is intentionally separated.

Avoid this wording:

> StorekeeperDB works the same in the browser.

## Future design options

The browser runtime should likely expose a different face:

```ts
const sk = await StorekeeperBrowser.open("app");
const tasks = sk.state<Task[]>("tasks", []);

tasks.push({ title: "Draft", done: false });
await sk.flush();
```

The key difference is that `flush()` becomes the durability barrier.
