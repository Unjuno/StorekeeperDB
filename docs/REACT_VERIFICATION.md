# React verification

This document records the first real React verification pass for StorekeeperDB.

The public alpha keeps React out of the core runtime. The React-facing package surface is intentionally thin:

```ts
import { externalStore } from "@storekeeper/db/react";
```

`externalStore(signal)` returns the shape expected by React's `useSyncExternalStore`:

```ts
{
  subscribe,
  getSnapshot,
  getServerSnapshot
}
```

## What is verified

The React test mounts a real React component with `react-test-renderer` and uses:

```ts
useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
```

against a Storekeeper `liveFind()` signal.

The test verifies:

1. Initial render reads the current Storekeeper snapshot.
2. A related ordinary mutation updates the React-rendered output.
3. An unrelated ordinary mutation does not re-render the component.
4. Unmount unsubscribes from the Storekeeper signal.

## Why this matters

The core promise is not only persistence. StorekeeperDB is meant to support local UI prototype loops:

```text
ordinary TypeScript mutation
  -> SQLite source state
  -> signal/liveFind notification
  -> React useSyncExternalStore render
```

This test confirms that the adapter shape works against real React, not only a hand-written mock.

## Boundaries

- React is a devDependency for verification, not a runtime dependency of `@storekeeper/db` core.
- The core runtime remains independent of React.
- Browser storage is still out of scope; this remains Node-local SQLite verification.
- `react-test-renderer` is used for deterministic CI verification, not for production rendering.
